/**
 * Commission rules. Rates are basis points (1000 = 10%) so that, like money,
 * they are integers; the calculation never touches floating point.
 */

/** Applied while the order's distributor (and their own rate) is unknown. */
export const DEFAULT_RATE_BPS = 1000;

export interface CommissionInput {
  /** Commissionable amount in cents: line items after discounts, before shipping and tax. */
  baseCents: number;
  rateBps: number;
}

export interface CommissionResult extends CommissionInput {
  amountCents: number;
}

/** Commission in cents, rounded half up, never negative. */
export function calculateCommission({
  baseCents,
  rateBps,
}: CommissionInput): CommissionResult {
  if (!Number.isInteger(baseCents) || !Number.isInteger(rateBps)) {
    throw new TypeError("Cents and basis points must be integers");
  }
  if (rateBps < 0 || rateBps > 10_000) {
    throw new RangeError("Rate must be between 0 and 10000 basis points");
  }
  const amountCents =
    baseCents <= 0 ? 0 : Math.floor((baseCents * rateBps + 5_000) / 10_000);
  return { baseCents, rateBps, amountCents };
}

/** 1250 → "12.5%" */
export function formatRate(rateBps: number): string {
  const percent = rateBps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, "")}%`;
}
