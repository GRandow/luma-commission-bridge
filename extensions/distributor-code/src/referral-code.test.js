import { describe, expect, it } from "vitest";
import { normalizeReferralCode, REFERRAL_ATTRIBUTE_KEY } from "./referral-code";

describe("normalizeReferralCode (checkout extension)", () => {
  it("uses the same attribute key as the storefront and the app", () => {
    expect(REFERRAL_ATTRIBUTE_KEY).toBe("ref");
  });

  it("normalizes codes and rejects unusable ones", () => {
    expect(normalizeReferralCode(" ana123 ")).toBe("ANA123");
    expect(normalizeReferralCode("team_br-01")).toBe("TEAM_BR-01");
    expect(normalizeReferralCode("a")).toBeNull();
    expect(normalizeReferralCode("has space")).toBeNull();
    expect(normalizeReferralCode("<script>")).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });
});
