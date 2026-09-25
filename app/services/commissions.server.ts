import type { Commission } from "@prisma/client";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { extractReferralCode } from "../domain/attribution";
import { parseMoneyToCents } from "../domain/money";
import { isPayable, resolveCommission } from "../domain/resolve-commission";
import type { OrdersPaidPayload } from "../types/orders-paid";
import type { AdminGraphql } from "./admin-graphql.server";
import { findDistributorByCode, type Distributor } from "./distributors.server";
import { enqueueCommissionSync } from "./commission-sync.server";
import { jobQueue } from "./job-queue.server";
import { writeCommissionToOrder } from "./order-writeback.server";
import { markWebhookEvent } from "./webhook-events.server";

/**
 * Everything the processing step talks to, injectable so the pipeline can
 * be tested without Shopify or a database.
 */
export interface ProcessingDeps {
  getAdmin: (shop: string) => Promise<AdminGraphql>;
  findDistributorByCode: (
    client: AdminGraphql,
    code: string,
  ) => Promise<Distributor | null>;
  writeCommissionToOrder: typeof writeCommissionToOrder;
}

const defaultDeps: ProcessingDeps = {
  getAdmin: async (shop) => (await unauthenticated.admin(shop)).admin,
  findDistributorByCode,
  writeCommissionToOrder,
};

/**
 * Turns a paid order into a commission record and writes it back to the
 * order. Runs from the job queue, not from the webhook handler, so Shopify
 * gets its 200 immediately.
 *
 * 1. Read the `ref` note attribute the storefront put on the cart.
 * 2. Look the distributor up (a metaobject) and apply their rate; orders
 *    with no code, an unknown code or an inactive distributor are kept with
 *    a status that says so, never silently dropped.
 * 3. Store the commission — unique per (shop, orderId), so a retried webhook
 *    or a manual reprocess updates the same row instead of paying twice.
 * 4. Write metafields and a tag on the order. A failed write-back is
 *    recorded on the row and rethrown so the queue retries it.
 * 5. Queue the hand-off to the commission engine as a separate job
 *    (`commission-sync.server.ts`), so engine trouble never repeats
 *    Shopify work.
 */
export async function processPaidOrder(
  shop: string,
  order: OrdersPaidPayload,
  deps: ProcessingDeps = defaultDeps,
): Promise<Commission> {
  const referralCode = extractReferralCode(order.note_attributes);
  const baseCents = parseMoneyToCents(
    order.current_subtotal_price ?? order.subtotal_price,
  );
  const paidAt = new Date(order.processed_at ?? order.created_at);

  const admin = await deps.getAdmin(shop);
  const distributor = referralCode
    ? await deps.findDistributorByCode(admin, referralCode)
    : null;
  const resolved = resolveCommission({ referralCode, distributor, baseCents });
  const payable = isPayable(resolved.status);

  const values = {
    orderName: order.name,
    orderCurrency: order.currency,
    baseCents,
    rateBps: resolved.rateBps,
    amountCents: resolved.amountCents,
    referralCode,
    distributorId: resolved.distributorId,
    distributorName: resolved.distributorName,
    status: resolved.status,
    writebackError: null,
    // Nothing to hand to the engine when the order pays no commission.
    ...(payable ? {} : { syncStatus: "skipped" }),
    paidAt,
  };
  const commission = await prisma.commission.upsert({
    where: { shop_orderId: { shop, orderId: order.admin_graphql_api_id } },
    create: { shop, orderId: order.admin_graphql_api_id, ...values },
    update: values,
  });

  if (!payable || !distributor) return commission;

  try {
    await deps.writeCommissionToOrder(admin, {
      orderId: order.admin_graphql_api_id,
      amountCents: resolved.amountCents,
      currency: order.currency,
      rateBps: resolved.rateBps,
      distributorCode: distributor.code,
      distributorName: distributor.name,
    });
  } catch (error) {
    await prisma.commission.update({
      where: { id: commission.id },
      data: { writebackError: describeError(error) },
    });
    throw error;
  }

  const written = await prisma.commission.update({
    where: { id: commission.id },
    data: { status: "written_back", syncStatus: "pending" },
  });
  void enqueueCommissionSync(written.id, order.name);
  return written;
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
  /** Total payable commission per currency, in cents. */
  totals: Array<{ currency: string; amountCents: number }>;
}

const PAYABLE_STATUSES = ["calculated", "written_back"];

export async function summarizeCommissions(
  shop: string,
): Promise<CommissionSummary> {
  const [orders, attributed, grouped] = await Promise.all([
    prisma.commission.count({ where: { shop } }),
    prisma.commission.count({
      where: { shop, status: { in: PAYABLE_STATUSES } },
    }),
    prisma.commission.groupBy({
      by: ["orderCurrency"],
      where: { shop, status: { in: PAYABLE_STATUSES } },
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
