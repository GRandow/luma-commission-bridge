import { describe, expect, it, vi } from "vitest";
import { JobQueue } from "./job-queue.server";

function createQueue(maxAttempts = 3) {
  const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  const queue = new JobQueue({ maxAttempts, baseDelayMs: 100, sleep });
  return { queue, sleep };
}

describe("JobQueue", () => {
  it("runs jobs one after another, in order", async () => {
    const { queue } = createQueue();
    const order: string[] = [];
    const first = queue.enqueue("first", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("first");
    });
    const second = queue.enqueue("second", async () => {
      order.push("second");
    });

    await Promise.all([first, second]);

    expect(order).toEqual(["first", "second"]);
  });

  it("retries with exponential backoff and stops after the last attempt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { queue, sleep } = createQueue(3);
    const job = vi.fn().mockRejectedValue(new Error("boom"));
    const onFailure = vi.fn();

    await queue.enqueue("flaky", job, onFailure);

    expect(job).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
    expect(onFailure).toHaveBeenCalledWith(expect.any(Error), 3);
  });

  it("succeeds on a later attempt without calling the failure handler", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { queue } = createQueue(3);
    const job = vi
      .fn()
      .mockRejectedValueOnce(new Error("first try"))
      .mockResolvedValue(undefined);
    const onFailure = vi.fn();

    await queue.enqueue("recovers", job, onFailure);

    expect(job).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("keeps serving the queue after a job gives up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { queue } = createQueue(1);
    const later = vi.fn().mockResolvedValue(undefined);

    await queue.enqueue("fails", () => Promise.reject(new Error("no")));
    await queue.enqueue("next", later);

    expect(later).toHaveBeenCalledTimes(1);
  });
});
