import { createHash } from "node:crypto";

/**
 * A stand-in for the external commission engine, so the whole flow runs on
 * one development store without a second system. It behaves like a real
 * integration target: bearer-token auth, JSON in, a reference out, and the
 * same reference for the same idempotency key.
 *
 * Failures are reproducible on demand. The dashboard switches the simulator
 * between modes (`setSimulatedEngineMode`), and a `?mode=` query on the
 * endpoint URL forces one — handy when `COMMISSION_ENGINE_URL` is set by
 * hand or the endpoint is exercised with curl:
 *
 *   fail    → 503, as if the engine were down (the app retries)
 *   reject  → 422, as if the payload were invalid (no retry)
 */

export type SimulatedEngineMode = "normal" | "fail" | "reject";

export const SIMULATED_ENGINE_MODES: readonly SimulatedEngineMode[] = [
  "normal",
  "fail",
  "reject",
];

export function isSimulatedEngineMode(
  value: unknown,
): value is SimulatedEngineMode {
  return SIMULATED_ENGINE_MODES.includes(value as SimulatedEngineMode);
}

declare global {
  // eslint-disable-next-line no-var
  var simulatedEngineModeGlobal: SimulatedEngineMode | undefined;
}

/**
 * The mode the simulator answers with. Process-wide, like the simulator
 * itself; kept on `global` so a dev-server reload does not reset it.
 */
export function getSimulatedEngineMode(): SimulatedEngineMode {
  return global.simulatedEngineModeGlobal ?? "normal";
}

export function setSimulatedEngineMode(mode: SimulatedEngineMode): void {
  global.simulatedEngineModeGlobal = mode;
}

interface EngineRequestBody {
  idempotencyKey?: string;
  commission?: { amount?: string };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Deterministic reference: retrying the same commission yields the same id. */
export function referenceFor(idempotencyKey: string): string {
  return `ENG-${createHash("sha1").update(idempotencyKey).digest("hex").slice(0, 8).toUpperCase()}`;
}

export async function handleEngineRequest(
  request: Request,
  apiKey: string,
): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Use POST" });
  if (request.headers.get("authorization") !== `Bearer ${apiKey}`) {
    return json(401, { error: "Invalid or missing API key" });
  }

  // A mode in the URL wins; otherwise the switch on the dashboard decides.
  const mode =
    new URL(request.url).searchParams.get("mode") ?? getSimulatedEngineMode();
  if (mode === "fail")
    return json(503, { error: "Engine unavailable (simulated outage)" });
  if (mode === "reject")
    return json(422, { error: "Rejected on purpose (simulated)" });

  let body: EngineRequestBody;
  try {
    body = (await request.json()) as EngineRequestBody;
  } catch {
    return json(400, { error: "Body must be JSON" });
  }
  if (!body.idempotencyKey)
    return json(422, { error: "idempotencyKey is required" });
  const amount = Number(body.commission?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return json(422, { error: "commission.amount must be a positive amount" });
  }

  console.log(
    `[engine] accepted commission ${body.idempotencyKey} (${amount})`,
  );
  return json(202, {
    reference: referenceFor(body.idempotencyKey),
    receivedAt: new Date().toISOString(),
  });
}
