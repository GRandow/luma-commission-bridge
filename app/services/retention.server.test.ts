import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteMany = vi.fn();
vi.mock("../db.server", () => ({
  default: { webhookEvent: { deleteMany } },
}));

const { purgeOldWebhookEvents } = await import("./retention.server");

describe("retention", () => {
  beforeEach(() => {
    deleteMany.mockReset();
  });

  it("removes webhook deliveries older than the retention window", async () => {
    deleteMany.mockResolvedValue({ count: 3 });
    const now = new Date("2026-09-24T12:00:00Z");

    const removed = await purgeOldWebhookEvents(now, 30);

    expect(removed).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { receivedAt: { lt: new Date("2026-08-25T12:00:00Z") } },
    });
  });
});
