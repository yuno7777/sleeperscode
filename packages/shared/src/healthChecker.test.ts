import { describe, expect, it, vi } from "vitest";
import { HealthChecker } from "./healthChecker.ts";

describe("HealthChecker", () => {
  it("should report healthy when all checks pass", async () => {
    const checker = new HealthChecker();
    checker.register({ name: "db", checkFn: async () => true });
    checker.register({ name: "fs", checkFn: async () => true });

    const result = await checker.runAll();
    expect(result.status).toBe("healthy");
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((c) => c.status === "healthy")).toBe(true);
  });

  it("should report degraded when non-critical check fails", async () => {
    const checker = new HealthChecker();
    checker.register({ name: "provider", checkFn: async () => false, criticalOnFail: false });

    const result = await checker.runAll();
    expect(result.status).toBe("degraded");
    expect(result.checks[0].status).toBe("degraded");
    expect(result.checks[0].critical).toBe(false);
  });

  it("should report unhealthy when critical check throws", async () => {
    const checker = new HealthChecker();
    checker.register({
      name: "database",
      checkFn: async () => { throw new Error("connection refused"); },
      criticalOnFail: true,
    });
    checker.register({ name: "cache", checkFn: async () => true });

    const result = await checker.runAll();
    expect(result.status).toBe("unhealthy");
    const dbCheck = result.checks.find((c) => c.name === "database")!;
    expect(dbCheck.status).toBe("unhealthy");
    expect(dbCheck.error).toContain("connection refused");
  });

  it("should enforce timeout", async () => {
    vi.useFakeTimers();
    const checker = new HealthChecker();
    checker.register({
      name: "slow-service",
      checkFn: () => new Promise((resolve) => setTimeout(() => resolve(true), 5000)),
      timeoutMs: 100,
      criticalOnFail: false,
    });

    const resultPromise = checker.runAll();
    vi.advanceTimersByTime(150);
    const result = await resultPromise;

    expect(result.checks[0].status).toBe("unhealthy");
    expect(result.checks[0].error).toContain("Timeout");
    vi.useRealTimers();
  });

  it("should support running a subset of checks by name", async () => {
    const checker = new HealthChecker();
    checker.register({ name: "a", checkFn: async () => true });
    checker.register({ name: "b", checkFn: async () => false });
    checker.register({ name: "c", checkFn: async () => true });

    const result = await checker.runAll(["a", "c"]);
    expect(result.checks).toHaveLength(2);
    expect(result.checks.map((c) => c.name)).toEqual(["a", "c"]);
  });

  it("should unregister a check", async () => {
    const checker = new HealthChecker();
    checker.register({ name: "removable", checkFn: async () => true });
    expect(checker.unregister("removable")).toBe(true);
    expect(checker.unregister("removable")).toBe(false);

    const result = await checker.runAll();
    expect(result.checks).toHaveLength(0);
  });
});
