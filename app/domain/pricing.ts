import { parsePercentToBps } from "./rates";

/**
 * Distributor pricing: what the `distributor-pricing` Shopify Function
 * charges at checkout.
 *
 * - A shopper referred by an active distributor (the `ref` cart attribute)
 *   gets the referral discount: that distributor's own rate, or the default.
 * - A customer linked to an active distributor (the `$app:distributor`
 *   customer metafield) buys at wholesale, by the distributor's level.
 * - When both apply, the larger discount wins; they never stack.
 *
 * The Function cannot call the app or read metaobjects, so the app hands it
 * everything it needs in one JSON metafield on the discount: the merchant's
 * percentages plus the active distributors. `PricingConfig` is that
 * contract; `extensions/distributor-pricing/src/pricing.ts` reads it.
 */

export const PRICING_CONFIG_VERSION = 1;

export interface PricingSettings {
  /** Off every line for a shopper referred by an active distributor without a rate of their own. */
  referralPercent: number;
  /** Referral discount per distributor, keyed by metaobject GID (stable if the code changes). */
  referralPercents: Record<string, number>;
  /** Wholesale for a linked customer whose level has no rate of its own. */
  wholesalePercent: number;
  /** Wholesale by level; keys are normalized with `levelKey`. */
  levelPercents: Record<string, number>;
}

export interface PricingDistributor {
  /** Metaobject GID: what the customer metafield points to. */
  id: string;
  code: string;
  name: string;
  level: string | null;
}

export interface PricingConfig extends PricingSettings {
  version: typeof PRICING_CONFIG_VERSION;
  /** Active distributors only: an inactive code earns nobody a discount. */
  distributors: PricingDistributor[];
}

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  referralPercent: 10,
  referralPercents: {},
  wholesalePercent: 20,
  levelPercents: {},
};

/** "  Team   Leader " → "team leader", so a level matches however it was typed. */
export function levelKey(level: string): string {
  return level.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The levels in use, in their first-seen spelling, sorted. Distributors without a level are left out. */
export function distinctLevels(
  distributors: Array<{ level: string | null }>,
): string[] {
  const byKey = new Map<string, string>();
  for (const { level } of distributors) {
    const trimmed = level?.trim();
    if (trimmed && !byKey.has(levelKey(trimmed))) {
      byKey.set(levelKey(trimmed), trimmed);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** The referral discount a distributor's shoppers get: their own rate, or the default. */
export function referralPercentFor(
  settings: PricingSettings,
  distributorId: string,
): number {
  return settings.referralPercents[distributorId] ?? settings.referralPercent;
}

/** The wholesale discount for a level: its own rate, or the default. */
export function wholesalePercentFor(
  settings: PricingSettings,
  level: string | null,
): number {
  if (level) {
    const own = settings.levelPercents[levelKey(level)];
    if (own !== undefined) return own;
  }
  return settings.wholesalePercent;
}

export function buildPricingConfig(
  settings: PricingSettings,
  distributors: Array<PricingDistributor & { active: boolean }>,
): PricingConfig {
  // Rates of distributors that no longer exist are dropped; an inactive
  // distributor keeps theirs for when they come back.
  const known = new Set(distributors.map((distributor) => distributor.id));
  return {
    version: PRICING_CONFIG_VERSION,
    referralPercent: settings.referralPercent,
    referralPercents: Object.fromEntries(
      Object.entries(settings.referralPercents).filter(([id]) => known.has(id)),
    ),
    wholesalePercent: settings.wholesalePercent,
    levelPercents: { ...settings.levelPercents },
    distributors: distributors
      .filter((distributor) => distributor.active)
      .map(({ id, code, name, level }) => ({ id, code, name, level })),
  };
}

/** A form value as a percentage: "12.5" → 12.5; `null` when blank. Throws when out of range. */
export function parsePercentInput(
  raw: FormDataEntryValue | string | null | undefined,
): number | null {
  const text = typeof raw === "string" ? raw.trim().replace(/%$/, "") : "";
  if (!text) return null;
  try {
    return parsePercentToBps(text) / 100;
  } catch {
    throw new RangeError(`"${text}" is not a percentage between 0 and 100.`);
  }
}

function isPercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

/**
 * The merchant's settings back out of a stored config. Anything missing or
 * malformed falls back to the defaults, so a hand-edited metafield can never
 * break the pricing page.
 */
export function settingsFromConfig(value: unknown): PricingSettings {
  const config = (value && typeof value === "object" ? value : {}) as Partial<
    Record<keyof PricingSettings, unknown>
  >;
  const levelPercents: Record<string, number> = {};
  if (config.levelPercents && typeof config.levelPercents === "object") {
    for (const [level, percent] of Object.entries(config.levelPercents)) {
      if (isPercent(percent)) levelPercents[levelKey(level)] = percent;
    }
  }
  const referralPercents: Record<string, number> = {};
  if (config.referralPercents && typeof config.referralPercents === "object") {
    for (const [id, percent] of Object.entries(config.referralPercents)) {
      if (isPercent(percent)) referralPercents[id] = percent;
    }
  }
  return {
    referralPercent: isPercent(config.referralPercent)
      ? config.referralPercent
      : DEFAULT_PRICING_SETTINGS.referralPercent,
    referralPercents,
    wholesalePercent: isPercent(config.wholesalePercent)
      ? config.wholesalePercent
      : DEFAULT_PRICING_SETTINGS.wholesalePercent,
    levelPercents,
  };
}

/** 12.5 → "12.5%", 20 → "20%". */
export function formatPercent(percent: number): string {
  return `${Number(percent.toFixed(2))}%`;
}

/**
 * The pricing form as posted: percentages as typed, level rates keyed by
 * level name, referral rates keyed by distributor GID.
 */
export interface PricingForm {
  referralPercent: string;
  referralPercents: Record<string, string>;
  wholesalePercent: string;
  levelPercents: Record<string, string>;
}

/** A percentage field that may be blank, with the field's name in the error. */
function optionalPercent(label: string, raw: string): number | null {
  try {
    return parsePercentInput(raw);
  } catch (error) {
    throw new RangeError(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Validates the form; a blank level or distributor rate means "use the
 * default". `names` labels the distributor rates in error messages.
 */
export function settingsFromForm(
  form: PricingForm,
  names: Record<string, string> = {},
): PricingSettings {
  const referralPercent = parsePercentInput(form.referralPercent);
  if (referralPercent === null) {
    throw new RangeError("Enter the referral discount (0 turns it off).");
  }
  const wholesalePercent = parsePercentInput(form.wholesalePercent);
  if (wholesalePercent === null) {
    throw new RangeError("Enter the default wholesale discount.");
  }
  const referralPercents: Record<string, number> = {};
  for (const [id, raw] of Object.entries(form.referralPercents)) {
    const percent = optionalPercent(names[id] ?? id, raw);
    if (percent !== null) referralPercents[id] = percent;
  }
  const levelPercents: Record<string, number> = {};
  for (const [level, raw] of Object.entries(form.levelPercents)) {
    const percent = optionalPercent(level, raw);
    if (percent !== null) levelPercents[levelKey(level)] = percent;
  }
  return { referralPercent, referralPercents, wholesalePercent, levelPercents };
}
