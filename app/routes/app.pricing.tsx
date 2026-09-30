import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { NoWrap } from "../components/NoWrap";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";
import {
  DEFAULT_PRICING_SETTINGS,
  distinctLevels,
  formatPercent,
  levelKey,
  parsePercentInput,
  settingsFromForm,
  type PricingSettings,
} from "../domain/pricing";
import {
  customerLinkStatus,
  ensureCustomerLink,
  type CustomerLinkStatus,
} from "../services/customer-link.server";
import { listDistributors } from "../services/distributors.server";
import {
  discountAdminUrl,
  loadPricing,
  savePricing,
  syncPricingDistributors,
  type PricingState,
} from "../services/pricing.server";
import { authenticate } from "../shopify.server";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const [distributors, pricing, linkStatus] = await Promise.all([
    listDistributors(admin).catch((error: unknown) => {
      console.error("[pricing] distributors listing failed", error);
      return null;
    }),
    loadPricing(admin).catch(
      (error: unknown): PricingState & { error: string } => ({
        discount: null,
        settings: DEFAULT_PRICING_SETTINGS,
        error: errorMessage(error),
      }),
    ),
    customerLinkStatus(admin).catch(() => "missing" as CustomerLinkStatus),
  ]);

  // A distributor deactivated or moved to another level since the last save
  // must reach the Function, which only knows what the config says.
  if (pricing.discount && distributors) {
    await syncPricingDistributors(admin, distributors, pricing).catch(
      (error: unknown) => console.error("[pricing] sync failed", error),
    );
  }

  const list = distributors ?? [];
  return {
    loadError: "error" in pricing ? pricing.error : null,
    discount: pricing.discount
      ? {
          title: pricing.discount.title,
          status: pricing.discount.status,
          adminUrl: discountAdminUrl(pricing.discount.id),
        }
      : null,
    settings: pricing.settings,
    levels: distinctLevels(list).map((level) => ({
      level,
      names: list
        .filter(
          (distributor) =>
            distributor.level &&
            levelKey(distributor.level) === levelKey(level),
        )
        .map((distributor) => distributor.name),
    })),
    distributors: list.map((distributor) => ({
      id: distributor.id,
      code: distributor.code,
      name: distributor.name,
      level: distributor.level,
      active: distributor.active,
    })),
    distributorsMissing: distributors === null,
    linkStatus,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "save-pricing") {
    return { ok: false, message: "Unknown action." };
  }

  let distributors;
  try {
    distributors = await listDistributors(admin);
  } catch (error) {
    return {
      ok: false,
      message: `Could not read the distributors: ${errorMessage(error)}`,
    };
  }

  let settings: PricingSettings;
  try {
    settings = settingsFromForm(
      {
        referralPercent: String(form.get("referralPercent") ?? ""),
        referralPercents: JSON.parse(
          String(form.get("referralPercents") ?? "{}"),
        ),
        wholesalePercent: String(form.get("wholesalePercent") ?? ""),
        levelPercents: JSON.parse(String(form.get("levelPercents") ?? "{}")),
      },
      Object.fromEntries(distributors.map(({ id, name }) => [id, name])),
    );
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  try {
    // The customer field comes first: the discount is useless for
    // wholesale until customers can be linked to a distributor.
    await ensureCustomerLink(admin);
    const { created } = await savePricing(admin, settings, distributors);
    return {
      ok: true,
      message: created
        ? "Distributor pricing is live: the discount was created in Discounts."
        : "Distributor pricing saved.",
    };
  } catch (error) {
    return {
      ok: false,
      message: `Could not save the pricing: ${errorMessage(error)}`,
    };
  }
};

const statusTone: Record<string, "success" | "warning" | "critical"> = {
  ACTIVE: "success",
  SCHEDULED: "warning",
  EXPIRED: "critical",
};

/** The value typed in a Polaris field, from its input/change event. */
function fieldValue(event: Event): string {
  return (
    (event.currentTarget as HTMLElementTagNameMap["s-number-field"]).value ?? ""
  );
}

/** A percentage as typed, or `null` when blank or not (yet) valid. */
function typedPercent(raw: string): number | null {
  try {
    return parsePercentInput(raw);
  } catch {
    return null;
  }
}

export default function PricingPage() {
  const {
    loadError,
    discount,
    settings,
    levels,
    distributors,
    distributorsMissing,
    linkStatus,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";

  const [referral, setReferral] = useState(String(settings.referralPercent));
  const [wholesale, setWholesale] = useState(String(settings.wholesalePercent));
  // Per distributor, by metaobject GID; blank means the default. Inactive
  // distributors are kept too, so their rate survives a pause.
  const [referralValues, setReferralValues] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        distributors.map(({ id }) => {
          const own = settings.referralPercents[id];
          return [id, own === undefined ? "" : String(own)];
        }),
      ),
  );
  // Keyed by `levelKey`, so "Team leader" and "team  Leader" share a rate.
  const [levelValues, setLevelValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      levels.map(({ level }) => {
        const own = settings.levelPercents[levelKey(level)];
        return [levelKey(level), own === undefined ? "" : String(own)];
      }),
    ),
  );

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  // What each distributor pays, from the values being typed.
  const preview = useMemo(() => {
    const defaultWholesale = typedPercent(wholesale);
    return distributors.map((distributor) => {
      const own = distributor.level
        ? typedPercent(levelValues[levelKey(distributor.level)] ?? "")
        : null;
      return { ...distributor, wholesale: own ?? defaultWholesale };
    });
  }, [distributors, levelValues, wholesale]);

  const save = () =>
    fetcher.submit(
      {
        intent: "save-pricing",
        referralPercent: referral,
        referralPercents: JSON.stringify(referralValues),
        wholesalePercent: wholesale,
        // By level name, so a validation error names the level as shown.
        levelPercents: JSON.stringify(
          Object.fromEntries(
            levels.map(({ level }) => [
              level,
              levelValues[levelKey(level)] ?? "",
            ]),
          ),
        ),
      },
      { method: "POST" },
    );

  return (
    <s-page heading="Distributor pricing">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(saving ? { loading: true } : {})}
      >
        {discount ? "Save" : "Save and go live"}
      </s-button>

      {loadError ? (
        <s-banner tone="critical" heading="Could not read the discounts">
          <s-paragraph>
            {loadError}. If the app was just updated, approve its new
            permissions (discounts and customers) in the admin, then reload.
          </s-paragraph>
        </s-banner>
      ) : !discount ? (
        <s-banner tone="info" heading="Not live yet">
          <s-paragraph>
            Saving creates an automatic discount, &ldquo;Distributor
            pricing&rdquo;, that runs this app&apos;s Shopify Function at
            checkout, and adds a Distributor field to the customer page.
          </s-paragraph>
        </s-banner>
      ) : discount.status !== "ACTIVE" ? (
        <s-banner
          tone="warning"
          heading={`The discount is ${discount.status.toLowerCase()}`}
        >
          <s-paragraph>
            These prices are not being applied.{" "}
            <s-link href={discount.adminUrl} target="_blank">
              Open it in Discounts
            </s-link>{" "}
            to change its dates.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Referral discount">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Off every item for a shopper who arrives with an active
            distributor&apos;s link or code (the <code>ref</code> cart
            attribute). This is the default; give a distributor their own rate
            in the table below. 0 turns it off.
          </s-paragraph>
          <s-box inlineSize="200px">
            <s-number-field
              label="Default referral discount"
              suffix="%"
              min={0}
              max={100}
              step={0.5}
              value={referral}
              onInput={(event: Event) => setReferral(fieldValue(event))}
            />
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Who gets what">
        {distributorsMissing ? (
          <s-paragraph>
            The distributors could not be read. Open the overview for details.
          </s-paragraph>
        ) : preview.length === 0 ? (
          <s-paragraph>
            No distributors yet. Add them in Content → Metaobjects, or create
            the sample ones from the overview.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Each distributor&apos;s referral rate can differ: type it in the
              last column, or leave it blank to use the default
              {referral ? ` (${referral}%)` : ""}.
            </s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Distributor</s-table-header>
                <s-table-header>Level</s-table-header>
                <s-table-header format="numeric">Buys at</s-table-header>
                <s-table-header format="numeric">
                  Their referrals get
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {preview.map((distributor) => (
                  <s-table-row key={distributor.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-200">
                        <s-text>{distributor.name}</s-text>
                        <s-text color="subdued">
                          <NoWrap>{distributor.code}</NoWrap>
                        </s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{distributor.level ?? "—"}</s-table-cell>
                    <s-table-cell>
                      {distributor.active ? (
                        <NoWrap numeric>
                          {distributor.wholesale === null
                            ? "—"
                            : `${formatPercent(distributor.wholesale)} off`}
                        </NoWrap>
                      ) : (
                        <s-badge tone="neutral">inactive</s-badge>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {distributor.active ? (
                        <s-stack direction="inline" justifyContent="end">
                          <s-box inlineSize="120px">
                            <s-number-field
                              label={`Referral discount for ${distributor.name}`}
                              labelAccessibilityVisibility="exclusive"
                              suffix="%"
                              min={0}
                              max={100}
                              step={0.5}
                              placeholder={referral || "default"}
                              value={referralValues[distributor.id] ?? ""}
                              onInput={(event: Event) => {
                                const value = fieldValue(event);
                                setReferralValues((current) => ({
                                  ...current,
                                  [distributor.id]: value,
                                }));
                              }}
                            />
                          </s-box>
                        </s-stack>
                      ) : (
                        <s-text color="subdued">—</s-text>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Wholesale for distributors">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Off every item for a customer linked to an active distributor, once
            they sign in at checkout. Set a rate per level, or leave it blank to
            use the default.
          </s-paragraph>
          <s-box inlineSize="200px">
            <s-number-field
              label="Default wholesale discount"
              suffix="%"
              min={0}
              max={100}
              step={0.5}
              value={wholesale}
              onInput={(event: Event) => setWholesale(fieldValue(event))}
            />
          </s-box>
          {levels.length > 0 ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Level</s-table-header>
                <s-table-header>Distributors</s-table-header>
                <s-table-header format="numeric">
                  Wholesale discount
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {levels.map(({ level, names }) => (
                  <s-table-row key={level}>
                    <s-table-cell>
                      <NoWrap>{level}</NoWrap>
                    </s-table-cell>
                    <s-table-cell>{names.join(", ")}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" justifyContent="end">
                        <s-box inlineSize="120px">
                          <s-number-field
                            label={`${level} wholesale discount`}
                            labelAccessibilityVisibility="exclusive"
                            suffix="%"
                            min={0}
                            max={100}
                            step={0.5}
                            placeholder={wholesale || "default"}
                            value={levelValues[levelKey(level)] ?? ""}
                            onInput={(event: Event) => {
                              const value = fieldValue(event);
                              setLevelValues((current) => ({
                                ...current,
                                [levelKey(level)]: value,
                              }));
                            }}
                          />
                        </s-box>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-paragraph>
              <s-text color="subdued">
                No distributor has a level yet, so everyone gets the default.
              </s-text>
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Status">
        <s-stack direction="block" gap="base">
          {discount ? (
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={statusTone[discount.status] ?? "neutral"}>
                {discount.status.toLowerCase()}
              </s-badge>
              <s-link href={discount.adminUrl} target="_blank">
                {discount.title} in Discounts
              </s-link>
            </s-stack>
          ) : (
            <s-badge tone="neutral">not set up</s-badge>
          )}
          <s-paragraph>
            Changes to distributors in Content → Metaobjects (a new code, a new
            level, someone deactivated) are copied to the discount the next time
            this page or the overview opens.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Make a customer a distributor">
        <s-stack direction="block" gap="base">
          {linkStatus === "ready" ? (
            <s-ordered-list>
              <s-list-item>
                Open the customer in{" "}
                <s-link href="shopify://admin/customers" target="_blank">
                  Customers
                </s-link>
                .
              </s-list-item>
              <s-list-item>
                Under Metafields, set <strong>Distributor</strong> to their
                distributor record.
              </s-list-item>
              <s-list-item>
                When they sign in at checkout, their level&apos;s wholesale
                price applies.
              </s-list-item>
            </s-ordered-list>
          ) : (
            <s-paragraph>
              Saving adds a <strong>Distributor</strong> field to the customer
              page, where you link a customer to their distributor record.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How it is applied">
        <s-paragraph>
          The larger discount wins; referral and wholesale never stack, and a
          distributor cannot use their own code for the referral discount. It
          replaces other product and order discounts, while free-shipping codes
          still combine. Commissions are calculated on what the shopper paid,
          after this discount.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary error={useRouteError()} />;
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
