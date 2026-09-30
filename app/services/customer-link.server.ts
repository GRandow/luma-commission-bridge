import {
  assertNoUserErrors,
  runGraphql,
  type AdminGraphql,
  type UserError,
} from "./admin-graphql.server";
import { DISTRIBUTOR_TYPE } from "./distributors.server";

/**
 * Which customer *is* a distributor. A pinned customer metafield,
 * `$app:distributor`, holds a reference to the distributor's metaobject:
 * the merchant picks the distributor on the customer's page, the level and
 * the active flag stay on the distributor record, and the pricing Function
 * reads the reference from the checkout's buyer.
 *
 * Created through the Admin API for the same reason as the order
 * definitions: only pinned definitions show on the resource page, and only
 * the app can pin its own.
 */

export const CUSTOMER_DISTRIBUTOR_NAMESPACE = "$app";
export const CUSTOMER_DISTRIBUTOR_KEY = "distributor";

const DEFINITION_QUERY = /* GraphQL */ `
  query CustomerDistributorDefinition($namespace: String!, $type: String!) {
    metafieldDefinitions(
      ownerType: CUSTOMER
      namespace: $namespace
      first: 20
    ) {
      nodes {
        id
        key
        pinnedPosition
      }
    }
    metaobjectDefinitionByType(type: $type) {
      id
    }
  }
`;

const CREATE_MUTATION = /* GraphQL */ `
  mutation CreateCustomerDistributorDefinition(
    $definition: MetafieldDefinitionInput!
  ) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
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
  mutation PinCustomerDistributorDefinition($definitionId: ID!) {
    metafieldDefinitionPin(definitionId: $definitionId) {
      pinnedDefinition {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface DefinitionData {
  metafieldDefinitions: {
    nodes: Array<{ id: string; key: string; pinnedPosition: number | null }>;
  };
  metaobjectDefinitionByType: { id: string } | null;
}

export type CustomerLinkStatus = "missing" | "unpinned" | "ready";

async function readDefinition(client: AdminGraphql) {
  const data = await runGraphql<DefinitionData>(client, DEFINITION_QUERY, {
    namespace: CUSTOMER_DISTRIBUTOR_NAMESPACE,
    type: DISTRIBUTOR_TYPE,
  });
  const definition = data.metafieldDefinitions.nodes.find(
    (node) => node.key === CUSTOMER_DISTRIBUTOR_KEY,
  );
  return {
    definition,
    distributorDefinitionId: data.metaobjectDefinitionByType?.id ?? null,
  };
}

export async function customerLinkStatus(
  client: AdminGraphql,
): Promise<CustomerLinkStatus> {
  const { definition } = await readDefinition(client);
  if (!definition) return "missing";
  return definition.pinnedPosition === null ? "unpinned" : "ready";
}

/** Creates the pinned "Distributor" field on customers, or pins it; idempotent. */
export async function ensureCustomerLink(
  client: AdminGraphql,
): Promise<"created" | "pinned" | "ready"> {
  const { definition, distributorDefinitionId } = await readDefinition(client);

  if (definition) {
    if (definition.pinnedPosition !== null) return "ready";
    const data = await runGraphql<{
      metafieldDefinitionPin: { userErrors: UserError[] };
    }>(client, PIN_MUTATION, { definitionId: definition.id });
    assertNoUserErrors(
      data.metafieldDefinitionPin.userErrors,
      "Pin the customer Distributor field",
    );
    return "pinned";
  }

  if (!distributorDefinitionId) {
    throw new Error(
      "The Distributor metaobject definition does not exist yet. Run `shopify app dev` or `shopify app deploy` once so Shopify creates it.",
    );
  }

  const data = await runGraphql<{
    metafieldDefinitionCreate: { userErrors: UserError[] };
  }>(client, CREATE_MUTATION, {
    definition: {
      name: "Distributor",
      namespace: CUSTOMER_DISTRIBUTOR_NAMESPACE,
      key: CUSTOMER_DISTRIBUTOR_KEY,
      type: "metaobject_reference",
      description:
        "The distributor this customer is. They buy at that distributor's wholesale price (Luma Commission Bridge).",
      ownerType: "CUSTOMER",
      pin: true,
      access: { admin: "MERCHANT_READ_WRITE" },
      validations: [
        { name: "metaobject_definition_id", value: distributorDefinitionId },
      ],
    },
  });
  assertNoUserErrors(
    data.metafieldDefinitionCreate.userErrors,
    "Create the customer Distributor field",
  );
  return "created";
}
