import { describe, expect, it } from "vitest";
import { TaskQueue } from "./taskQueue.ts";

describe("TaskQueue", () => {
  it("should process tasks up to concurrency limit", async () => {
    const order: number[] = [];
    const queue = new TaskQueue({ concurrency: 2 });

    const tasks = [1, 2, 3, 4].map((n) =>
      queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(n);
        return n;
      })
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([1, 2, 3, 4]);
    expect(order).toHaveLength(4);
  });

  it("should respect task priority ordering", async () => {
    const order: string[] = [];
    const queue = new TaskQueue({ concurrency: 1 });

    // Enqueue low first, then high; high should run before low
    const lowTask = queue.enqueue(
      async () => { order.push("low"); return "low"; },
      { priority: "low" }
    );
    const highTask = queue.enqueue(
      async () => { order.push("high"); return "high"; },
      { priority: "high" }
    );
    const normalTask = queue.enqueue(
      async () => { order.push("normal"); return "normal"; },
      { priority: "normal" }
    );

    await Promise.all([lowTask, highTask, normalTask]);
    expect(order[0]).toBe("low"); // already running when enqueued
    // high should have run before normal
    const highIdx = order.indexOf("high");
    const normalIdx = order.indexOf("normal");
    expect(highIdx).toBeLessThan(normalIdx);
  });

  it("should propagate errors from tasks", async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const failing = queue.enqueue(() => Promise.reject(new Error("task error")));
    await expect(failing).rejects.toThrow("task error");
    expect(queue.getStats().failed).toBe(1);
  });

  it("should cancel a queued task", async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    // Fill concurrency slot
    const blocker = queue.enqueue(
      () => new Promise((r) => setTimeout(r, 100)),
      { id: "blocker" }
    );

    const target = queue.enqueue(async () => "should not run", { id: "target" });
    const cancelled = queue.cancel("target");

    expect(cancelled).toBe(true);
    await expect(target).rejects.toThrow("cancelled");
    queue.cancel("blocker");
    await blocker.catch(() => null);
  });

  it("should track stats correctly", async () => {
    const queue = new TaskQueue({ concurrency: 2 });
    await queue.enqueue(async () => "a");
    await queue.enqueue(async () => "b");

    const stats = queue.getStats();
    expect(stats.completed).toBe(2);
    expect(stats.failed).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.running).toBe(0);
  });
});
