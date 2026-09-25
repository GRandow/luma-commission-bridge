import { describe, expect, it, vi } from "vitest";
import {
  definitionsReady,
  ensureCommissionDefinitions,
  listCommissionDefinitions,
} from "./order-definitions.server";

const amount = {
  id: "gid://shopify/MetafieldDefinition/1",
  key: "commission_amount",
  name: "Commission amount",
  pinnedPosition: 1,
};
const rate = {
  id: "gid://shopify/MetafieldDefinition/2",
  key: "commission_rate",
  name: "Commission rate (%)",
  pinnedPosition: null,
};
const other = {
  id: "gid://shopify/MetafieldDefinition/3",
  key: "something_else",
  name: "Other",
  pinnedPosition: null,
};

function respond(...payloads: unknown[]) {
  const graphql = vi.fn();
  for (const payload of payloads) {
    graphql.mockResolvedValueOnce({ json: () => Promise.resolve(payload) });
  }
  return graphql;
}

describe("order metafield definitions", () => {
  it("lists only the commission definitions with their pinned state", async () => {
    const graphql = respond({
      data: { metafieldDefinitions: { nodes: [amount, rate, other] } },
    });

    const definitions = await listCommissionDefinitions({ graphql });

    expect(
      definitions.map((definition) => [definition.key, definition.pinned]),
    ).toEqual([
      ["commission_amount", true],
      ["commission_rate", false],
    ]);
    expect(definitionsReady(definitions)).toBe(false);
  });

  it("creates what is missing (pinned) and pins what exists unpinned", async () => {
    const graphql = respond(
      { data: { metafieldDefinitions: { nodes: [amount, rate] } } },
      {
        data: {
          metafieldDefinitionCreate: {
            createdDefinition: { id: "4" },
            userErrors: [],
          },
        },
      },
      {
        data: {
          metafieldDefinitionPin: {
            pinnedDefinition: { id: "2" },
            userErrors: [],
          },
        },
      },
    );

    const result = await ensureCommissionDefinitions({ graphql });

    expect(result).toEqual({ created: 1, pinned: 1 });
    expect(graphql).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("metafieldDefinitionCreate"),
      {
        variables: {
          definition: expect.objectContaining({
            key: "commission_distributor",
            namespace: "$app",
            ownerType: "ORDER",
            pin: true,
            access: { admin: "MERCHANT_READ" },
          }),
        },
      },
    );
    expect(graphql).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("metafieldDefinitionPin"),
      {
        variables: { definitionId: rate.id },
      },
    );
  });

  it("does nothing when everything is already in place", async () => {
    const ready = [
      amount,
      { ...rate, pinnedPosition: 2 },
      { id: "5", key: "commission_distributor", name: "d", pinnedPosition: 3 },
    ];
    const graphql = respond({
      data: { metafieldDefinitions: { nodes: ready } },
    });

    await expect(ensureCommissionDefinitions({ graphql })).resolves.toEqual({
      created: 0,
      pinned: 0,
    });
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("surfaces user errors from the API", async () => {
    const graphql = respond(
      { data: { metafieldDefinitions: { nodes: [] } } },
      {
        data: {
          metafieldDefinitionCreate: {
            createdDefinition: null,
            userErrors: [
              {
                message: "Definition is managed by app configuration",
                code: "TAKEN",
              },
            ],
          },
        },
      },
    );

    await expect(ensureCommissionDefinitions({ graphql })).rejects.toThrow(
      "create commission_amount: Definition is managed by app configuration",
    );
  });
});
