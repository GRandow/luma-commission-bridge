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

/** Pauses between attempts when the app does not answer. */
export const RETRY_DELAYS_MS = [1500, 4000];

/**
 * `lookupReferralCode`, asked again when the app does not answer: a dev
 * tunnel drops a request now and then, and one dropped request should not
 * leave the banner without the distributor's name. A definite answer (valid
 * or invalid) is returned at once; `isCancelled` stops the retries when the
 * code changes or the extension goes away.
 *
 * @param {Parameters<typeof lookupReferralCode>[0]} input
 * @param {{ delaysMs?: number[], sleep?: (ms: number) => Promise<void>, isCancelled?: () => boolean }} [options]
 * @returns {Promise<LookupResult>}
 */
export async function lookupWithRetry(
  input,
  {
    delaysMs = RETRY_DELAYS_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isCancelled = () => false,
  } = {},
) {
  let result = await lookupReferralCode(input);
  for (const delay of delaysMs) {
    if (result.status !== "unavailable" || isCancelled()) break;
    await sleep(delay);
    if (isCancelled()) break;
    result = await lookupReferralCode(input);
  }
  return result;
}
