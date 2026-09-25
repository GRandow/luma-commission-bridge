import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSimulatedEngineMode,
  handleEngineRequest,
  isSimulatedEngineMode,
  referenceFor,
  setSimulatedEngineMode,
} from "./simulated-engine.server";

function post(url: string, body: unknown, key = "secret") {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
}

const valid = { idempotencyKey: "cmf1", commission: { amount: "11.88" } };

describe("simulated commission engine", () => {
  afterEach(() => setSimulatedEngineMode("normal"));

  it("accepts a valid commission with a deterministic reference", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await handleEngineRequest(
      post("https://app.example/simulated-engine/commissions", valid),
      "secret",
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as { reference: string };
    expect(body.reference).toBe(referenceFor("cmf1"));
    expect(body.reference).toMatch(/^ENG-[0-9A-F]{8}$/);
  });

  it("rejects bad credentials, methods and payloads", async () => {
    expect(
      (await handleEngineRequest(post("https://x/e", valid, "wrong"), "secret"))
        .status,
    ).toBe(401);
    expect(
      (
        await handleEngineRequest(
          new Request("https://x/e", { method: "GET" }),
          "secret",
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await handleEngineRequest(
          post("https://x/e", {
            idempotencyKey: "k",
            commission: { amount: "0" },
          }),
          "secret",
        )
      ).status,
    ).toBe(422);
    expect(
      (await handleEngineRequest(post("https://x/e", {}), "secret")).status,
    ).toBe(422);
  });

  it("simulates outages and rejections from the URL", async () => {
    expect(
      (
        await handleEngineRequest(
          post("https://x/e?mode=fail", valid),
          "secret",
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await handleEngineRequest(
          post("https://x/e?mode=reject", valid),
          "secret",
        )
      ).status,
    ).toBe(422);
  });

  it("follows the mode switched from the dashboard", async () => {
    expect(getSimulatedEngineMode()).toBe("normal");

    setSimulatedEngineMode("fail");
    expect(
      (await handleEngineRequest(post("https://x/e", valid), "secret")).status,
    ).toBe(503);

    setSimulatedEngineMode("reject");
    expect(
      (await handleEngineRequest(post("https://x/e", valid), "secret")).status,
    ).toBe(422);

    setSimulatedEngineMode("normal");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(
      (await handleEngineRequest(post("https://x/e", valid), "secret")).status,
    ).toBe(202);
  });

  it("lets a mode in the URL override the switch", async () => {
    setSimulatedEngineMode("fail");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(
      (
        await handleEngineRequest(
          post("https://x/e?mode=normal", valid),
          "secret",
        )
      ).status,
    ).toBe(202);
  });

  it("knows which modes exist", () => {
    expect(isSimulatedEngineMode("fail")).toBe(true);
    expect(isSimulatedEngineMode("normal")).toBe(true);
    expect(isSimulatedEngineMode("explode")).toBe(false);
    expect(isSimulatedEngineMode(null)).toBe(false);
  });
});
