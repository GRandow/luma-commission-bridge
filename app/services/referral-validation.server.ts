import { normalizeReferralCode } from "../domain/attribution";
import { unauthenticated } from "../shopify.server";
import type { AdminGraphql } from "./admin-graphql.server";
import { findDistributorByCode, type Distributor } from "./distributors.server";

/**
 * Answers the checkout extension's "is this code real?" before the buyer
 * pays. It says only whether the code belongs to an active distributor and
 * that distributor's name — never the rate or anything else about them.
 * The pipeline still makes its own decision when the order is paid; this
 * is a courtesy to the buyer, not the source of truth.
 */

export interface ReferralValidation {
  /** The normalized code that was checked, or `null` when the input was not a code at all. */
  code: string | null;
  valid: boolean;
  /** The distributor's display name when the code is valid. */
  name: string | null;
}

export interface ValidationDeps {
  getAdmin: (shop: string) => Promise<AdminGraphql>;
  findDistributorByCode: (
    client: AdminGraphql,
    code: string,
  ) => Promise<Distributor | null>;
}

const defaultDeps: ValidationDeps = {
  getAdmin: async (shop) => (await unauthenticated.admin(shop)).admin,
  findDistributorByCode,
};

/**
 * The shop named by a session token's `dest` claim. Admin tokens carry
 * `https://shop.myshopify.com`; checkout extension tokens carry the bare
 * `shop.myshopify.com`. Both are accepted.
 */
export function shopFromDest(dest: string): string {
  return dest.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export async function validateReferralCode(
  shop: string,
  rawCode: string | null | undefined,
  deps: ValidationDeps = defaultDeps,
): Promise<ReferralValidation> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return { code: null, valid: false, name: null };

  const admin = await deps.getAdmin(shop);
  const distributor = await deps.findDistributorByCode(admin, code);
  if (!distributor || !distributor.active) {
    return { code, valid: false, name: null };
  }
  return { code, valid: true, name: distributor.name };
}
