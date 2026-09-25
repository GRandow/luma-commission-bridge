import { Prisma, type WebhookEvent } from "@prisma/client";
import prisma from "../db.server";

/**
 * Every webhook delivery is recorded under Shopify's webhook id before any
 * work happens. Shopify retries deliveries it did not get a 200 for, and the
 * same order can also fire more than once, so the id is the idempotency key:
 * a second insert fails on the primary key and the retry is ignored.
 */

export type WebhookEventStatus =
  "received" | "processing" | "processed" | "failed";

interface RecordInput {
  id: string;
  shop: string;
  topic: string;
  payload: unknown;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/** Stores the delivery; `isNew` is false when this webhook id was already seen. */
export async function recordWebhookEvent({
  id,
  shop,
  topic,
  payload,
}: RecordInput): Promise<{ isNew: boolean }> {
  try {
    await prisma.webhookEvent.create({
      data: { id, shop, topic, payload: JSON.stringify(payload) },
    });
    return { isNew: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { isNew: false };
    throw error;
  }
}

export async function markWebhookEvent(
  id: string,
  status: WebhookEventStatus,
  details: { error?: string | null; attempts?: number } = {},
): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id },
    data: {
      status,
      error: details.error ?? null,
      ...(details.attempts !== undefined ? { attempts: details.attempts } : {}),
      ...(status === "processed" ? { processedAt: new Date() } : {}),
    },
  });
}

export function getWebhookEvent(id: string): Promise<WebhookEvent | null> {
  return prisma.webhookEvent.findUnique({ where: { id } });
}

export function listRecentWebhookEvents(
  shop: string,
  limit = 20,
): Promise<WebhookEvent[]> {
  return prisma.webhookEvent.findMany({
    where: { shop },
    orderBy: { receivedAt: "desc" },
    take: limit,
  });
}

/** Parses the stored payload; `null` when the row holds something unexpected. */
export function parseStoredPayload<T>(event: WebhookEvent): T | null {
  try {
    return JSON.parse(event.payload) as T;
  } catch {
    return null;
  }
}
