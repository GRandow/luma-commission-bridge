import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { formatRate } from "../domain/commission";
import { formatCents } from "../domain/money";
import { isPayable, type CommissionStatus } from "../domain/resolve-commission";
import { getEngineConfig } from "../services/commission-engine.server";
import { enqueueCommissionSync } from "../services/commission-sync.server";
import {
  enqueueOrderProcessing,
  listCommissions,
  summarizeCommissions,
} from "../services/commissions.server";
import {
  listDistributors,
  seedSampleDistributors,
} from "../services/distributors.server";
import {
  definitionsReady,
  ensureCommissionDefinitions,
  listCommissionDefinitions,
} from "../services/order-definitions.server";
import { purgeOldWebhookEventsIfDue } from "../services/retention.server";
import {
  getSimulatedEngineMode,
  isSimulatedEngineMode,
  setSimulatedEngineMode,
  type SimulatedEngineMode,
} from "../services/simulated-engine.server";
import {
  getWebhookEvent,
  listRecentWebhookEvents,
  parseStoredPayload,
} from "../services/webhook-events.server";
import type { OrdersPaidPayload } from "../types/orders-paid";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  await purgeOldWebhookEventsIfDue();
  const [commissions, events, summary, distributors, definitions] =
    await Promise.all([
      listCommissions(shop),
      listRecentWebhookEvents(shop),
      summarizeCommissions(shop),
      listDistributors(admin).catch((error: unknown) => {
        // The metaobject definition is created by `shopify app deploy`/`dev`;
        // until then the query fails and the section explains what to do.
        console.error("[distributors] listing failed", error);
        return null;
      }),
      listCommissionDefinitions(admin).catch((error: unknown) => {
        console.error("[definitions] listing failed", error);
        return [];
      }),
    ]);

  const engine = getEngineConfig();
  const engineUrl = new URL(engine.url, "http://localhost");
  const simulated = engineUrl.pathname.startsWith("/simulated-engine/");
  const urlMode = engineUrl.searchParams.get("mode");

  return {
    shop,
    summary,
    definitionsReady: definitionsReady(definitions),
    engine: {
      host: engineUrl.host,
      path: engineUrl.pathname + engineUrl.search,
      simulated,
      // How the simulator answers: forced by the URL, or the switch on the page.
      mode: urlMode ?? (simulated ? getSimulatedEngineMode() : null),
      modeFromUrl: urlMode !== null,
    },
    distributors: distributors?.map((distributor) => ({
      id: distributor.id,
      code: distributor.code,
      name: distributor.name,
      level: distributor.level,
      rate: formatRate(distributor.rateBps),
      active: distributor.active,
    })),
    commissions: commissions.map((commission) => ({
      id: commission.id,
      orderId: commission.orderId,
      orderName: commission.orderName,
      paidAt: commission.paidAt.toISOString(),
      referralCode: commission.referralCode,
      distributorName: commission.distributorName,
      base: formatCents(commission.baseCents, commission.orderCurrency),
      rate: formatRate(commission.rateBps),
      amount: formatCents(commission.amountCents, commission.orderCurrency),
      status: commission.status,
      payable: isPayable(commission.status as CommissionStatus),
      syncStatus: commission.syncStatus,
      syncReference: commission.syncReference,
      syncError: commission.syncError,
      syncAttempts: commission.syncAttempts,
    })),
    events: events.map((event) => ({
      id: event.id,
      topic: event.topic,
      status: event.status,
      attempts: event.attempts,
      error: event.error,
      receivedAt: event.receivedAt.toISOString(),
    })),
  };
};

const simulatorModeMessage: Record<SimulatedEngineMode, string> = {
  normal: "Simulator back to normal: it accepts commissions again.",
  fail: "Simulator is down: syncs get a 503, retry with backoff, then fail.",
  reject: "Simulator rejects commissions: syncs get a 422 and stop.",
};

const simulatorModes: Array<{ mode: SimulatedEngineMode; label: string }> = [
  { mode: "normal", label: "Normal" },
  { mode: "fail", label: "Outage (503)" },
  { mode: "reject", label: "Rejecting (422)" },
];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();

  if (form.get("intent") === "seed-distributors") {
    try {
      const created = await seedSampleDistributors(admin);
      return {
        ok: true,
        message: `${created.length} sample distributors ready.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `Could not create distributors: ${message}`,
      };
    }
  }

  if (form.get("intent") === "setup-definitions") {
    try {
      const { created, pinned } = await ensureCommissionDefinitions(admin);
      return {
        ok: true,
        message:
          created + pinned > 0
            ? `Commission metafields ready (${created} created, ${pinned} pinned). Reprocess earlier orders to fill them in.`
            : "Commission metafields were already set up.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `Could not set up the metafields: ${message}`,
      };
    }
  }

  if (form.get("intent") === "retry-sync") {
    const commissionId = String(form.get("commissionId") ?? "");
    const commission = await prisma.commission.findUnique({
      where: { id: commissionId },
    });
    if (!commission || commission.shop !== session.shop) {
      return { ok: false, message: "That commission was not found." };
    }
    void enqueueCommissionSync(commission.id, commission.orderName);
    return { ok: true, message: `Sync of ${commission.orderName} queued.` };
  }

  if (form.get("intent") === "reprocess") {
    const webhookId = String(form.get("webhookId") ?? "");
    const event = await getWebhookEvent(webhookId);
    if (!event || event.shop !== session.shop) {
      return { ok: false, message: "That webhook delivery was not found." };
    }
    const order = parseStoredPayload<OrdersPaidPayload>(event);
    if (!order)
      return { ok: false, message: "The stored payload could not be read." };

    void enqueueOrderProcessing({ webhookId, shop: session.shop, order });
    return { ok: true, message: `Order ${order.name} queued again.` };
  }

  if (form.get("intent") === "engine-mode") {
    const mode = form.get("mode");
    if (!isSimulatedEngineMode(mode)) {
      return { ok: false, message: "Unknown simulator mode." };
    }
    setSimulatedEngineMode(mode);
    return { ok: true, message: simulatorModeMessage[mode] };
  }

  return { ok: false, message: "Unknown action." };
};

type EventStatus = "received" | "processing" | "processed" | "failed";

const eventTone: Record<
  EventStatus,
  "info" | "success" | "critical" | "warning"
> = {
  received: "info",
  processing: "warning",
  processed: "success",
  failed: "critical",
};

function commissionTone(
  status: string,
): "success" | "warning" | "info" | "critical" {
  switch (status) {
    case "written_back":
      return "success";
    case "calculated":
      return "info";
    case "unknown_distributor":
    case "inactive_distributor":
      return "critical";
    default:
      return "warning";
  }
}

const syncTone: Record<string, "success" | "warning" | "critical" | "neutral"> =
  {
    synced: "success",
    pending: "warning",
    failed: "critical",
    skipped: "neutral",
  };

const statusLabel: Record<string, string> = {
  written_back: "on order",
  calculated: "calculated",
  unattributed: "no referral",
  unknown_distributor: "unknown code",
  inactive_distributor: "inactive distributor",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** `gid://shopify/Order/123` → `123`, the admin URL id. */
function legacyId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

export default function Dashboard() {
  const {
    shop,
    summary,
    commissions,
    events,
    distributors,
    definitionsReady: definitionsAreReady,
    engine,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const storeHandle = shop.replace(".myshopify.com", "");

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  // Webhooks arrive while the page is open; keep the tables fresh without a reload.
  useEffect(() => {
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [revalidator]);

  const reprocess = (webhookId: string) =>
    fetcher.submit({ intent: "reprocess", webhookId }, { method: "POST" });
  const seedDistributors = () =>
    fetcher.submit({ intent: "seed-distributors" }, { method: "POST" });
  const setupDefinitions = () =>
    fetcher.submit({ intent: "setup-definitions" }, { method: "POST" });
  const retrySync = (commissionId: string) =>
    fetcher.submit({ intent: "retry-sync", commissionId }, { method: "POST" });
  const setEngineMode = (mode: SimulatedEngineMode) =>
    fetcher.submit({ intent: "engine-mode", mode }, { method: "POST" });
  const busy = fetcher.state !== "idle";

  return (
    <s-page heading="Commission bridge">
      <s-section heading="Overview">
        <s-stack direction="inline" gap="large">
          <Stat label="Paid orders received" value={String(summary.orders)} />
          <Stat
            label="Attributed to a distributor"
            value={String(summary.attributed)}
          />
          {summary.totals.length === 0 ? (
            <Stat label="Commission owed" value="—" />
          ) : (
            summary.totals.map((total) => (
              <Stat
                key={total.currency}
                label={`Commission owed (${total.currency})`}
                value={formatCents(total.amountCents, total.currency)}
              />
            ))
          )}
        </s-stack>
      </s-section>

      <s-section heading="Commissions">
        {!definitionsAreReady ? (
          <s-banner tone="info" heading="Show commissions on the order page">
            <s-paragraph>
              The app writes the commission on each attributed order as
              metafields. Create its pinned metafield definitions once so the
              admin shows them on every order page.
            </s-paragraph>
            <s-button
              slot="secondary-actions"
              onClick={setupDefinitions}
              {...(busy ? { loading: true } : {})}
            >
              Set up order metafields
            </s-button>
          </s-banner>
        ) : null}
        {commissions.length === 0 ? (
          <s-paragraph>
            No paid orders yet. Place a test order on the storefront with a{" "}
            <code>?ref=CODE</code> link and it will appear here within seconds.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>Distributor</s-table-header>
              <s-table-header format="currency">Commission</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Engine</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {commissions.map((commission) => (
                <s-table-row key={commission.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-200">
                      <s-link
                        href={`shopify://admin/orders/${legacyId(commission.orderId)}`}
                        target="_blank"
                      >
                        {commission.orderName}
                      </s-link>
                      <s-text color="subdued">
                        {formatDate(commission.paidAt)}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {commission.distributorName ??
                      commission.referralCode ??
                      "—"}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-200" alignItems="end">
                      <s-text>{commission.amount}</s-text>
                      <s-text color="subdued">
                        {commission.rate} of {commission.base}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={commissionTone(commission.status)}>
                      {statusLabel[commission.status] ?? commission.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {commission.payable ? (
                      <EngineCell
                        commission={commission}
                        busy={busy}
                        onSync={() => retrySync(commission.id)}
                      />
                    ) : (
                      <s-text color="subdued">—</s-text>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Distributors">
        <s-paragraph>
          Distributors are metaobjects (<code>$app:distributor</code>): the
          merchant manages them under Content → Metaobjects, no extra screen
          needed. Each has a code, a level and their own commission rate.
        </s-paragraph>
        {distributors === undefined || distributors === null ? (
          <s-banner tone="warning" heading="Distributor definition not found">
            The metaobject definition is created from{" "}
            <code>shopify.app.toml</code> when the app is deployed. Run{" "}
            <code>shopify app deploy</code> (or restart{" "}
            <code>shopify app dev</code>) and reload this page.
          </s-banner>
        ) : distributors.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              No distributors yet. Seed three sample ones to try the flow, or
              add your own in the admin.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button
                onClick={seedDistributors}
                {...(busy ? { loading: true } : {})}
              >
                Seed sample distributors
              </s-button>
              <s-link
                href={`https://admin.shopify.com/store/${storeHandle}/content/metaobjects`}
                target="_blank"
              >
                Open Content → Metaobjects
              </s-link>
            </s-stack>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Code</s-table-header>
                <s-table-header>Name</s-table-header>
                <s-table-header>Level</s-table-header>
                <s-table-header format="numeric">Rate</s-table-header>
                <s-table-header>Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {distributors.map((distributor) => (
                  <s-table-row key={distributor.id}>
                    <s-table-cell>{distributor.code}</s-table-cell>
                    <s-table-cell>{distributor.name}</s-table-cell>
                    <s-table-cell>{distributor.level ?? "—"}</s-table-cell>
                    <s-table-cell>{distributor.rate}</s-table-cell>
                    <s-table-cell>
                      <s-badge
                        tone={distributor.active ? "success" : "neutral"}
                      >
                        {distributor.active ? "active" : "inactive"}
                      </s-badge>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-paragraph>
              Share a link such as{" "}
              <code>
                https://grandow.github.io/luma-shopify-storefront/?ref=
                {distributors[0]?.code}
              </code>{" "}
              to attribute an order. Manage entries in{" "}
              <s-link
                href={`https://admin.shopify.com/store/${storeHandle}/content/metaobjects`}
                target="_blank"
              >
                Content → Metaobjects
              </s-link>
              .
            </s-paragraph>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Webhook deliveries">
        <s-paragraph>
          Every <code>orders/paid</code> delivery is recorded under
          Shopify&apos;s webhook id before it is processed, so a retried
          delivery is recognised and skipped. A failed job can be queued again
          from here.
        </s-paragraph>
        {events.length === 0 ? (
          <s-paragraph>Nothing received yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Received</s-table-header>
              <s-table-header>Topic</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Details</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {events.map((event) => (
                <s-table-row key={event.id}>
                  <s-table-cell>{formatDate(event.receivedAt)}</s-table-cell>
                  <s-table-cell>{event.topic}</s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={eventTone[event.status as EventStatus] ?? "info"}
                    >
                      {event.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {event.error ??
                      (event.attempts > 1 ? `${event.attempts} attempts` : "")}
                  </s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      onClick={() => reprocess(event.id)}
                      {...(busy ? { disabled: true } : {})}
                    >
                      Reprocess
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Commission engine">
        <s-paragraph>
          {engine.simulated
            ? "Built-in simulator (this app's own endpoint)."
            : `External endpoint at ${engine.host}.`}
        </s-paragraph>
        <s-paragraph>
          <s-text color="subdued">
            {engine.host}
            {engine.path}
          </s-text>
        </s-paragraph>
        {engine.modeFromUrl ? (
          <s-banner
            tone="warning"
            heading={`Mode "${engine.mode}" fixed by the URL`}
          >
            Set through <code>COMMISSION_ENGINE_URL</code>; remove{" "}
            <code>?mode=</code> from it to switch modes from this page.
          </s-banner>
        ) : engine.simulated ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Rehearse a failure: switch the simulator, place an order or click{" "}
              <em>Sync</em>, watch the Engine column, then switch back and click{" "}
              <em>Retry</em>.
            </s-paragraph>
            <s-stack direction="inline" gap="small">
              {simulatorModes.map(({ mode, label }) => (
                <s-button
                  key={mode}
                  variant={engine.mode === mode ? "primary" : "secondary"}
                  onClick={() => setEngineMode(mode)}
                  {...(busy ? { disabled: true } : {})}
                >
                  {label}
                </s-button>
              ))}
            </s-stack>
            {engine.mode === "fail" ? (
              <s-banner tone="warning" heading="Simulating an outage">
                Every sync gets a 503: the job retries with backoff and ends up
                failed, with the reason and attempt count on the row.
              </s-banner>
            ) : engine.mode === "reject" ? (
              <s-banner tone="critical" heading="Simulating rejections">
                Every sync gets a 422: the job stops without retrying and waits
                for someone to fix the cause and click Retry.
              </s-banner>
            ) : null}
          </s-stack>
        ) : null}
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-unordered-list>
          <s-list-item>
            The storefront writes the distributor&apos;s code on the cart (
            <code>ref</code>).
          </s-list-item>
          <s-list-item>
            Shopify copies it onto the order and sends <code>orders/paid</code>{" "}
            here.
          </s-list-item>
          <s-list-item>
            The webhook is verified, recorded and queued; the worker calculates
            the commission on the discounted subtotal.
          </s-list-item>
          <s-list-item>
            The distributor&apos;s own rate applies; the commission is written
            on the order as metafields and a <code>ref:</code> tag.
          </s-list-item>
          <s-list-item>
            Payable commissions are handed to the commission engine with an
            idempotency key; outages retry with backoff, rejections stop and
            wait for a person.
          </s-list-item>
        </s-unordered-list>
        <s-paragraph>
          <s-link
            href={`https://admin.shopify.com/store/${storeHandle}/orders`}
            target="_blank"
          >
            Open orders in the admin
          </s-link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

interface EngineCellProps {
  commission: {
    syncStatus: string;
    syncReference: string | null;
    syncError: string | null;
    syncAttempts: number;
  };
  busy: boolean;
  onSync: () => void;
}

/** The hand-off to the engine: its state, the reference it gave, or why it failed. */
function EngineCell({ commission, busy, onSync }: EngineCellProps) {
  const failed = commission.syncStatus === "failed";
  const attempts = commission.syncAttempts;
  return (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-badge tone={syncTone[commission.syncStatus] ?? "neutral"}>
          {commission.syncStatus}
        </s-badge>
        {failed || commission.syncStatus === "pending" ? (
          <s-button
            variant="tertiary"
            onClick={onSync}
            {...(busy ? { disabled: true } : {})}
          >
            {failed ? "Retry" : "Sync"}
          </s-button>
        ) : null}
      </s-stack>
      {commission.syncReference ? (
        <s-text color="subdued">{commission.syncReference}</s-text>
      ) : null}
      {failed && commission.syncError ? (
        <s-text color="subdued">
          {commission.syncError} · after {attempts}{" "}
          {attempts === 1 ? "attempt" : "attempts"}
        </s-text>
      ) : null}
    </s-stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      minInlineSize="180px"
    >
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
