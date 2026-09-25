import { describe, expect, it, vi } from "vitest";
import {
  buildCommissionMetafields,
  buildCommissionTags,
  writeCommissionToOrder,
} from "./order-writeback.server";

const input = {
  orderId: "gid://shopify/Order/1005",
  amountCents: 525,
  currency: "USD",
  rateBps: 1250,
  distributorCode: "ANA123",
  distributorName: "Ana Souza",
};

describe("order write-back", () => {
  it("builds the three app-owned metafields and the tags", () => {
    const metafields = buildCommissionMetafields(input);

    expect(
      metafields.map((field) => [field.key, field.type, field.value]),
    ).toEqual([
      ["commission_amount", "money", '{"amount":"5.25","currency_code":"USD"}'],
      [
        "commission_distributor",
        "single_line_text_field",
        "ANA123 · Ana Souza",
      ],
      ["commission_rate", "number_decimal", "12.50"],
    ]);
    expect(metafields.every((field) => field.namespace === "$app")).toBe(true);
    expect(buildCommissionTags("ANA123")).toEqual([
      "ref:ANA123",
      "commission:calculated",
    ]);
  });

  it("sends one mutation and fails loudly on user errors", async () => {
    const graphql = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: {
            metafieldsSet: { metafields: [], userErrors: [] },
            tagsAdd: { userErrors: [{ message: "Order not found" }] },
          },
        }),
    });

    await expect(writeCommissionToOrder({ graphql }, input)).rejects.toThrow(
      "tagsAdd: Order not found",
    );
    expect(graphql).toHaveBeenCalledTimes(1);
  });
});
