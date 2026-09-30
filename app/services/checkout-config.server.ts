import {
  assertNoUserErrors,
  runGraphql,
  type AdminGraphql,
  type UserError,
} from "./admin-graphql.server";

/**
 * How the checkout extension finds this app. An extension is served by
 * Shopify and knows nothing about where the app runs, so the app leaves its
 * own address in an app-owned shop metafield that the extension declares in
 * its `shopify.extension.toml` and reads through `appMetafields`. In
 * development the tunnel URL changes on every `shopify app dev`; opening
 * the dashboard once refreshes the value.
 */

export const CHECKOUT_CONFIG_NAMESPACE = "$app";
export const CHECKOUT_CONFIG_KEY = "checkout_api";

export interface CheckoutConfig {
  /** Absolute URL of the referral-code validation endpoint. */
  validateUrl: string;
}

export function buildCheckoutConfig(appUrl: string): CheckoutConfig {
  return { validateUrl: `${appUrl.replace(/\/$/, "")}/api/referral/validate` };
}

const SHOP_CONFIG_QUERY = `#graphql
  query ShopCheckoutConfig($namespace: String!, $key: String!) {
    shop {
      id
      metafield(namespace: $namespace, key: $key) {
        value
      }
    }
  }
`;

const SET_CONFIG_MUTATION = `#graphql
  mutation SetCheckoutConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors {
        field
        message
      }
    }
  }
`;

let syncedFor: string | null = null;

/**
 * Makes sure the shop metafield holds the current app URL. Cheap: once the
 * value matches for a given URL, later calls in the same process return
 * without touching the API.
 */
export async function ensureCheckoutConfig(
  client: AdminGraphql,
  appUrl: string,
): Promise<"unchanged" | "updated"> {
  if (!appUrl) return "unchanged";
  const wanted = JSON.stringify(buildCheckoutConfig(appUrl));
  if (syncedFor === wanted) return "unchanged";

  const data = await runGraphql<{
    shop: { id: string; metafield: { value: string } | null };
  }>(client, SHOP_CONFIG_QUERY, {
    namespace: CHECKOUT_CONFIG_NAMESPACE,
    key: CHECKOUT_CONFIG_KEY,
  });

  if (data.shop.metafield?.value === wanted) {
    syncedFor = wanted;
    return "unchanged";
  }

  const result = await runGraphql<{
    metafieldsSet: { userErrors: UserError[] };
  }>(client, SET_CONFIG_MUTATION, {
    metafields: [
      {
        ownerId: data.shop.id,
        namespace: CHECKOUT_CONFIG_NAMESPACE,
        key: CHECKOUT_CONFIG_KEY,
        type: "json",
        value: wanted,
      },
    ],
  });
  assertNoUserErrors(result.metafieldsSet.userErrors, "Checkout config");
  syncedFor = wanted;
  return "updated";
}

/** For tests: forget what was synced. */
export function resetCheckoutConfigCache(): void {
  syncedFor = null;
}
