import { COMMISSION_NAMESPACE } from "./order-writeback.server";
import {
  assertNoUserErrors,
  runGraphql,
  type AdminGraphql,
  type UserError,
} from "./admin-graphql.server";

/**
 * The order metafield definitions the commission is written into.
 *
 * They are created through the Admin API rather than declared in
 * `shopify.app.toml` on purpose: the admin only shows *pinned* definitions
 * on the order page, declarative definitions cannot be pinned (the TOML has
 * no such setting and they are read-only through the API), and app-owned
 * definitions can only be pinned by the app. So the app creates its own,
 * pinned, and the merchant sees the commission on every order without
 * touching settings. `ensureCommissionDefinitions` is idempotent.
 */

export interface CommissionDefinitionSpec {
  key: string;
  name: string;
  type: string;
  description: string;
}

export const COMMISSION_DEFINITIONS: CommissionDefinitionSpec[] = [
  {
    key: "commission_amount",
    name: "Commission amount",
    type: "money",
    description: "Commission owed to the referring distributor",
  },
  {
    key: "commission_distributor",
    name: "Commission distributor",
    type: "single_line_text_field",
    description:
      "Referral code and name of the distributor credited with the sale",
  },
  {
    key: "commission_rate",
    name: "Commission rate (%)",
    type: "number_decimal",
    description: "Rate applied to the discounted subtotal",
  },
];

export interface OrderDefinition {
  id: string;
  key: string;
  name: string;
  pinned: boolean;
}

const DEFINITIONS_QUERY = /* GraphQL */ `
  query CommissionDefinitions($namespace: String!) {
    metafieldDefinitions(ownerType: ORDER, namespace: $namespace, first: 20) {
      nodes {
        id
        key
        name
        pinnedPosition
      }
    }
  }
`;

const CREATE_MUTATION = /* GraphQL */ `
  mutation CreateCommissionDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        key
        pinnedPosition
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const PIN_MUTATION = /* GraphQL */ `
  mutation PinDefinition($definitionId: ID!) {
    metafieldDefinitionPin(definitionId: $definitionId) {
      pinnedDefinition {
        id
        pinnedPosition
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface DefinitionNode {
  id: string;
  key: string;
  name: string;
  pinnedPosition: number | null;
}

const KEYS = COMMISSION_DEFINITIONS.map((definition) => definition.key);

export async function listCommissionDefinitions(
  client: AdminGraphql,
): Promise<OrderDefinition[]> {
  const data = await runGraphql<{
    metafieldDefinitions: { nodes: DefinitionNode[] };
  }>(client, DEFINITIONS_QUERY, { namespace: COMMISSION_NAMESPACE });
  return data.metafieldDefinitions.nodes
    .filter((node) => KEYS.includes(node.key))
    .map((node) => ({
      id: node.id,
      key: node.key,
      name: node.name,
      pinned: node.pinnedPosition !== null,
    }));
}

/** True when every commission definition exists and is pinned. */
export function definitionsReady(definitions: OrderDefinition[]): boolean {
  return KEYS.every((key) =>
    definitions.some(
      (definition) => definition.key === key && definition.pinned,
    ),
  );
}

export interface EnsureResult {
  created: number;
  pinned: number;
}

/** Creates the missing definitions (pinned) and pins the existing ones that are not. */
export async function ensureCommissionDefinitions(
  client: AdminGraphql,
): Promise<EnsureResult> {
  const existing = await listCommissionDefinitions(client);
  const result: EnsureResult = { created: 0, pinned: 0 };

  for (const spec of COMMISSION_DEFINITIONS) {
    const found = existing.find((definition) => definition.key === spec.key);
    if (!found) {
      const data = await runGraphql<{
        metafieldDefinitionCreate: { userErrors: UserError[] };
      }>(client, CREATE_MUTATION, {
        definition: {
          name: spec.name,
          namespace: COMMISSION_NAMESPACE,
          key: spec.key,
          type: spec.type,
          description: spec.description,
          ownerType: "ORDER",
          pin: true,
          access: { admin: "MERCHANT_READ" },
        },
      });
      assertNoUserErrors(
        data.metafieldDefinitionCreate.userErrors,
        `create ${spec.key}`,
      );
      result.created += 1;
    } else if (!found.pinned) {
      const data = await runGraphql<{
        metafieldDefinitionPin: { userErrors: UserError[] };
      }>(client, PIN_MUTATION, { definitionId: found.id });
      assertNoUserErrors(
        data.metafieldDefinitionPin.userErrors,
        `pin ${spec.key}`,
      );
      result.pinned += 1;
    }
  }
  return result;
}
