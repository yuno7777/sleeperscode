import { describe, expect, it, vi } from "vitest";
import { retryUntilDefined, retryWithBackoff } from "./retryBackoff.ts";

describe("retryWithBackoff", () => {
  it("should return immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1 });

    expect(result.value).toBe("ok");
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure and succeed eventually", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("temporary failure");
      return "success";
    });

    const result = await retryWithBackoff(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      jitter: false,
    });

    expect(result.value).toBe("success");
    expect(result.attempts).toBe(3);
  });

  it("should throw after exhausting maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1, jitter: false })
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should stop retrying when retryIf returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fatal"));

    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        retryIf: (err) => (err as Error).message !== "fatal",
      })
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should call onRetry with attempt info", async () => {
    const retries: { attempt: number; delay: number }[] = [];
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("fail");
      return "done";
    });

    await retryWithBackoff(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      jitter: false,
      onRetry: (_, attempt, delayMs) => retries.push({ attempt, delay: delayMs }),
    });

    expect(retries).toHaveLength(2);
    expect(retries[0].attempt).toBe(1);
    expect(retries[1].attempt).toBe(2);
  });
});

describe("retryUntilDefined", () => {
  it("should resolve when fn returns a defined value", async () => {
    let count = 0;
    const result = await retryUntilDefined(async () => {
      count++;
      return count >= 2 ? "defined!" : null;
    }, { maxAttempts: 5, baseDelayMs: 1, jitter: false });

    expect(result).toBe("defined!");
  });

  it("should throw if value is never defined", async () => {
    await expect(
      retryUntilDefined(async () => null, { maxAttempts: 2, baseDelayMs: 1 })
    ).rejects.toThrow();
  });
});
