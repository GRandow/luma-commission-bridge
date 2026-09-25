import { centsToMoneyString } from "../domain/money";
import { bpsToPercentString } from "../domain/rates";
import {
  assertNoUserErrors,
  runGraphql,
  type AdminGraphql,
  type UserError,
} from "./admin-graphql.server";

/**
 * Writes the commission back onto the Shopify order so the merchant sees it
 * where they work: three app-owned metafields (defined in shopify.app.toml,
 * visible on the order page) and a tag that makes orders filterable by
 * distributor. All three metafields are set in one `metafieldsSet` call.
 */

export const COMMISSION_NAMESPACE = "$app";

export interface CommissionWriteback {
  orderId: string;
  amountCents: number;
  currency: string;
  rateBps: number;
  distributorCode: string;
  distributorName: string;
}

export interface MetafieldInput {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export function buildCommissionMetafields(
  input: CommissionWriteback,
): MetafieldInput[] {
  return [
    {
      ownerId: input.orderId,
      namespace: COMMISSION_NAMESPACE,
      key: "commission_amount",
      type: "money",
      value: JSON.stringify({
        amount: centsToMoneyString(input.amountCents),
        currency_code: input.currency,
      }),
    },
    {
      ownerId: input.orderId,
      namespace: COMMISSION_NAMESPACE,
      key: "commission_distributor",
      type: "single_line_text_field",
      value: `${input.distributorCode} · ${input.distributorName}`,
    },
    {
      ownerId: input.orderId,
      namespace: COMMISSION_NAMESPACE,
      key: "commission_rate",
      type: "number_decimal",
      value: bpsToPercentString(input.rateBps),
    },
  ];
}

export function buildCommissionTags(distributorCode: string): string[] {
  return [`ref:${distributorCode}`, "commission:calculated"];
}

const WRITEBACK_MUTATION = /* GraphQL */ `
  mutation WriteCommission(
    $metafields: [MetafieldsSetInput!]!
    $orderId: ID!
    $tags: [String!]!
  ) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        key
      }
      userErrors {
        field
        message
      }
    }
    tagsAdd(id: $orderId, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }
`;

export async function writeCommissionToOrder(
  client: AdminGraphql,
  input: CommissionWriteback,
): Promise<void> {
  const data = await runGraphql<{
    metafieldsSet: { userErrors: UserError[] };
    tagsAdd: { userErrors: UserError[] };
  }>(client, WRITEBACK_MUTATION, {
    metafields: buildCommissionMetafields(input),
    orderId: input.orderId,
    tags: buildCommissionTags(input.distributorCode),
  });
  assertNoUserErrors(data.metafieldsSet.userErrors, "metafieldsSet");
  assertNoUserErrors(data.tagsAdd.userErrors, "tagsAdd");
}
