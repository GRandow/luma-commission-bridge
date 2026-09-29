import type { Commission, WebhookEvent } from "@prisma/client";
import { formatRate } from "../domain/commission";
import { formatCents } from "../domain/money";
import { isPayable, type CommissionStatus } from "../domain/resolve-commission";
import {
  listCommissions,
  summarizeCommissions,
  type CommissionSummary,
} from "./commissions.server";
import { listRecentWebhookEvents } from "./webhook-events.server";

/**
 * The part of the dashboard that changes while the page is open: paid
 * orders arrive by webhook, jobs run, syncs finish. The page loads it once
 * through its loader and then polls `/app/activity` for updates, so a
 * failed poll (a tunnel hiccup, a dev-server reload) keeps the last good
 * data on screen instead of replacing the page with an error.
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
  commissions: CommissionRow[];
  events: EventRow[];
}

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
): Promise<DashboardActivity> {
  const [commissions, events, summary] = await Promise.all([
    listCommissions(shop),
    listRecentWebhookEvents(shop),
    summarizeCommissions(shop),
  ]);
  return {
    summary,
    commissions: commissions.map(toCommissionRow),
    events: events.map(toEventRow),
  };
}
