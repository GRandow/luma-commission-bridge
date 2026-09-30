import { describe, expect, it } from "vitest";
import { DiscountClass, type CartInput } from "../generated/api";
import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run";

const pricingConfig = {
  version: 1,
  referralPercent: 10,
  wholesalePercent: 20,
  levelPercents: {},
  distributors: [
    {
      id: "gid://shopify/Metaobject/1",
      code: "ANA123",
      name: "Ana Souza",
      level: "Consultant",
    },
  ],
};

function input(overrides: {
  ref?: string;
  distributorId?: string;
  signedIn?: boolean;
  classes?: DiscountClass[];
  config?: unknown;
  amounts?: string[];
}): CartInput {
  return {
    cart: {
      attribute: overrides.ref ? { value: overrides.ref } : null,
      buyerIdentity: overrides.distributorId
        ? {
            isAuthenticated: overrides.signedIn ?? true,
            customer: { metafield: { value: overrides.distributorId } },
          }
        : null,
      lines: (overrides.amounts ?? ["50.0", "30.0"]).map((amount, index) => ({
        id: `gid://shopify/CartLine/${index}`,
        cost: { subtotalAmount: { amount } },
      })),
    },
    discount: {
      discountClasses: overrides.classes ?? [DiscountClass.Product],
      metafield:
        overrides.config === undefined
          ? { jsonValue: pricingConfig }
          : overrides.config === null
            ? null
            : { jsonValue: overrides.config },
    },
  };
}

describe("cartLinesDiscountsGenerateRun", () => {
  it("discounts every line for a referred shopper", () => {
    expect(cartLinesDiscountsGenerateRun(input({ ref: "ANA123" }))).toEqual({
      operations: [
        {
          productDiscountsAdd: {
            candidates: [
              {
                message: "Referred by Ana Souza: 10% off",
                targets: [
                  { cartLine: { id: "gid://shopify/CartLine/0" } },
                  { cartLine: { id: "gid://shopify/CartLine/1" } },
                ],
                value: { percentage: { value: "10" } },
              },
            ],
            selectionStrategy: "FIRST",
          },
        },
      ],
    });
  });

  it("leaves free lines out of the targets", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({ ref: "ANA123", amounts: ["0.0", "30.0"] }),
    );
    const operation = result.operations[0];
    expect(
      "productDiscountsAdd" in operation &&
        operation.productDiscountsAdd?.candidates[0].targets,
    ).toEqual([{ cartLine: { id: "gid://shopify/CartLine/1" } }]);
  });

  it("applies nothing without a deal, a config or the product class", () => {
    expect(cartLinesDiscountsGenerateRun(input({}))).toEqual({
      operations: [],
    });
    expect(
      cartLinesDiscountsGenerateRun(input({ ref: "ANA123", config: null })),
    ).toEqual({ operations: [] });
    expect(
      cartLinesDiscountsGenerateRun(
        input({ ref: "ANA123", classes: [DiscountClass.Order] }),
      ),
    ).toEqual({ operations: [] });
    expect(
      cartLinesDiscountsGenerateRun(input({ ref: "ANA123", amounts: [] })),
    ).toEqual({ operations: [] });
  });

  it("prices a linked distributor at wholesale", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({ distributorId: "gid://shopify/Metaobject/1" }),
    );
    expect(result.operations[0]).toMatchObject({
      productDiscountsAdd: {
        candidates: [
          {
            message: "Distributor price (Consultant): 20% off",
            value: { percentage: { value: "20" } },
          },
        ],
      },
    });
  });

  it("waits for sign-in: an email typed at checkout is not proof", () => {
    // Shopify fills in the customer from the email alone; no wholesale yet…
    expect(
      cartLinesDiscountsGenerateRun(
        input({ distributorId: "gid://shopify/Metaobject/1", signedIn: false }),
      ),
    ).toEqual({ operations: [] });
    // …but a referral on the cart still counts.
    expect(
      cartLinesDiscountsGenerateRun(
        input({
          ref: "ANA123",
          distributorId: "gid://shopify/Metaobject/9",
          signedIn: false,
        }),
      ).operations[0],
    ).toMatchObject({
      productDiscountsAdd: {
        candidates: [{ message: "Referred by Ana Souza: 10% off" }],
      },
    });
  });
});
