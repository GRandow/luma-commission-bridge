/**
 * Asks the app whether a code belongs to an active distributor, so the buyer
 * hears about a typo before paying instead of the merchant finding an
 * "unknown code" on the dashboard afterwards.
 *
 * The app's address comes from an app-owned shop metafield the app keeps up
 * to date (see `checkout-config.server.ts`); the request carries the session
 * token Shopify issues to the extension, which the app verifies.
 *
 * The lookup is a courtesy, not a gate: when the app cannot be reached the
 * code is still applied, and the order is attributed when it is processed.
 */

export const CONFIG_NAMESPACE = "$app";
export const CONFIG_KEY = "checkout_api";

/**
 * @typedef {{ status: "valid", name: string | null } | { status: "invalid" } | { status: "unavailable" }} LookupResult
 */

/**
 * Finds the app's checkout config among the metafields the extension declared.
 *
 * @param {ReadonlyArray<{ target: { type: string }, metafield: { namespace: string, key: string, value: string } }>} appMetafields
 * @returns {{ validateUrl: string } | null}
 */
export function readCheckoutConfig(appMetafields) {
  const entry = appMetafields.find(
    ({ target, metafield }) =>
      target.type === "shop" &&
      metafield.namespace === CONFIG_NAMESPACE &&
      metafield.key === CONFIG_KEY,
  );
  if (!entry) return null;
  try {
    const parsed = JSON.parse(entry.metafield.value);
    return typeof parsed?.validateUrl === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ validateUrl: string | undefined, code: string, getToken: () => Promise<string>, fetchImpl?: typeof fetch }} input
 * @returns {Promise<LookupResult>}
 */
export async function lookupReferralCode({
  validateUrl,
  code,
  getToken,
  fetchImpl = fetch,
}) {
  if (!validateUrl) return { status: "unavailable" };
  try {
    const token = await getToken();
    const url = new URL(validateUrl);
    url.searchParams.set("code", code);
    const response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) return { status: "unavailable" };
    const body = await response.json();
    return body.valid
      ? {
          status: "valid",
          name: typeof body.name === "string" ? body.name : null,
        }
      : { status: "invalid" };
  } catch {
    return { status: "unavailable" };
  }
}
