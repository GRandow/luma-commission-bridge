import { describe, expect, it } from "vitest";
import { isPayable, resolveCommission } from "./resolve-commission";

const ana = {
  id: "gid://shopify/Metaobject/1",
  code: "ANA123",
  name: "Ana Souza",
  rateBps: 1250,
  active: true,
};

describe("resolveCommission", () => {
  it("applies the distributor's own rate when the code matches", () => {
    expect(
      resolveCommission({
        referralCode: "ANA123",
        distributor: ana,
        baseCents: 4200,
      }),
    ).toEqual({
      status: "calculated",
      rateBps: 1250,
      amountCents: 525,
      distributorId: ana.id,
      distributorName: "Ana Souza",
    });
  });

  it("keeps orders without a code visible as unattributed", () => {
    const result = resolveCommission({
      referralCode: null,
      distributor: null,
      baseCents: 4200,
    });
    expect(result.status).toBe("unattributed");
    expect(result.rateBps).toBe(1000);
    expect(result.distributorId).toBeNull();
  });

  it("flags a code that matches nobody instead of dropping it", () => {
    const result = resolveCommission({
      referralCode: "NOPE1",
      distributor: null,
      baseCents: 4200,
    });
    expect(result.status).toBe("unknown_distributor");
    expect(result.amountCents).toBe(420);
  });

  it("does not pay a distributor who was switched off", () => {
    const result = resolveCommission({
      referralCode: "ANA123",
      distributor: { ...ana, active: false },
      baseCents: 4200,
    });
    expect(result.status).toBe("inactive_distributor");
    expect(result.distributorName).toBe("Ana Souza");
    expect(isPayable(result.status)).toBe(false);
    expect(isPayable("calculated")).toBe(true);
    expect(isPayable("written_back")).toBe(true);
  });
});
