import { describe, expect, it, vi } from "vitest";
import {
  findDistributorByCode,
  toDistributor,
  upsertDistributor,
} from "./distributors.server";

function fakeClient(payload: unknown) {
  const graphql = vi
    .fn()
    .mockResolvedValue({ json: () => Promise.resolve(payload) });
  return { client: { graphql }, graphql };
}

const anaNode = {
  id: "gid://shopify/Metaobject/1",
  handle: "ana123",
  code: { value: "ANA123" },
  name: { value: "Ana Souza" },
  level: { value: "Consultant" },
  rate: { value: "12.5" },
  active: { value: "true" },
};

describe("distributors", () => {
  it("maps a metaobject entry to a distributor", () => {
    expect(toDistributor(anaNode)).toEqual({
      id: "gid://shopify/Metaobject/1",
      handle: "ana123",
      code: "ANA123",
      name: "Ana Souza",
      level: "Consultant",
      rateBps: 1250,
      active: true,
    });
    expect(
      toDistributor({ ...anaNode, active: { value: "false" } })?.active,
    ).toBe(false);
    expect(toDistributor({ ...anaNode, code: { value: "" } })).toBeNull();
  });

  it("looks a distributor up by code with a field filter and an exact match", async () => {
    const { client, graphql } = fakeClient({
      data: {
        metaobjects: {
          nodes: [{ ...anaNode, code: { value: "ANA1234" } }, anaNode],
        },
      },
    });

    const found = await findDistributorByCode(client, "ana123");

    expect(found?.name).toBe("Ana Souza");
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining("query DistributorByCode"),
      {
        variables: { type: "$app:distributor", query: 'fields.code:"ANA123"' },
      },
    );
  });

  it("returns null for codes that match nothing", async () => {
    const { client } = fakeClient({ data: { metaobjects: { nodes: [] } } });
    expect(await findDistributorByCode(client, "NOPE1")).toBeNull();
    expect(await findDistributorByCode(client, "")).toBeNull();
  });

  it("upserts by handle and surfaces user errors", async () => {
    const ok = fakeClient({
      data: { metaobjectUpsert: { metaobject: anaNode, userErrors: [] } },
    });
    const created = await upsertDistributor(ok.client, {
      code: "ana123",
      name: "Ana Souza",
      level: "Consultant",
      ratePercent: "12.5",
    });
    expect(created.code).toBe("ANA123");
    expect(ok.graphql).toHaveBeenCalledWith(
      expect.stringContaining("mutation UpsertDistributor"),
      {
        variables: expect.objectContaining({
          handle: { type: "$app:distributor", handle: "ana123" },
        }),
      },
    );

    const failing = fakeClient({
      data: {
        metaobjectUpsert: {
          metaobject: null,
          userErrors: [{ message: "Code is taken" }],
        },
      },
    });
    await expect(
      upsertDistributor(failing.client, {
        code: "X1",
        name: "X",
        level: "",
        ratePercent: "1",
      }),
    ).rejects.toThrow("Code is taken");
  });
});
