import { describe, expect, it, vi } from "vitest";
import { BatchProcessor } from "./batchProcessor.ts";

describe("BatchProcessor", () => {
  it("should process items when maxBatchSize is reached", async () => {
    const batches: number[][] = [];
    const processor = new BatchProcessor<number>({
      maxBatchSize: 3,
      maxWaitMs: 1000,
      processor: async (batch) => { batches.push(batch); },
    });

    processor.add(1);
    processor.add(2);
    processor.add(3); // triggers flush
    await processor.drain();

    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches.flat()).toEqual([1, 2, 3]);
  });

  it("should flush on timer expiry", async () => {
    vi.useFakeTimers();
    const batches: string[][] = [];
    const processor = new BatchProcessor<string>({
      maxBatchSize: 100,
      maxWaitMs: 200,
      processor: async (batch) => { batches.push(batch); },
    });

    processor.add("a");
    processor.add("b");

    vi.advanceTimersByTime(250);
    await processor.drain();
    vi.useRealTimers();

    expect(batches.flat()).toEqual(["a", "b"]);
  });

  it("should call onError instead of throwing", async () => {
    const errors: unknown[] = [];
    const processor = new BatchProcessor<string>({
      maxBatchSize: 1,
      processor: async () => { throw new Error("write failed"); },
      onError: (err) => { errors.push(err); },
    });

    processor.add("item");
    await processor.drain();

    expect(errors.length).toBe(1);
    expect((errors[0] as Error).message).toBe("write failed");
  });

  it("should discard all pending items", () => {
    const processor = new BatchProcessor<number>({
      maxBatchSize: 10,
      processor: async () => {},
    });
    processor.addMany([1, 2, 3, 4]);
    const discarded = processor.discard();
    expect(discarded).toBe(4);
    expect(processor.getStats().pendingCount).toBe(0);
  });

  it("should track totalProcessed across multiple flushes", async () => {
    const processor = new BatchProcessor<number>({
      maxBatchSize: 2,
      processor: async () => {},
    });

    processor.addMany([1, 2, 3, 4]);
    await processor.drain();

    expect(processor.getStats().totalProcessed).toBe(4);
  });

  it("should addMany and process all items", async () => {
    const results: number[] = [];
    const processor = new BatchProcessor<number>({
      maxBatchSize: 5,
      processor: async (batch) => { results.push(...batch); },
    });

    processor.addMany([10, 20, 30, 40, 50, 60]);
    await processor.drain();

    expect(results.sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50, 60]);
  });
});
