import { describe, expect, it } from "vitest";
import { extractReferralCode, normalizeReferralCode } from "./attribution";

describe("attribution", () => {
  it("normalizes codes the same way the storefront does", () => {
    expect(normalizeReferralCode(" ana123 ")).toBe("ANA123");
    expect(normalizeReferralCode("team_br-01")).toBe("TEAM_BR-01");
    expect(normalizeReferralCode("a")).toBeNull();
    expect(normalizeReferralCode("has space")).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });

  it("reads the ref note attribute from an order payload", () => {
    expect(
      extractReferralCode([
        { name: "gift_message", value: "Happy birthday" },
        { name: "ref", value: "ana123" },
      ]),
    ).toBe("ANA123");
    expect(extractReferralCode([{ name: "REF ", value: "x-1" }])).toBe("X-1");
  });

  it("returns null when the order carries no usable code", () => {
    expect(extractReferralCode([])).toBeNull();
    expect(extractReferralCode(null)).toBeNull();
    expect(extractReferralCode([{ name: "ref", value: null }])).toBeNull();
    expect(
      extractReferralCode([{ name: "ref", value: "<script>" }]),
    ).toBeNull();
  });
});
