/**
 * The cart attribute that carries the distributor's code. The storefront
 * writes the same key, Shopify copies it onto the order as a note attribute,
 * and the app reads it from there — so the checkout is just one more way in.
 */
export const REFERRAL_ATTRIBUTE_KEY = "ref";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

/**
 * Uppercases and validates a raw code; `null` when it is not usable.
 * Only the format is checked here: whether the code belongs to an active
 * distributor is decided when the order is processed.
 *
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normalizeReferralCode(raw) {
  const code = (raw ?? "").trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}
