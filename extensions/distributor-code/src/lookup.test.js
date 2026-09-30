import { describe, expect, it, vi } from "vitest";
import { lookupReferralCode, readCheckoutConfig } from "./lookup";

const config = {
  target: { type: "shop" },
  metafield: {
    namespace: "$app",
    key: "checkout_api",
    value: JSON.stringify({
      validateUrl: "https://app.example/api/referral/validate",
    }),
  },
};

function answering(status, body) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("readCheckoutConfig", () => {
  it("finds the app's shop metafield and ignores the rest", () => {
    const cartOne = {
      target: { type: "cart" },
      metafield: { namespace: "$app", key: "checkout_api", value: "{}" },
    };
    expect(readCheckoutConfig([cartOne, config])).toEqual({
      validateUrl: "https://app.example/api/referral/validate",
    });
    expect(readCheckoutConfig([cartOne])).toBeNull();
    expect(
      readCheckoutConfig([
        { ...config, metafield: { ...config.metafield, value: "not json" } },
      ]),
    ).toBeNull();
  });
});

describe("lookupReferralCode", () => {
  const getToken = vi.fn().mockResolvedValue("jwt-123");

  it("sends the code with the session token and reports a valid code", async () => {
    const fetchImpl = answering(200, { valid: true, name: "Ana Souza" });

    await expect(
      lookupReferralCode({
        validateUrl: "https://app.example/api/referral/validate",
        code: "ANA123",
        getToken,
        fetchImpl,
      }),
    ).resolves.toEqual({ status: "valid", name: "Ana Souza" });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://app.example/api/referral/validate?code=ANA123");
    expect(init.headers.Authorization).toBe("Bearer jwt-123");
  });

  it("reports an unknown code", async () => {
    await expect(
      lookupReferralCode({
        validateUrl: "https://app.example/api/referral/validate",
        code: "NOPE99",
        getToken,
        fetchImpl: answering(200, { valid: false, name: null }),
      }),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("treats a missing config, a failed request or a bad answer as unavailable", async () => {
    await expect(
      lookupReferralCode({ validateUrl: undefined, code: "ANA123", getToken }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      lookupReferralCode({
        validateUrl: "https://app.example/api/referral/validate",
        code: "ANA123",
        getToken,
        fetchImpl: answering(503, { error: "down" }),
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      lookupReferralCode({
        validateUrl: "https://app.example/api/referral/validate",
        code: "ANA123",
        getToken,
        fetchImpl: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
