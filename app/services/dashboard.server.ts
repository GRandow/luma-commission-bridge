import type { Commission, Prisma, WebhookEvent } from "@prisma/client";
import prisma from "../db.server";
import { formatRate } from "../domain/commission";
import { formatCents } from "../domain/money";
import {
  PAGE_SIZE,
  pageMeta,
  type Page,
  type SyncFilter,
} from "../domain/paging";
import { isPayable, type CommissionStatus } from "../domain/resolve-commission";
import {
  listCommissions,
  summarizeCommissions,
  type CommissionSummary,
} from "./commissions.server";
import { listRecentWebhookEvents } from "./webhook-events.server";

/**
 * What the admin pages show.
 *
 * The dashboard shows the latest few rows of each table and polls
 * `/app/activity` for updates, so a failed poll (a tunnel hiccup, a dev
 * server reload) keeps the last good data on screen instead of replacing
 * the page with an error. The full tables live on their own pages, in
 * fixed-size pages, because a real store's ledger only grows.
 */

export interface CommissionRow {
  id: string;
  orderId: string;
  orderName: string;
  paidAt: string;
  referralCode: string | null;
  distributorName: string | null;
  base: string;
  rate: string;
  amount: string;
  status: string;
  payable: boolean;
  syncStatus: string;
  syncReference: string | null;
  syncError: string | null;
  syncAttempts: number;
}

export interface EventRow {
  id: string;
  topic: string;
  status: string;
  attempts: number;
  error: string | null;
  receivedAt: string;
}

export interface DashboardActivity {
  summary: CommissionSummary;
  /** Deliveries recorded for the shop, all time (webhook payloads are purged after 30 days). */
  eventCount: number;
  commissions: CommissionRow[];
  events: EventRow[];
}

/** How many rows the dashboard shows of each table; the rest is on the full pages. */
export const DASHBOARD_LIMITS = { commissions: 8, events: 5 };

export function toCommissionRow(commission: Commission): CommissionRow {
  return {
    id: commission.id,
    orderId: commission.orderId,
    orderName: commission.orderName,
    paidAt: commission.paidAt.toISOString(),
    referralCode: commission.referralCode,
    distributorName: commission.distributorName,
    base: formatCents(commission.baseCents, commission.orderCurrency),
    rate: formatRate(commission.rateBps),
    amount: formatCents(commission.amountCents, commission.orderCurrency),
    status: commission.status,
    payable: isPayable(commission.status as CommissionStatus),
    syncStatus: commission.syncStatus,
    syncReference: commission.syncReference,
    syncError: commission.syncError,
    syncAttempts: commission.syncAttempts,
  };
}

export function toEventRow(event: WebhookEvent): EventRow {
  return {
    id: event.id,
    topic: event.topic,
    status: event.status,
    attempts: event.attempts,
    error: event.error,
    receivedAt: event.receivedAt.toISOString(),
  };
}

export async function loadDashboardActivity(
  shop: string,
  limits = DASHBOARD_LIMITS,
): Promise<DashboardActivity> {
  const [commissions, events, summary, eventCount] = await Promise.all([
    listCommissions(shop, limits.commissions),
    listRecentWebhookEvents(shop, limits.events),
    summarizeCommissions(shop),
    prisma.webhookEvent.count({ where: { shop } }),
  ]);
  return {
    summary,
    eventCount,
    commissions: commissions.map(toCommissionRow),
    events: events.map(toEventRow),
  };
}

// ---------------------------------------------------------------------------
// Full, paginated tables

export interface CommissionFilters {
  syncStatus?: SyncFilter | null;
  /** Free text, matched case-insensitively against the distributor's name, the referral code and the order number. */
  query?: string;
}

export function commissionWhere(
  shop: string,
  filters: CommissionFilters,
): Prisma.CommissionWhereInput {
  const query = filters.query?.trim();
  return {
    shop,
    ...(filters.syncStatus ? { syncStatus: filters.syncStatus } : {}),
    ...(query
      ? {
          OR: [
            { distributorName: { contains: query, mode: "insensitive" } },
            { referralCode: { contains: query, mode: "insensitive" } },
            { orderName: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function pageCommissions(
  shop: string,
  requestedPage: number,
  filters: CommissionFilters = {},
  pageSize = PAGE_SIZE,
): Promise<Page<CommissionRow>> {
  const where = commissionWhere(shop, filters);
  const total = await prisma.commission.count({ where });
  const { page, pageCount, skip } = pageMeta(total, requestedPage, pageSize);
  const rows = await prisma.commission.findMany({
    where,
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    skip,
    take: pageSize,
  });
  return { rows: rows.map(toCommissionRow), total, page, pageSize, pageCount };
}

export async function pageWebhookEvents(
  shop: string,
  requestedPage: number,
  pageSize = PAGE_SIZE,
): Promise<Page<EventRow>> {
  const where = { shop };
  const total = await prisma.webhookEvent.count({ where });
  const { page, pageCount, skip } = pageMeta(total, requestedPage, pageSize);
  const rows = await prisma.webhookEvent.findMany({
    where,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    skip,
    take: pageSize,
  });
  return { rows: rows.map(toEventRow), total, page, pageSize, pageCount };
}
