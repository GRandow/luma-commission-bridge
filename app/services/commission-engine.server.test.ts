import type { Commission } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  buildEnginePayload,
  describeErrorBody,
  EngineRejectedError,
  EngineUnavailableError,
  getEngineConfig,
  sendToEngine,
} from "./commission-engine.server";

const commission: Commission = {
  id: "cmf1",
  shop: "luma-dev.myshopify.com",
  orderId: "gid://shopify/Order/1006",
  orderName: "#1006",
  orderCurrency: "USD",
  baseCents: 9500,
  rateBps: 1250,
  amountCents: 1188,
  referralCode: "BRUNO77",
  distributorId: "gid://shopify/Metaobject/2",
  distributorName: "Bruno Lima",
  status: "written_back",
  writebackError: null,
  syncStatus: "pending",
  syncAttempts: 0,
  syncError: null,
  syncReference: null,
  syncedAt: null,
  paidAt: new Date("2026-09-24T23:16:00Z"),
  createdAt: new Date("2026-09-24T23:16:05Z"),
  updatedAt: new Date("2026-09-24T23:16:05Z"),
};

const config = {
  url: "https://engine.example/commissions",
  apiKey: "secret",
  timeoutMs: 1000,
};

function fetchReturning(status: number, body: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("commission engine client", () => {
  it("defaults to the built-in simulator on the app's own URL", () => {
    expect(
      getEngineConfig({ SHOPIFY_APP_URL: "https://tunnel.example/" }),
    ).toEqual({
      url: "https://tunnel.example/simulated-engine/commissions",
      apiKey: "dev-engine-key",
      timeoutMs: 10_000,
    });
    expect(
      getEngineConfig({
        COMMISSION_ENGINE_URL: "https://engine.example/api",
        COMMISSION_ENGINE_KEY: "k",
        COMMISSION_ENGINE_TIMEOUT_MS: "500",
      }),
    ).toEqual({
      url: "https://engine.example/api",
      apiKey: "k",
      timeoutMs: 500,
    });
  });

  it("builds a payload with money as decimal strings and the id as idempotency key", () => {
    expect(buildEnginePayload(commission)).toEqual({
      idempotencyKey: "cmf1",
      shop: "luma-dev.myshopify.com",
      order: {
        id: "gid://shopify/Order/1006",
        name: "#1006",
        paidAt: "2026-09-24T23:16:00.000Z",
        currency: "USD",
      },
      distributor: {
        id: "gid://shopify/Metaobject/2",
        code: "BRUNO77",
        name: "Bruno Lima",
      },
      commission: {
        base: "95.00",
        rate: "12.50",
        amount: "11.88",
        currency: "USD",
      },
    });
  });

  it("posts with bearer auth and an idempotency key and returns the reference", async () => {
    const fetchImpl = fetchReturning(202, { reference: "ENG-1" });

    await expect(sendToEngine(commission, config, fetchImpl)).resolves.toEqual({
      reference: "ENG-1",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(config.url);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer secret");
    expect(headers.get("idempotency-key")).toBe("cmf1");
    expect(JSON.parse(String(init?.body)).commission.amount).toBe("11.88");
  });

  it("treats 5xx and network failures as retryable", async () => {
    const error = await sendToEngine(
      commission,
      config,
      fetchReturning(503, { error: "down for maintenance" }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineUnavailableError);
    // The dashboard shows this line: the body's message, not its JSON.
    expect((error as Error).message).toBe(
      "Engine answered 503: down for maintenance",
    );
    const offline = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(sendToEngine(commission, config, offline)).rejects.toThrow(
      "unreachable: ECONNREFUSED",
    );
  });

  it("treats 4xx as a rejection that should not be retried", async () => {
    const error = await sendToEngine(
      commission,
      config,
      fetchReturning(422, { error: "bad" }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineRejectedError);
    expect((error as EngineRejectedError).status).toBe(422);
    expect((error as Error).message).toBe(
      "Engine rejected the commission (422): bad",
    );
  });

  it("turns error bodies into one readable line", () => {
    expect(describeErrorBody('{"error":"Engine unavailable"}')).toBe(
      "Engine unavailable",
    );
    expect(describeErrorBody('{"message":"  Too many requests "}')).toBe(
      "Too many requests",
    );
    expect(describeErrorBody('{"code":42}')).toBe('{"code":42}');
    expect(describeErrorBody("<html>\n  Bad gateway\n</html>")).toBe(
      "<html> Bad gateway </html>",
    );
    expect(describeErrorBody("x".repeat(500)).length).toBe(160);
    expect(describeErrorBody("")).toBe("");
  });
});
