import type { Commission } from "@prisma/client";
import prisma from "../db.server";
import { extractReferralCode } from "../domain/attribution";
import { calculateCommission, DEFAULT_RATE_BPS } from "../domain/commission";
import { parseMoneyToCents } from "../domain/money";
import type { OrdersPaidPayload } from "../types/orders-paid";
import { jobQueue } from "./job-queue.server";
import { markWebhookEvent } from "./webhook-events.server";

/**
 * Turns a paid order into a commission record. Runs from the job queue, not
 * from the webhook handler itself, so Shopify gets its 200 immediately.
 *
 * Attribution comes from the `ref` note attribute the storefront put on the
 * cart. Orders without a usable code are kept as `unattributed` so the
 * merchant can see them instead of silently losing a sale. Recalculating an
 * order (a retried webhook, a manual reprocess) updates the same row: the
 * (shop, orderId) pair is unique.
 */
export async function processPaidOrder(
  shop: string,
  order: OrdersPaidPayload,
): Promise<Commission> {
  const referralCode = extractReferralCode(order.note_attributes);
  const baseCents = parseMoneyToCents(
    order.current_subtotal_price ?? order.subtotal_price,
  );
  const { rateBps, amountCents } = calculateCommission({
    baseCents,
    rateBps: DEFAULT_RATE_BPS,
  });
  const paidAt = new Date(order.processed_at ?? order.created_at);

  const values = {
    orderName: order.name,
    orderCurrency: order.currency,
    baseCents,
    rateBps,
    amountCents,
    referralCode,
    status: referralCode ? "calculated" : "unattributed",
    paidAt,
  };

  return prisma.commission.upsert({
    where: { shop_orderId: { shop, orderId: order.admin_graphql_api_id } },
    create: { shop, orderId: order.admin_graphql_api_id, ...values },
    update: values,
  });
}

interface EnqueueInput {
  webhookId: string;
  shop: string;
  order: OrdersPaidPayload;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Queues the processing of a paid order and keeps the webhook row's status current. */
export function enqueueOrderProcessing({
  webhookId,
  shop,
  order,
}: EnqueueInput): Promise<void> {
  return jobQueue.enqueue(
    `orders/paid ${order.name}`,
    async () => {
      await markWebhookEvent(webhookId, "processing");
      await processPaidOrder(shop, order);
      await markWebhookEvent(webhookId, "processed");
    },
    (error, attempts) =>
      markWebhookEvent(webhookId, "failed", {
        error: describeError(error),
        attempts,
      }),
  );
}

export function listCommissions(
  shop: string,
  limit = 50,
): Promise<Commission[]> {
  return prisma.commission.findMany({
    where: { shop },
    orderBy: { paidAt: "desc" },
    take: limit,
  });
}

export interface CommissionSummary {
  orders: number;
  attributed: number;
  /** Total commission per currency, in cents. */
  totals: Array<{ currency: string; amountCents: number }>;
}

export async function summarizeCommissions(
  shop: string,
): Promise<CommissionSummary> {
  const [orders, attributed, grouped] = await Promise.all([
    prisma.commission.count({ where: { shop } }),
    prisma.commission.count({ where: { shop, referralCode: { not: null } } }),
    prisma.commission.groupBy({
      by: ["orderCurrency"],
      where: { shop, referralCode: { not: null } },
      _sum: { amountCents: true },
    }),
  ]);
  return {
    orders,
    attributed,
    totals: grouped.map((group) => ({
      currency: group.orderCurrency,
      amountCents: group._sum.amountCents ?? 0,
    })),
  };
}
