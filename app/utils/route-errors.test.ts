import { describe, expect, it } from "vitest";
import { isTransientRouteError } from "./route-errors";

// The shape React Router hands an ErrorBoundary for a thrown Response.
function routeError(status: number) {
  return { status, statusText: "", internal: false, data: null };
}

describe("isTransientRouteError", () => {
  it("treats gateway failures and timeouts as something to retry", () => {
    for (const status of [0, 408, 429, 500, 502, 503, 504, 530]) {
      expect(isTransientRouteError(routeError(status))).toBe(true);
    }
  });

  it("treats a network or DNS failure as something to retry", () => {
    expect(isTransientRouteError(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isTransientRouteError(
        new TypeError("NetworkError when attempting to fetch resource."),
      ),
    ).toBe(true);
    expect(isTransientRouteError(new TypeError("Load failed"))).toBe(true);
  });

  it("leaves auth, client and programming errors to the normal boundary", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isTransientRouteError(routeError(status))).toBe(false);
    }
    expect(isTransientRouteError(new TypeError("x is not a function"))).toBe(
      false,
    );
    expect(isTransientRouteError(new Error("boom"))).toBe(false);
    expect(isTransientRouteError(undefined)).toBe(false);
  });
});
