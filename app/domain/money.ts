/**
 * Money is handled as integer cents. Shopify sends amounts as decimal
 * strings ("42.10"); parsing them with floating point would eventually pay a
 * distributor a cent too much or too little.
 */

const MONEY_PATTERN = /^(-)?(\d+)(?:\.(\d*))?$/;

/** "42.10" → 4210. Extra decimals beyond cents are truncated. */
export function parseMoneyToCents(
  value: string | number | null | undefined,
): number {
  if (value === null || value === undefined || value === "") return 0;
  const text = String(value).trim();
  const match = MONEY_PATTERN.exec(text);
  if (!match) throw new TypeError(`Not a money amount: "${text}"`);
  const [, sign, whole, fraction = ""] = match;
  const cents =
    Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  return sign ? -cents : cents;
}

/** 4210 → "42.10", the shape Shopify's money inputs expect. */
export function centsToMoneyString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function formatCents(
  cents: number,
  currency: string,
  locale = "en-US",
): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    cents / 100,
  );
}
