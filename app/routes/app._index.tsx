import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { formatRate } from "../domain/commission";
import { formatCents } from "../domain/money";
import {
  enqueueOrderProcessing,
  listCommissions,
  summarizeCommissions,
} from "../services/commissions.server";
import { purgeOldWebhookEventsIfDue } from "../services/retention.server";
import {
  getWebhookEvent,
  listRecentWebhookEvents,
  parseStoredPayload,
} from "../services/webhook-events.server";
import type { OrdersPaidPayload } from "../types/orders-paid";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  await purgeOldWebhookEventsIfDue();
  const [commissions, events, summary] = await Promise.all([
    listCommissions(shop),
    listRecentWebhookEvents(shop),
    summarizeCommissions(shop),
  ]);

  return {
    shop,
    summary,
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

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

function commissionTone(status: string): "success" | "warning" | "info" {
  if (status === "unattributed") return "warning";
  if (status === "calculated") return "info";
  return "success";
}

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
  const { shop, summary, commissions, events } = useLoaderData<typeof loader>();
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
        {commissions.length === 0 ? (
          <s-paragraph>
            No paid orders yet. Place a test order on the storefront with a{" "}
            <code>?ref=CODE</code> link and it will appear here within seconds.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>Paid</s-table-header>
              <s-table-header>Distributor</s-table-header>
              <s-table-header format="currency">Base</s-table-header>
              <s-table-header format="numeric">Rate</s-table-header>
              <s-table-header format="currency">Commission</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {commissions.map((commission) => (
                <s-table-row key={commission.id}>
                  <s-table-cell>
                    <s-link
                      href={`shopify://admin/orders/${legacyId(commission.orderId)}`}
                      target="_blank"
                    >
                      {commission.orderName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{formatDate(commission.paidAt)}</s-table-cell>
                  <s-table-cell>
                    {commission.distributorName ??
                      commission.referralCode ??
                      "—"}
                  </s-table-cell>
                  <s-table-cell>{commission.base}</s-table-cell>
                  <s-table-cell>{commission.rate}</s-table-cell>
                  <s-table-cell>{commission.amount}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={commissionTone(commission.status)}>
                      {commission.status}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
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
                      {...(fetcher.state !== "idle" ? { disabled: true } : {})}
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
            Next: distributor metaobjects, write-back to the order and sync to
            the commission engine.
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
