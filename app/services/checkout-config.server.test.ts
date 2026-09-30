import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminGraphql } from "./admin-graphql.server";
import {
  buildCheckoutConfig,
  ensureCheckoutConfig,
  resetCheckoutConfigCache,
} from "./checkout-config.server";

function client(
  responses: unknown[],
): AdminGraphql & { graphql: ReturnType<typeof vi.fn> } {
  const graphql = vi.fn();
  for (const data of responses) {
    graphql.mockResolvedValueOnce(
      new Response(JSON.stringify({ data }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
  return { graphql };
}

const wanted = JSON.stringify(buildCheckoutConfig("https://tunnel.example"));

describe("checkout config metafield", () => {
  beforeEach(() => resetCheckoutConfigCache());

  it("builds the validation URL from the app URL, without a trailing slash", () => {
    expect(buildCheckoutConfig("https://tunnel.example/")).toEqual({
      validateUrl: "https://tunnel.example/api/referral/validate",
    });
  });

  it("writes the shop metafield when the stored value differs", async () => {
    const admin = client([
      { shop: { id: "gid://shopify/Shop/1", metafield: { value: "{}" } } },
      { metafieldsSet: { userErrors: [] } },
    ]);

    await expect(
      ensureCheckoutConfig(admin, "https://tunnel.example"),
    ).resolves.toBe("updated");

    const [, options] = admin.graphql.mock.calls[1]!;
    expect(options?.variables?.metafields).toEqual([
      {
        ownerId: "gid://shopify/Shop/1",
        namespace: "$app",
        key: "checkout_api",
        type: "json",
        value: wanted,
      },
    ]);
  });

  it("leaves a matching value alone and remembers it for the process", async () => {
    const admin = client([
      { shop: { id: "gid://shopify/Shop/1", metafield: { value: wanted } } },
    ]);

    await expect(
      ensureCheckoutConfig(admin, "https://tunnel.example"),
    ).resolves.toBe("unchanged");
    await expect(
      ensureCheckoutConfig(admin, "https://tunnel.example"),
    ).resolves.toBe("unchanged");
    expect(admin.graphql).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an app URL", async () => {
    const admin = client([]);
    await expect(ensureCheckoutConfig(admin, "")).resolves.toBe("unchanged");
    expect(admin.graphql).not.toHaveBeenCalled();
  });
});
