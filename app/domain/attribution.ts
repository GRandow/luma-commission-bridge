/**
 * Order attribution: which distributor gets credit for a sale.
 *
 * The storefront writes the distributor's code on the cart as the `ref`
 * attribute (see luma-shopify-storefront, `features/referral`). Shopify copies
 * cart attributes onto the order as note attributes, which is where this
 * module reads it back. The code format mirrors the storefront's validation,
 * so a value that reaches here either matches a distributor or is garbage.
 */

export const REFERRAL_ATTRIBUTE_KEY = "ref";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

export interface NoteAttribute {
  name: string;
  value: string | null;
}

/** Uppercases and validates a raw code; `null` when it is not usable. */
export function normalizeReferralCode(
  raw: string | null | undefined,
): string | null {
  const code = raw?.trim().toUpperCase() ?? "";
  return CODE_PATTERN.test(code) ? code : null;
}

/** The referral code carried by the order's note attributes, if any. */
export function extractReferralCode(
  noteAttributes: NoteAttribute[] | null | undefined,
): string | null {
  const attribute = noteAttributes?.find(
    (entry) => entry.name.trim().toLowerCase() === REFERRAL_ATTRIBUTE_KEY,
  );
  return normalizeReferralCode(attribute?.value);
}
