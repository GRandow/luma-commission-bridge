import { calculateCommission, DEFAULT_RATE_BPS } from "./commission";

/**
 * Attribution outcome for one paid order. Kept pure so the rules are easy
 * to test and to read: which rate applies, and what the merchant sees.
 *
 * - `unattributed`: the order carried no referral code.
 * - `unknown_distributor`: a code was present but matches no distributor;
 *   the default rate is applied so the amount is visible, and the status
 *   flags it for review.
 * - `inactive_distributor`: the distributor exists but is switched off.
 * - `calculated`: attributed to an active distributor at their own rate.
 */
export type CommissionStatus =
  | "unattributed"
  | "unknown_distributor"
  | "inactive_distributor"
  | "calculated"
  | "written_back";

export interface DistributorLike {
  id: string;
  code: string;
  name: string;
  rateBps: number;
  active: boolean;
}

export interface ResolveInput {
  referralCode: string | null;
  distributor: DistributorLike | null;
  baseCents: number;
}

export interface ResolvedCommission {
  status: CommissionStatus;
  rateBps: number;
  amountCents: number;
  distributorId: string | null;
  distributorName: string | null;
}

export function resolveCommission({
  referralCode,
  distributor,
  baseCents,
}: ResolveInput): ResolvedCommission {
  if (!referralCode) {
    const { rateBps, amountCents } = calculateCommission({
      baseCents,
      rateBps: DEFAULT_RATE_BPS,
    });
    return {
      status: "unattributed",
      rateBps,
      amountCents,
      distributorId: null,
      distributorName: null,
    };
  }
  if (!distributor) {
    const { rateBps, amountCents } = calculateCommission({
      baseCents,
      rateBps: DEFAULT_RATE_BPS,
    });
    return {
      status: "unknown_distributor",
      rateBps,
      amountCents,
      distributorId: null,
      distributorName: null,
    };
  }
  const { rateBps, amountCents } = calculateCommission({
    baseCents,
    rateBps: distributor.rateBps,
  });
  return {
    status: distributor.active ? "calculated" : "inactive_distributor",
    rateBps,
    amountCents,
    distributorId: distributor.id,
    distributorName: distributor.name,
  };
}

/** Only attributed, active commissions are written to the order and paid out. */
export function isPayable(status: CommissionStatus): boolean {
  return status === "calculated" || status === "written_back";
}
