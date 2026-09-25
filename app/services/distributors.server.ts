import { normalizeReferralCode } from "../domain/attribution";
import { parsePercentToBps } from "../domain/rates";
import type { DistributorLike } from "../domain/resolve-commission";
import {
  assertNoUserErrors,
  runGraphql,
  type AdminGraphql,
  type UserError,
} from "./admin-graphql.server";

/**
 * Distributors live in Shopify as metaobjects of the app-reserved type
 * `$app:distributor`, defined declaratively in `shopify.app.toml`. The
 * merchant manages them in the admin (Content → Metaobjects) without any
 * screen of ours, and the app only reads them — plus a one-off seed for
 * demo stores.
 */

export const DISTRIBUTOR_TYPE = "$app:distributor";

export interface Distributor extends DistributorLike {
  handle: string;
  level: string | null;
}

interface MetaobjectNode {
  id: string;
  handle: string;
  code: { value: string | null } | null;
  name: { value: string | null } | null;
  level: { value: string | null } | null;
  rate: { value: string | null } | null;
  active: { value: string | null } | null;
}

const DISTRIBUTOR_FIELDS = /* GraphQL */ `
  fragment DistributorFields on Metaobject {
    id
    handle
    code: field(key: "code") {
      value
    }
    name: field(key: "name") {
      value
    }
    level: field(key: "level") {
      value
    }
    rate: field(key: "commission_rate") {
      value
    }
    active: field(key: "active") {
      value
    }
  }
`;

const DISTRIBUTOR_BY_CODE_QUERY = /* GraphQL */ `
  ${DISTRIBUTOR_FIELDS}
  query DistributorByCode($type: String!, $query: String!) {
    metaobjects(type: $type, first: 5, query: $query) {
      nodes {
        ...DistributorFields
      }
    }
  }
`;

const DISTRIBUTORS_QUERY = /* GraphQL */ `
  ${DISTRIBUTOR_FIELDS}
  query Distributors($type: String!) {
    metaobjects(type: $type, first: 50, sortKey: "display_name") {
      nodes {
        ...DistributorFields
      }
    }
  }
`;

const UPSERT_DISTRIBUTOR_MUTATION = /* GraphQL */ `
  ${DISTRIBUTOR_FIELDS}
  mutation UpsertDistributor(
    $handle: MetaobjectHandleInput!
    $metaobject: MetaobjectUpsertInput!
  ) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject {
        ...DistributorFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/** Maps a metaobject to the app's model; entries without a usable code or name are skipped. */
export function toDistributor(node: MetaobjectNode): Distributor | null {
  const code = normalizeReferralCode(node.code?.value);
  const name = node.name?.value?.trim();
  if (!code || !name) return null;
  return {
    id: node.id,
    handle: node.handle,
    code,
    name,
    level: node.level?.value?.trim() || null,
    rateBps: parsePercentToBps(node.rate?.value ?? "0"),
    active: node.active?.value !== "false",
  };
}

/** Escapes a value for the metaobject `query` filter (`fields.code:"..."`). */
function fieldFilter(key: string, value: string): string {
  return `fields.${key}:"${value.replace(/["\\]/g, "\\$&")}"`;
}

export async function findDistributorByCode(
  client: AdminGraphql,
  rawCode: string,
): Promise<Distributor | null> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;
  const data = await runGraphql<{ metaobjects: { nodes: MetaobjectNode[] } }>(
    client,
    DISTRIBUTOR_BY_CODE_QUERY,
    { type: DISTRIBUTOR_TYPE, query: fieldFilter("code", code) },
  );
  // The filter is not guaranteed to be exact (or case-sensitive); compare ourselves.
  return (
    data.metaobjects.nodes
      .map(toDistributor)
      .find((distributor) => distributor?.code === code) ?? null
  );
}

export async function listDistributors(
  client: AdminGraphql,
): Promise<Distributor[]> {
  const data = await runGraphql<{ metaobjects: { nodes: MetaobjectNode[] } }>(
    client,
    DISTRIBUTORS_QUERY,
    { type: DISTRIBUTOR_TYPE },
  );
  return data.metaobjects.nodes.flatMap((node) => {
    const distributor = toDistributor(node);
    return distributor ? [distributor] : [];
  });
}

export interface DistributorInput {
  code: string;
  name: string;
  level: string;
  ratePercent: string;
  active?: boolean;
}

/** Creates or updates a distributor; the handle is the lowercased code, so re-seeding is safe. */
export async function upsertDistributor(
  client: AdminGraphql,
  input: DistributorInput,
): Promise<Distributor> {
  const code = normalizeReferralCode(input.code);
  if (!code) throw new Error(`Invalid distributor code: ${input.code}`);
  const data = await runGraphql<{
    metaobjectUpsert: {
      metaobject: MetaobjectNode | null;
      userErrors: UserError[];
    };
  }>(client, UPSERT_DISTRIBUTOR_MUTATION, {
    handle: { type: DISTRIBUTOR_TYPE, handle: code.toLowerCase() },
    metaobject: {
      fields: [
        { key: "code", value: code },
        { key: "name", value: input.name },
        { key: "level", value: input.level },
        { key: "commission_rate", value: input.ratePercent },
        { key: "active", value: String(input.active ?? true) },
      ],
    },
  });
  assertNoUserErrors(data.metaobjectUpsert.userErrors, "metaobjectUpsert");
  const distributor = data.metaobjectUpsert.metaobject
    ? toDistributor(data.metaobjectUpsert.metaobject)
    : null;
  if (!distributor) throw new Error("metaobjectUpsert returned no distributor");
  return distributor;
}

/** Three distributors that make the demo self-explanatory. */
export const SAMPLE_DISTRIBUTORS: DistributorInput[] = [
  { code: "ANA123", name: "Ana Souza", level: "Consultant", ratePercent: "10" },
  {
    code: "BRUNO77",
    name: "Bruno Lima",
    level: "Senior consultant",
    ratePercent: "12.5",
  },
  {
    code: "LEAD001",
    name: "Carla Mendes",
    level: "Team leader",
    ratePercent: "15",
  },
];

export async function seedSampleDistributors(
  client: AdminGraphql,
): Promise<Distributor[]> {
  const created: Distributor[] = [];
  for (const input of SAMPLE_DISTRIBUTORS) {
    created.push(await upsertDistributor(client, input));
  }
  return created;
}
