import { describe, expect, it, vi } from "vitest";
import type { AdminGraphql } from "./admin-graphql.server";
import type { Distributor } from "./distributors.server";
import {
  shopFromDest,
  validateReferralCode,
  type ValidationDeps,
} from "./referral-validation.server";

vi.mock("../shopify.server", () => ({ unauthenticated: { admin: vi.fn() } }));

const admin = { graphql: vi.fn() } as unknown as AdminGraphql;

const ana: Distributor = {
  id: "gid://shopify/Metaobject/1",
  handle: "ana123",
  code: "ANA123",
  name: "Ana Souza",
  level: "silver",
  rateBps: 1000,
  active: true,
};

function deps(overrides: Partial<ValidationDeps> = {}): ValidationDeps {
  return {
    getAdmin: vi.fn().mockResolvedValue(admin),
    findDistributorByCode: vi.fn().mockResolvedValue(ana),
    ...overrides,
  };
}

describe("validateReferralCode", () => {
  it("returns the distributor's name for an active code, normalized", async () => {
    const d = deps();

    await expect(
      validateReferralCode("luma-dev.myshopify.com", " ana123 ", d),
    ).resolves.toEqual({ code: "ANA123", valid: true, name: "Ana Souza" });
    expect(d.getAdmin).toHaveBeenCalledWith("luma-dev.myshopify.com");
    expect(d.findDistributorByCode).toHaveBeenCalledWith(admin, "ANA123");
  });

  it("rejects unknown and inactive codes without saying which", async () => {
    await expect(
      validateReferralCode(
        "luma-dev.myshopify.com",
        "NOPE99",
        deps({ findDistributorByCode: vi.fn().mockResolvedValue(null) }),
      ),
    ).resolves.toEqual({ code: "NOPE99", valid: false, name: null });

    await expect(
      validateReferralCode(
        "luma-dev.myshopify.com",
        "ANA123",
        deps({
          findDistributorByCode: vi
            .fn()
            .mockResolvedValue({ ...ana, active: false }),
        }),
      ),
    ).resolves.toEqual({ code: "ANA123", valid: false, name: null });
  });

  it("does not touch the Admin API for something that is not a code", async () => {
    const d = deps();

    await expect(
      validateReferralCode("luma-dev.myshopify.com", "not a code", d),
    ).resolves.toEqual({ code: null, valid: false, name: null });
    expect(d.getAdmin).not.toHaveBeenCalled();
  });
});

describe("shopFromDest", () => {
  it("accepts the admin and the checkout forms of the claim", () => {
    expect(shopFromDest("https://luma-dev.myshopify.com")).toBe(
      "luma-dev.myshopify.com",
    );
    expect(shopFromDest("luma-dev.myshopify.com")).toBe(
      "luma-dev.myshopify.com",
    );
    expect(shopFromDest("https://luma-dev.myshopify.com/admin")).toBe(
      "luma-dev.myshopify.com",
    );
  });
});
