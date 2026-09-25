import prisma from "../db.server";

/**
 * Data retention. Webhook payloads are the only place raw order data lives;
 * they exist to make processing reproducible (reprocess from the admin) and
 * are dropped after a month. Commission records stay, since they are the
 * ledger the merchant pays distributors from.
 */

export const WEBHOOK_RETENTION_DAYS = 30;

/** Deletes webhook deliveries older than the retention window. */
export async function purgeOldWebhookEvents(
  now = new Date(),
  retentionDays = WEBHOOK_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.webhookEvent.deleteMany({
    where: { receivedAt: { lt: cutoff } },
  });
  return count;
}

let lastPurgeAt = 0;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Runs the purge at most once an hour, from a request the app is serving
 * anyway. Cheap enough for a single-process app; a scheduled job would take
 * its place in production.
 */
export async function purgeOldWebhookEventsIfDue(
  now = Date.now(),
): Promise<void> {
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  try {
    const removed = await purgeOldWebhookEvents(new Date(now));
    if (removed > 0)
      console.log(`[retention] removed ${removed} webhook payloads`);
  } catch (error) {
    console.error("[retention] purge failed", error);
  }
}

/** Forgets everything the app holds about a shop; called when it is uninstalled. */
export async function deleteShopData(shop: string): Promise<void> {
  await prisma.$transaction([
    prisma.commission.deleteMany({ where: { shop } }),
    prisma.webhookEvent.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}
