import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
  type CartInput,
  type CartLinesDiscountsGenerateRunResult,
  type Scalars,
} from "../generated/api";
import { chooseDeal, readConfig } from "./pricing";

const NO_DISCOUNT: CartLinesDiscountsGenerateRunResult = { operations: [] };

/**
 * `Decimal` travels as a string ("12.5"). The cast keeps this file
 * independent of how the codegen version at hand types the scalar.
 */
function decimal(value: number): Scalars["Decimal"]["input"] {
  return String(value) as unknown as Scalars["Decimal"]["input"];
}

/**
 * Runs whenever the cart changes (storefront cart and checkout alike). One
 * candidate covers every line with something to discount: the deal is the
 * same percentage for the whole cart, so there is nothing to choose per line.
 */
export function cartLinesDiscountsGenerateRun(
  input: CartInput,
): CartLinesDiscountsGenerateRunResult {
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) {
    return NO_DISCOUNT;
  }

  const config = readConfig(input.discount.metafield?.jsonValue);
  if (!config) return NO_DISCOUNT;

  const lines = input.cart.lines.filter(
    (line) => Number(line.cost.subtotalAmount.amount) > 0,
  );
  if (lines.length === 0) return NO_DISCOUNT;

  // Shopify matches a typed email to its customer before any sign-in, so
  // the customer alone proves nothing: anyone could type a distributor's
  // email. Wholesale waits for a signed-in buyer.
  const buyer = input.cart.buyerIdentity;
  const distributorId = buyer?.isAuthenticated
    ? buyer.customer?.metafield?.value
    : null;

  const deal = chooseDeal(config, input.cart.attribute?.value, distributorId);
  if (!deal) return NO_DISCOUNT;

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: deal.message,
              targets: lines.map((line) => ({ cartLine: { id: line.id } })),
              value: { percentage: { value: decimal(deal.percent) } },
            },
          ],
          selectionStrategy: ProductDiscountSelectionStrategy.First,
        },
      },
    ],
  };
}
