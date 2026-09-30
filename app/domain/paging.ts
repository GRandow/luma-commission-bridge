/**
 * Paging for the full-table pages, kept free of Prisma so the route
 * components can share it with their loaders (server-only modules cannot be
 * referenced from a route's component code).
 */

export const PAGE_SIZE = 15;

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** `?page=` as a positive integer; anything else is page 1. */
export function parsePage(raw: string | null | undefined): number {
  const page = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Clamps the requested page to what exists, so a stale link never shows an empty page. */
export function pageMeta(
  total: number,
  requestedPage: number,
  pageSize = PAGE_SIZE,
): { page: number; pageCount: number; skip: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  return { page, pageCount, skip: (page - 1) * pageSize };
}

/** Engine hand-off states a commissions page can be narrowed to. */
export const SYNC_FILTERS = ["synced", "pending", "failed", "skipped"] as const;
export type SyncFilter = (typeof SYNC_FILTERS)[number];

export function parseSyncFilter(
  raw: string | null | undefined,
): SyncFilter | null {
  return (SYNC_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as SyncFilter)
    : null;
}

/** The longest free-text search the pages accept. */
export const QUERY_MAX_LENGTH = 80;

/** `?q=` trimmed and capped; an empty string means no search. */
export function parseQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, QUERY_MAX_LENGTH);
}
