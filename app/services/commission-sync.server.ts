import type { Commission } from "@prisma/client";
import prisma from "../db.server";
import { isPayable, type CommissionStatus } from "../domain/resolve-commission";
import {
  EngineRejectedError,
  sendToEngine,
  type EngineReceipt,
} from "./commission-engine.server";
import { jobQueue } from "./job-queue.server";

/**
 * Hands a commission to the external engine and records the outcome.
 *
 * Runs as its own job, after the order write-back, so a flaky engine never
 * makes the Shopify side repeat work. Outcomes:
 *
 * - engine accepted → `synced`, with the engine's reference;
 * - engine refused (4xx) → `failed`, no retry: the payload is the problem;
 * - engine unreachable or 5xx → the queue retries with backoff, and only
 *   the last failure lands as `failed` — from where the merchant can retry
 *   by hand. Retries are safe: every request carries the commission id as
 *   an idempotency key.
 */

export type SyncStatus = "pending" | "synced" | "failed" | "skipped";

export interface SyncDeps {
  send: (commission: Commission) => Promise<EngineReceipt>;
}

const defaultDeps: SyncDeps = {
  send: (commission) => sendToEngine(commission),
};

export class CommissionSyncSkipped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CommissionSyncSkipped";
  }
}

export async function syncCommission(
  commissionId: string,
  deps: SyncDeps = defaultDeps,
): Promise<Commission> {
  const commission = await prisma.commission.findUnique({
    where: { id: commissionId },
  });
  if (!commission)
    throw new CommissionSyncSkipped(`Commission ${commissionId} not found`);
  if (commission.syncStatus === "synced") return commission;
  if (!isPayable(commission.status as CommissionStatus)) {
    return prisma.commission.update({
      where: { id: commissionId },
      data: { syncStatus: "skipped", syncError: null },
    });
  }

  try {
    const receipt = await deps.send(commission);
    return await prisma.commission.update({
      where: { id: commissionId },
      data: {
        syncStatus: "synced",
        syncReference: receipt.reference,
        syncError: null,
        syncAttempts: { increment: 1 },
        syncedAt: new Date(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.commission.update({
      where: { id: commissionId },
      data: {
        syncStatus: "failed",
        syncError: message,
        syncAttempts: { increment: 1 },
      },
    });
    if (error instanceof EngineRejectedError) {
      // Retrying an identical payload would get the same answer.
      console.error(
        `[sync] commission ${commissionId} rejected by the engine: ${message}`,
      );
      return prisma.commission.findUniqueOrThrow({
        where: { id: commissionId },
      });
    }
    throw error;
  }
}

/** Queues a sync; safe to call more than once for the same commission. */
export function enqueueCommissionSync(
  commissionId: string,
  label = commissionId,
): Promise<void> {
  return jobQueue.enqueue(`sync ${label}`, async () => {
    await syncCommission(commissionId);
  });
}
