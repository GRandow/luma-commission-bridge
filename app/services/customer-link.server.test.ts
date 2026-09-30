import { describe, expect, it, vi } from "vitest";
import type { AdminGraphql } from "./admin-graphql.server";
import { customerLinkStatus, ensureCustomerLink } from "./customer-link.server";

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

function definitions(
  nodes: Array<{ id: string; key: string; pinnedPosition: number | null }>,
  distributorDefinitionId:
    string | null = "gid://shopify/MetaobjectDefinition/9",
) {
  return {
    metafieldDefinitions: { nodes },
    metaobjectDefinitionByType: distributorDefinitionId
      ? { id: distributorDefinitionId }
      : null,
  };
}

describe("customer Distributor field", () => {
  it("creates it pinned, as a reference to the distributor metaobjects", async () => {
    const admin = client([
      definitions([{ id: "x", key: "something_else", pinnedPosition: 1 }]),
      {
        metafieldDefinitionCreate: {
          createdDefinition: { id: "d" },
          userErrors: [],
        },
      },
    ]);

    await expect(ensureCustomerLink(admin)).resolves.toBe("created");
    const { definition } = admin.graphql.mock.calls[1][1].variables;
    expect(definition).toMatchObject({
      namespace: "$app",
      key: "distributor",
      type: "metaobject_reference",
      ownerType: "CUSTOMER",
      pin: true,
      access: { admin: "MERCHANT_READ_WRITE" },
      validations: [
        {
          name: "metaobject_definition_id",
          value: "gid://shopify/MetaobjectDefinition/9",
        },
      ],
    });
  });

  it("pins an existing unpinned field and leaves a ready one alone", async () => {
    const unpinned = client([
      definitions([{ id: "d1", key: "distributor", pinnedPosition: null }]),
      {
        metafieldDefinitionPin: {
          pinnedDefinition: { id: "d1" },
          userErrors: [],
        },
      },
    ]);
    await expect(ensureCustomerLink(unpinned)).resolves.toBe("pinned");

    const ready = client([
      definitions([{ id: "d1", key: "distributor", pinnedPosition: 2 }]),
    ]);
    await expect(ensureCustomerLink(ready)).resolves.toBe("ready");
    expect(ready.graphql).toHaveBeenCalledTimes(1);
  });

  it("explains when the distributor metaobject definition is missing", async () => {
    const admin = client([definitions([], null)]);
    await expect(ensureCustomerLink(admin)).rejects.toThrow(/shopify app dev/);
  });

  it("reports its status", async () => {
    await expect(customerLinkStatus(client([definitions([])]))).resolves.toBe(
      "missing",
    );
    await expect(
      customerLinkStatus(
        client([
          definitions([{ id: "d1", key: "distributor", pinnedPosition: null }]),
        ]),
      ),
    ).resolves.toBe("unpinned");
  });
});
