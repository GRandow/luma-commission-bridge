import { describe, expect, it, vi } from "vitest";
import {
  buildPricingConfig,
  DEFAULT_PRICING_SETTINGS,
} from "../domain/pricing";
import type { AdminGraphql } from "./admin-graphql.server";
import {
  discountAdminUrl,
  findPricingDiscount,
  savePricing,
  stableStringify,
  syncPricingDistributors,
} from "./pricing.server";

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

const ana = {
  id: "gid://shopify/Metaobject/1",
  code: "ANA123",
  name: "Ana Souza",
  level: "Consultant",
  active: true,
};

const someoneElses = {
  id: "gid://shopify/DiscountAutomaticNode/7",
  metafield: null,
  discount: {
    __typename: "DiscountAutomaticApp",
    discountId: "gid://shopify/DiscountAutomaticNode/7",
    title: "Another app's discount",
    status: "ACTIVE",
  },
};

function ours(config: unknown) {
  return {
    id: "gid://shopify/DiscountAutomaticNode/42",
    metafield: { id: "gid://shopify/Metafield/5", jsonValue: config },
    discount: {
      __typename: "DiscountAutomaticApp",
      discountId: "gid://shopify/DiscountAutomaticNode/42",
      title: "Distributor pricing",
      status: "ACTIVE",
    },
  };
}

const updated = {
  discountAutomaticAppUpdate: {
    automaticAppDiscount: {
      discountId: "gid://shopify/DiscountAutomaticNode/42",
      title: "Distributor pricing",
      status: "ACTIVE",
    },
    userErrors: [],
  },
};

// Mutation variables are loosely shaped JSON; the assertions below pin them down.
function variablesOf(
  admin: { graphql: ReturnType<typeof vi.fn> },
  call: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  return admin.graphql.mock.calls[call][1].variables;
}

describe("finding the app's discount", () => {
  it("recognises it by the app-owned config metafield", async () => {
    const admin = client([
      {
        discountNodes: { nodes: [someoneElses, ours({ referralPercent: 15 })] },
      },
    ]);
    await expect(findPricingDiscount(admin)).resolves.toEqual({
      id: "gid://shopify/DiscountAutomaticNode/42",
      title: "Distributor pricing",
      status: "ACTIVE",
      metafieldId: "gid://shopify/Metafield/5",
      config: { referralPercent: 15 },
    });
  });

  it("looks again without the search filter before concluding it is missing", async () => {
    const admin = client([
      { discountNodes: { nodes: [] } },
      { discountNodes: { nodes: [ours({})] } },
    ]);
    await expect(findPricingDiscount(admin)).resolves.toMatchObject({
      id: "gid://shopify/DiscountAutomaticNode/42",
    });
    expect(variablesOf(admin, 0).search).toBe("method:automatic AND type:app");
    expect(variablesOf(admin, 1).search).toBeNull();
  });

  it("returns null when the shop has none", async () => {
    const admin = client([{ discountNodes: { nodes: [someoneElses] } }]);
    await expect(findPricingDiscount(admin)).resolves.toBeNull();
  });
});

describe("savePricing", () => {
  it("creates the automatic discount the first time, pointing at the Function", async () => {
    const admin = client([
      { discountNodes: { nodes: [] } },
      { discountNodes: { nodes: [] } },
      {
        discountAutomaticAppCreate: {
          automaticAppDiscount: {
            discountId: "gid://shopify/DiscountAutomaticNode/42",
            title: "Distributor pricing",
            status: "ACTIVE",
          },
          userErrors: [],
        },
      },
    ]);
    const now = new Date("2026-10-01T12:00:00Z");

    await expect(
      savePricing(admin, DEFAULT_PRICING_SETTINGS, [ana], now),
    ).resolves.toEqual({ created: true });

    const { discount } = variablesOf(admin, 2);
    expect(discount).toMatchObject({
      title: "Distributor pricing",
      functionHandle: "distributor-pricing",
      discountClasses: ["PRODUCT"],
      startsAt: "2026-10-01T12:00:00.000Z",
      combinesWith: {
        productDiscounts: false,
        orderDiscounts: false,
        shippingDiscounts: true,
      },
    });
    expect(discount.metafields[0]).toMatchObject({
      namespace: "$app",
      key: "pricing_config",
      type: "json",
    });
    expect(JSON.parse(discount.metafields[0].value)).toEqual(
      buildPricingConfig(DEFAULT_PRICING_SETTINGS, [ana]),
    );
  });

  it("updates the config of the existing discount", async () => {
    const admin = client([{ discountNodes: { nodes: [ours({})] } }, updated]);
    const settings = { ...DEFAULT_PRICING_SETTINGS, referralPercent: 5 };

    await expect(savePricing(admin, settings, [ana])).resolves.toEqual({
      created: false,
    });
    const variables = variablesOf(admin, 1);
    expect(variables.id).toBe("gid://shopify/DiscountAutomaticNode/42");
    expect(variables.discount.metafields[0].id).toBe(
      "gid://shopify/Metafield/5",
    );
    expect(JSON.parse(variables.discount.metafields[0].value)).toMatchObject({
      referralPercent: 5,
    });
  });

  it("surfaces Shopify's user errors", async () => {
    const admin = client([
      { discountNodes: { nodes: [] } },
      { discountNodes: { nodes: [] } },
      {
        discountAutomaticAppCreate: {
          automaticAppDiscount: null,
          userErrors: [
            { field: ["functionHandle"], message: "Function not found" },
          ],
        },
      },
    ]);
    await expect(
      savePricing(admin, DEFAULT_PRICING_SETTINGS, [ana]),
    ).rejects.toThrow(/Function not found/);
  });
});

describe("syncPricingDistributors", () => {
  it("does nothing before the discount exists", async () => {
    const admin = client([
      { discountNodes: { nodes: [] } },
      { discountNodes: { nodes: [] } },
    ]);
    await expect(syncPricingDistributors(admin, [ana])).resolves.toBe(
      "not-set-up",
    );
    expect(admin.graphql).toHaveBeenCalledTimes(2);
  });

  it("leaves an up-to-date config alone, whatever its key order", async () => {
    const config = buildPricingConfig(DEFAULT_PRICING_SETTINGS, [ana]);
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(config).reverse())),
    );
    const admin = client([{ discountNodes: { nodes: [ours(reordered)] } }]);
    await expect(syncPricingDistributors(admin, [ana])).resolves.toBe(
      "unchanged",
    );
    expect(admin.graphql).toHaveBeenCalledTimes(1);
  });

  it("rewrites the distributors, keeping the merchant's percentages", async () => {
    const stored = buildPricingConfig(
      {
        referralPercent: 7,
        referralPercents: {},
        wholesalePercent: 30,
        levelPercents: {},
      },
      [ana],
    );
    const admin = client([
      { discountNodes: { nodes: [ours(stored)] } },
      updated,
    ]);

    await expect(
      syncPricingDistributors(admin, [{ ...ana, active: false }]),
    ).resolves.toBe("updated");
    const written = JSON.parse(
      variablesOf(admin, 1).discount.metafields[0].value,
    );
    expect(written).toMatchObject({
      referralPercent: 7,
      wholesalePercent: 30,
      distributors: [],
    });
  });
});

describe("helpers", () => {
  it("serialises with sorted keys", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: null }] })).toBe(
      '{"a":[{"c":null,"d":2}],"b":1}',
    );
  });

  it("links to the discount in the admin", () => {
    expect(discountAdminUrl("gid://shopify/DiscountAutomaticNode/42")).toBe(
      "shopify://admin/discounts/42",
    );
  });
});
