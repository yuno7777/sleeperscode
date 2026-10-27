import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, CircuitBreakerError } from "./circuitBreaker.ts";

describe("CircuitBreaker", () => {
  it("should successfully execute actions when CLOSED", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    const result = await cb.execute(async () => 42);
    expect(result).toBe(42);
    expect(cb.getState()).toBe("CLOSED");
  });

  it("should open circuit when failure threshold is exceeded", async () => {
    const stateChanges: Array<{ from: string; to: string }> = [];
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
      onStateChange: (from, to) => stateChanges.push({ from, to }),
    });

    const failingAction = async () => {
      throw new Error("Provider timeout");
    };

    await expect(cb.execute(failingAction)).rejects.toThrow("Provider timeout");
    expect(cb.getState()).toBe("CLOSED");

    await expect(cb.execute(failingAction)).rejects.toThrow("Provider timeout");
    expect(cb.getState()).toBe("OPEN");
    expect(stateChanges).toEqual([{ from: "CLOSED", to: "OPEN" }]);

    // Subsequent call should immediately fast-fail with CircuitBreakerError
    await expect(cb.execute(async () => "ok")).rejects.toBeInstanceOf(CircuitBreakerError);
  });

  it("should transition to HALF_OPEN after timeout and close upon success", async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      recoveryTimeoutMs: 1000,
      halfOpenSuccessThreshold: 2,
    });

    await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");

    vi.advanceTimersByTime(1001);
    expect(cb.getState()).toBe("HALF_OPEN");

    // First success in HALF_OPEN
    await cb.execute(async () => "success 1");
    expect(cb.getState()).toBe("HALF_OPEN");

    // Second success in HALF_OPEN reaches threshold -> CLOSED
    await cb.execute(async () => "success 2");
    expect(cb.getState()).toBe("CLOSED");

    vi.useRealTimers();
  });

  it("should re-open immediately if half-open attempt fails", async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      recoveryTimeoutMs: 500,
      halfOpenSuccessThreshold: 2,
    });

    await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
    vi.advanceTimersByTime(501);
    expect(cb.getState()).toBe("HALF_OPEN");

    await expect(cb.execute(async () => { throw new Error("another fail"); })).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");

    vi.useRealTimers();
  });

  it("should manually reset", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");

    cb.reset();
    expect(cb.getState()).toBe("CLOSED");
  });
});
