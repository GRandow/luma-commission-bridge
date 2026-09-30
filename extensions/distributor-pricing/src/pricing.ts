/**
 * The pricing decision, kept free of Shopify's generated types so it can be
 * unit-tested on its own. The Function hands it three things from the
 * checkout and gets back the one discount to apply, if any:
 *
 * - the `ref` cart attribute: a shopper referred by an active distributor
 *   gets the referral discount, at that distributor's own rate or the default;
 * - the signed-in customer's `$app:distributor` metafield: a customer who is
 *   an active distributor buys at wholesale, by level;
 * - the app's config: percentages and the active distributors, written by
 *   the app (`app/domain/pricing.ts` builds the same shape).
 *
 * The larger discount wins; they never stack. A distributor does not get
 * the referral discount through their own code.
 */

export interface PricingDistributor {
  id: string;
  code: string;
  name: string;
  level: string | null;
}

export interface PricingConfig {
  referralPercent: number;
  /** Per distributor, keyed by metaobject GID; missing means the default. */
  referralPercents: Record<string, number>;
  wholesalePercent: number;
  levelPercents: Record<string, number>;
  distributors: PricingDistributor[];
}

export interface Deal {
  kind: "wholesale" | "referral";
  percent: number;
  message: string;
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

/** Same rule as the app and the storefront: trimmed, uppercased, validated. */
export function normalizeReferralCode(
  raw: string | null | undefined,
): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function levelKey(level: string): string {
  return level.trim().toLowerCase().replace(/\s+/g, " ");
}

function isPercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The config from the discount's metafield, or `null` when it is missing or
 * unusable — in which case the Function applies nothing rather than guess.
 */
export function readConfig(value: unknown): PricingConfig | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isPercent(raw.referralPercent) || !isPercent(raw.wholesalePercent)) {
    return null;
  }

  const levelPercents: Record<string, number> = {};
  if (raw.levelPercents && typeof raw.levelPercents === "object") {
    for (const [level, percent] of Object.entries(raw.levelPercents)) {
      if (isPercent(percent)) levelPercents[levelKey(level)] = percent;
    }
  }

  const referralPercents: Record<string, number> = {};
  if (raw.referralPercents && typeof raw.referralPercents === "object") {
    for (const [id, percent] of Object.entries(raw.referralPercents)) {
      if (isPercent(percent)) referralPercents[id] = percent;
    }
  }

  const distributors: PricingDistributor[] = [];
  if (Array.isArray(raw.distributors)) {
    for (const entry of raw.distributors as Array<Record<string, unknown>>) {
      const code = normalizeReferralCode(
        typeof entry?.code === "string" ? entry.code : null,
      );
      if (!entry || !isText(entry.id) || !code || !isText(entry.name)) {
        continue;
      }
      distributors.push({
        id: entry.id,
        code,
        name: entry.name.trim(),
        level: isText(entry.level) ? entry.level.trim() : null,
      });
    }
  }

  return {
    referralPercent: raw.referralPercent,
    referralPercents,
    wholesalePercent: raw.wholesalePercent,
    levelPercents,
    distributors,
  };
}

function formatPercent(percent: number): string {
  return `${Number(percent.toFixed(2))}%`;
}

/**
 * Which discount this checkout gets.
 *
 * @param refCode the `ref` cart attribute, as the storefront or the checkout wrote it
 * @param customerDistributorId the metaobject GID in the customer's `$app:distributor` metafield
 */
export function chooseDeal(
  config: PricingConfig,
  refCode: string | null | undefined,
  customerDistributorId: string | null | undefined,
): Deal | null {
  const deals: Deal[] = [];

  const self = customerDistributorId
    ? config.distributors.find(
        (distributor) => distributor.id === customerDistributorId,
      )
    : undefined;
  if (self) {
    const percent =
      (self.level ? config.levelPercents[levelKey(self.level)] : undefined) ??
      config.wholesalePercent;
    deals.push({
      kind: "wholesale",
      percent,
      message: `Distributor price${self.level ? ` (${self.level})` : ""}: ${formatPercent(percent)} off`,
    });
  }

  const code = normalizeReferralCode(refCode);
  const referrer = code
    ? config.distributors.find((distributor) => distributor.code === code)
    : undefined;
  if (referrer && referrer.id !== self?.id) {
    const percent =
      config.referralPercents[referrer.id] ?? config.referralPercent;
    deals.push({
      kind: "referral",
      percent,
      message: `Referred by ${referrer.name}: ${formatPercent(percent)} off`,
    });
  }

  // The larger discount wins; on a tie, wholesale (listed first) is kept.
  const best = deals.reduce<Deal | null>(
    (winner, deal) =>
      !winner || deal.percent > winner.percent ? deal : winner,
    null,
  );
  return best && best.percent > 0 ? best : null;
}
