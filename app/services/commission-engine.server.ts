import type { Commission } from "@prisma/client";
import { centsToMoneyString } from "../domain/money";
import { bpsToPercentString } from "../domain/rates";

/**
 * Client for the external commission engine — the system of record for
 * payouts in a direct-sales company (Exigo, ByDesign, a home-grown back
 * office…). This app only knows its contract: an authenticated HTTPS
 * endpoint that accepts one commission at a time and answers with a
 * reference. In development the endpoint is this app's own
 * `/simulated-engine/commissions` route.
 *
 * Every request carries an idempotency key (the commission id), so a retry
 * after a timeout cannot create a second payout on the engine's side.
 */

export interface EngineConfig {
  url: string;
  apiKey: string;
  timeoutMs: number;
}

export interface EnginePayload {
  idempotencyKey: string;
  shop: string;
  order: { id: string; name: string; paidAt: string; currency: string };
  distributor: { id: string | null; code: string | null; name: string | null };
  commission: {
    base: string;
    rate: string;
    amount: string;
    currency: string;
  };
}

export interface EngineReceipt {
  reference: string;
}

/** The engine understood the request and refused it; retrying will not help. */
export class EngineRejectedError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(
      `Engine rejected the commission (${status})${detail ? `: ${detail}` : ""}`,
    );
    this.name = "EngineRejectedError";
  }
}

/** The engine could not be reached or failed on its side; worth retrying. */
export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineUnavailableError";
  }
}

export const DEFAULT_ENGINE_KEY = "dev-engine-key";

/** Reads the engine settings; falls back to the built-in simulator on this app's URL. */
export function getEngineConfig(
  env: NodeJS.ProcessEnv = process.env,
): EngineConfig {
  const appUrl = env.SHOPIFY_APP_URL?.replace(/\/$/, "") ?? "";
  return {
    url:
      env.COMMISSION_ENGINE_URL?.trim() ||
      `${appUrl}/simulated-engine/commissions`,
    apiKey: env.COMMISSION_ENGINE_KEY?.trim() || DEFAULT_ENGINE_KEY,
    timeoutMs: Number(env.COMMISSION_ENGINE_TIMEOUT_MS) || 10_000,
  };
}

export function buildEnginePayload(commission: Commission): EnginePayload {
  return {
    idempotencyKey: commission.id,
    shop: commission.shop,
    order: {
      id: commission.orderId,
      name: commission.orderName,
      paidAt: commission.paidAt.toISOString(),
      currency: commission.orderCurrency,
    },
    distributor: {
      id: commission.distributorId,
      code: commission.referralCode,
      name: commission.distributorName,
    },
    commission: {
      base: centsToMoneyString(commission.baseCents),
      rate: bpsToPercentString(commission.rateBps),
      amount: centsToMoneyString(commission.amountCents),
      currency: commission.orderCurrency,
    },
  };
}

const RETRYABLE_STATUSES = new Set([408, 425, 429]);

export async function sendToEngine(
  commission: Commission,
  config: EngineConfig = getEngineConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<EngineReceipt> {
  let response: Response;
  try {
    response = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "Idempotency-Key": commission.id,
      },
      body: JSON.stringify(buildEnginePayload(commission)),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new EngineUnavailableError(`Engine unreachable: ${reason}`);
  }

  if (response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      reference?: string;
    };
    return { reference: body.reference ?? `HTTP-${response.status}` };
  }

  const detail = describeErrorBody(await response.text().catch(() => ""));
  if (response.status >= 500 || RETRYABLE_STATUSES.has(response.status)) {
    throw new EngineUnavailableError(
      `Engine answered ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  throw new EngineRejectedError(response.status, detail);
}

/**
 * One readable line out of an error response: the `error`, `message` or
 * `detail` field when the body is JSON, otherwise the text itself. What the
 * merchant sees on the dashboard, so it is kept short.
 */
export function describeErrorBody(text: string, maxLength = 160): string {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const field = [parsed.error, parsed.message, parsed.detail].find(
      (value) => typeof value === "string" && value.trim() !== "",
    );
    if (typeof field === "string") return field.trim().slice(0, maxLength);
  } catch {
    // Not JSON; use the text as it came.
  }
  return trimmed.replace(/\s+/g, " ").slice(0, maxLength);
}
