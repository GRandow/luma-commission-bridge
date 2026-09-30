import {
  buildPricingConfig,
  settingsFromConfig,
  type PricingConfig,
  type PricingDistributor,
  type PricingSettings,
} from "../domain/pricing";
import {
  assertNoUserErrors,
  runGraphql,
  type AdminGraphql,
  type UserError,
} from "./admin-graphql.server";

/**
 * The automatic discount that runs the `distributor-pricing` Function.
 *
 * One discount per shop, created from the pricing page. Its configuration
 * lives in an app-owned JSON metafield on the discount itself, which is
 * also how the app recognises its discount among the shop's others (only
 * this app can write the `$app` namespace). The merchant can still pause,
 * reschedule or delete it in Discounts like any other discount.
 */

export const PRICING_FUNCTION_HANDLE = "distributor-pricing";
export const PRICING_CONFIG_NAMESPACE = "$app";
export const PRICING_CONFIG_KEY = "pricing_config";
export const PRICING_DISCOUNT_TITLE = "Distributor pricing";

export interface PricingDiscount {
  /** `gid://shopify/DiscountAutomaticNode/…` */
  id: string;
  title: string;
  /** ACTIVE, SCHEDULED or EXPIRED. */
  status: string;
  metafieldId: string;
  config: unknown;
}

export interface PricingState {
  discount: PricingDiscount | null;
  settings: PricingSettings;
}

const FIND_QUERY = /* GraphQL */ `
  query PricingDiscount($namespace: String!, $key: String!, $search: String) {
    discountNodes(first: 100, query: $search) {
      nodes {
        id
        metafield(namespace: $namespace, key: $key) {
          id
          jsonValue
        }
        discount {
          __typename
          ... on DiscountAutomaticApp {
            discountId
            title
            status
          }
        }
      }
    }
  }
`;

const CREATE_MUTATION = /* GraphQL */ `
  mutation CreatePricingDiscount($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount {
        discountId
        title
        status
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const UPDATE_MUTATION = /* GraphQL */ `
  mutation UpdatePricingConfig(
    $id: ID!
    $discount: DiscountAutomaticAppInput!
  ) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
      automaticAppDiscount {
        discountId
        title
        status
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

interface DiscountNodeData {
  id: string;
  metafield: { id: string; jsonValue: unknown } | null;
  discount: {
    __typename: string;
    discountId?: string;
    title?: string;
    status?: string;
  };
}

interface DiscountPayload {
  automaticAppDiscount: {
    discountId: string;
    title: string;
    status: string;
  } | null;
  userErrors: UserError[];
}

/** JSON with sorted keys, so two configs compare equal whatever order Shopify returns them in. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function searchDiscounts(
  client: AdminGraphql,
  search: string | null,
): Promise<DiscountNodeData[]> {
  const data = await runGraphql<{
    discountNodes: { nodes: DiscountNodeData[] };
  }>(client, FIND_QUERY, {
    namespace: PRICING_CONFIG_NAMESPACE,
    key: PRICING_CONFIG_KEY,
    search,
  });
  return data.discountNodes.nodes;
}

export async function findPricingDiscount(
  client: AdminGraphql,
): Promise<PricingDiscount | null> {
  // Narrow to automatic app discounts; if that search comes back empty, look
  // once more without it, so a search-syntax surprise can never make the app
  // think its discount is missing and create a second one.
  let nodes = await searchDiscounts(client, "method:automatic AND type:app");
  if (nodes.length === 0) nodes = await searchDiscounts(client, null);
  const node = nodes.find(
    (candidate) =>
      candidate.metafield !== null &&
      candidate.discount.__typename === "DiscountAutomaticApp",
  );
  if (!node?.metafield) return null;
  return {
    id: node.discount.discountId ?? node.id,
    title: node.discount.title ?? PRICING_DISCOUNT_TITLE,
    status: node.discount.status ?? "ACTIVE",
    metafieldId: node.metafield.id,
    config: node.metafield.jsonValue,
  };
}

export async function loadPricing(client: AdminGraphql): Promise<PricingState> {
  const discount = await findPricingDiscount(client);
  return { discount, settings: settingsFromConfig(discount?.config) };
}

function assertDiscount(payload: DiscountPayload, context: string) {
  assertNoUserErrors(payload.userErrors, context);
  if (!payload.automaticAppDiscount) {
    throw new Error(`${context}: Shopify returned no discount`);
  }
  return payload.automaticAppDiscount;
}

async function writeConfig(
  client: AdminGraphql,
  discount: PricingDiscount,
  config: PricingConfig,
): Promise<void> {
  const data = await runGraphql<{
    discountAutomaticAppUpdate: DiscountPayload;
  }>(client, UPDATE_MUTATION, {
    id: discount.id,
    discount: {
      metafields: [{ id: discount.metafieldId, value: JSON.stringify(config) }],
    },
  });
  assertDiscount(data.discountAutomaticAppUpdate, "Update distributor pricing");
}

type Distributors = Array<PricingDistributor & { active: boolean }>;

/**
 * Saves the merchant's percentages and the current distributors: updates the
 * app's discount, or creates it (live from now) the first time.
 */
export async function savePricing(
  client: AdminGraphql,
  settings: PricingSettings,
  distributors: Distributors,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const config = buildPricingConfig(settings, distributors);
  const existing = await findPricingDiscount(client);
  if (existing) {
    await writeConfig(client, existing, config);
    return { created: false };
  }

  const data = await runGraphql<{
    discountAutomaticAppCreate: DiscountPayload;
  }>(client, CREATE_MUTATION, {
    discount: {
      title: PRICING_DISCOUNT_TITLE,
      functionHandle: PRICING_FUNCTION_HANDLE,
      discountClasses: ["PRODUCT"],
      startsAt: now.toISOString(),
      // Distributor prices replace other product and order discounts;
      // a free-shipping code still works on top.
      combinesWith: {
        productDiscounts: false,
        orderDiscounts: false,
        shippingDiscounts: true,
      },
      metafields: [
        {
          namespace: PRICING_CONFIG_NAMESPACE,
          key: PRICING_CONFIG_KEY,
          type: "json",
          value: JSON.stringify(config),
        },
      ],
    },
  });
  assertDiscount(data.discountAutomaticAppCreate, "Create distributor pricing");
  return { created: true };
}

/**
 * Keeps the discount's list of distributors current. The Function only
 * knows what the config says, so a distributor deactivated or moved to
 * another level in Content → Metaobjects must be copied over; the admin
 * pages call this on load. Cheap when nothing changed: one read, no write.
 */
export async function syncPricingDistributors(
  client: AdminGraphql,
  distributors: Distributors,
  state?: PricingState,
): Promise<"not-set-up" | "unchanged" | "updated"> {
  const { discount, settings } = state ?? (await loadPricing(client));
  if (!discount) return "not-set-up";
  const wanted = buildPricingConfig(settings, distributors);
  if (stableStringify(wanted) === stableStringify(discount.config)) {
    return "unchanged";
  }
  await writeConfig(client, discount, wanted);
  return "updated";
}

/** `gid://shopify/DiscountAutomaticNode/123` → the discount's page in the admin. */
export function discountAdminUrl(discountId: string): string {
  return `shopify://admin/discounts/${discountId.split("/").pop() ?? ""}`;
}
