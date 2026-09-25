/**
 * The slice of the Admin API client the services depend on. The real client
 * comes from `authenticate.admin` (requests) or `unauthenticated.admin`
 * (background jobs); tests pass a fake with the same shape.
 */
export interface AdminGraphql {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface GraphqlPayload<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export interface UserError {
  field?: string[] | null;
  message: string;
}

export class AdminApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

/** Runs an operation and returns its `data`, turning GraphQL errors into exceptions. */
export async function runGraphql<T>(
  client: AdminGraphql,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await client.graphql(query, { variables });
  const payload = (await response.json()) as GraphqlPayload<T>;
  if (payload.errors?.length) {
    throw new AdminApiError(
      payload.errors.map((error) => error.message).join("; "),
    );
  }
  if (!payload.data) throw new AdminApiError("Admin API returned no data");
  return payload.data;
}

/** Mutations report business failures as `userErrors`, not GraphQL errors. */
export function assertNoUserErrors(
  userErrors: UserError[] | null | undefined,
  context: string,
): void {
  if (userErrors && userErrors.length > 0) {
    throw new AdminApiError(
      `${context}: ${userErrors.map((error) => error.message).join("; ")}`,
    );
  }
}
