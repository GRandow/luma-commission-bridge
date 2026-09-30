import { describe, expect, it, vi } from "vitest";
import {
  lookupReferralCode,
  lookupWithRetry,
  readCheckoutConfig,
} from "./lookup";

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

describe("lookupWithRetry", () => {
  const input = (fetchImpl) => ({
    validateUrl: "https://app.example/api/referral/validate",
    code: "ANA123",
    getToken: () => Promise.resolve("token"),
    fetchImpl,
  });
  const noWait = { sleep: () => Promise.resolve() };

  it("asks again when the app does not answer, then takes the name", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ valid: true, name: "Ana Souza" })),
      );
    await expect(lookupWithRetry(input(fetchImpl), noWait)).resolves.toEqual({
      status: "valid",
      name: "Ana Souza",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns a definite answer at once", async () => {
    const fetchImpl = answering(200, { valid: false });
    await expect(lookupWithRetry(input(fetchImpl), noWait)).resolves.toEqual({
      status: "invalid",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last delay, and stops when cancelled", async () => {
    const down = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      lookupWithRetry(input(down), { ...noWait, delaysMs: [1, 1] }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(down).toHaveBeenCalledTimes(3);

    const cancelledDown = vi.fn().mockRejectedValue(new TypeError("x"));
    await lookupWithRetry(input(cancelledDown), {
      ...noWait,
      isCancelled: () => true,
    });
    expect(cancelledDown).toHaveBeenCalledTimes(1);
  });
});
