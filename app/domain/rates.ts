import { centsToMoneyString, parseMoneyToCents } from "./money";

/**
 * Commission rates travel as basis points inside the app (1250 = 12.5%) and
 * as decimal percentages ("12.5") in Shopify metafields, where merchants
 * edit them. A percentage with two decimals maps to basis points exactly the
 * way a money amount maps to cents, so the money parser does the work.
 */

/** "12.5" → 1250. Rejects anything outside 0–100%. */
export function parsePercentToBps(
  value: string | number | null | undefined,
): number {
  const bps = parseMoneyToCents(value);
  if (bps < 0 || bps > 10_000) {
    throw new RangeError(`Commission rate out of range: ${String(value)}%`);
  }
  return bps;
}

/** 1250 → "12.50", the value stored in a `number_decimal` metafield. */
export function bpsToPercentString(rateBps: number): string {
  return centsToMoneyString(rateBps);
}
