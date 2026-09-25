import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EngineRejectedError,
  EngineUnavailableError,
} from "./commission-engine.server";

const findUnique = vi.fn();
const findUniqueOrThrow = vi.fn();
const update = vi.fn();
vi.mock("../db.server", () => ({
  default: { commission: { findUnique, findUniqueOrThrow, update } },
}));

const { syncCommission } = await import("./commission-sync.server");

const base = {
  id: "cmf1",
  status: "written_back",
  syncStatus: "pending",
  amountCents: 1188,
};

describe("syncCommission", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findUniqueOrThrow.mockReset();
    update
      .mockReset()
      .mockImplementation(({ data }) => Promise.resolve({ ...base, ...data }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("marks the commission synced with the engine's reference", async () => {
    findUnique.mockResolvedValue(base);
    const send = vi.fn().mockResolvedValue({ reference: "ENG-ABC" });

    const result = await syncCommission("cmf1", { send });

    expect(send).toHaveBeenCalledWith(base);
    expect(update).toHaveBeenCalledWith({
      where: { id: "cmf1" },
      data: expect.objectContaining({
        syncStatus: "synced",
        syncReference: "ENG-ABC",
        syncAttempts: { increment: 1 },
      }),
    });
    expect(result.syncStatus).toBe("synced");
  });

  it("records an outage and rethrows so the queue retries", async () => {
    findUnique.mockResolvedValue(base);
    const send = vi
      .fn()
      .mockRejectedValue(new EngineUnavailableError("engine down"));

    await expect(syncCommission("cmf1", { send })).rejects.toThrow(
      "engine down",
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: "cmf1" },
      data: {
        syncStatus: "failed",
        syncError: "engine down",
        syncAttempts: { increment: 1 },
      },
    });
  });

  it("records a rejection without retrying", async () => {
    findUnique.mockResolvedValue(base);
    findUniqueOrThrow.mockResolvedValue({ ...base, syncStatus: "failed" });
    const send = vi
      .fn()
      .mockRejectedValue(new EngineRejectedError(422, "bad payload"));

    const result = await syncCommission("cmf1", { send });

    expect(result.syncStatus).toBe("failed");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("skips commissions that are not payable and leaves synced ones alone", async () => {
    findUnique.mockResolvedValueOnce({ ...base, status: "unattributed" });
    const send = vi.fn();

    await syncCommission("cmf1", { send });
    expect(send).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: "cmf1" },
      data: { syncStatus: "skipped", syncError: null },
    });

    findUnique.mockResolvedValueOnce({ ...base, syncStatus: "synced" });
    await syncCommission("cmf1", { send });
    expect(send).not.toHaveBeenCalled();
  });
});
