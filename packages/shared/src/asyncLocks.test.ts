import { describe, expect, it } from "vitest";
import { AsyncMutex, AsyncSemaphore } from "./asyncLocks.ts";

describe("AsyncMutex", () => {
  it("should grant the lock immediately when free", async () => {
    const mutex = new AsyncMutex();
    expect(mutex.isLocked).toBe(false);

    const release = await mutex.acquire();
    expect(mutex.isLocked).toBe(true);
    release();
    expect(mutex.isLocked).toBe(false);
  });

  it("should queue concurrent acquires and serialize them", async () => {
    const mutex = new AsyncMutex();
    const log: string[] = [];

    const taskA = mutex.runExclusive(async () => {
      log.push("A-start");
      await new Promise((r) => setTimeout(r, 20));
      log.push("A-end");
    });

    const taskB = mutex.runExclusive(async () => {
      log.push("B-start");
      log.push("B-end");
    });

    await Promise.all([taskA, taskB]);
    expect(log).toEqual(["A-start", "A-end", "B-start", "B-end"]);
  });

  it("should release the lock after an exception in runExclusive", async () => {
    const mutex = new AsyncMutex();

    await expect(
      mutex.runExclusive(async () => { throw new Error("fail"); })
    ).rejects.toThrow("fail");

    expect(mutex.isLocked).toBe(false);
    // Should still be acquirable
    const release = await mutex.acquire();
    expect(mutex.isLocked).toBe(true);
    release();
  });

  it("tryAcquire should return null when locked", async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();

    expect(mutex.tryAcquire()).toBeNull();
    release();

    const release2 = mutex.tryAcquire();
    expect(release2).not.toBeNull();
    release2!();
  });

  it("should track stats", async () => {
    const mutex = new AsyncMutex();
    await mutex.runExclusive(async () => null);
    await mutex.runExclusive(async () => null);

    const stats = mutex.stats;
    expect(stats.totalAcquired).toBe(2);
    expect(stats.isLocked).toBe(false);
  });
});

describe("AsyncSemaphore", () => {
  it("should allow up to N concurrent acquires", async () => {
    const sem = new AsyncSemaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();

    expect(sem.freePermits).toBe(0);

    let r3Resolved = false;
    const p3 = sem.acquire().then((r) => { r3Resolved = true; return r; });

    await new Promise((r) => setTimeout(r, 20));
    expect(r3Resolved).toBe(false); // blocked

    r1();
    await p3.then((r) => r());
    r2();

    expect(sem.freePermits).toBe(2);
  });

  it("should run with permit and release automatically", async () => {
    const sem = new AsyncSemaphore(1);
    const result = await sem.runWithPermit(async () => "done");
    expect(result).toBe("done");
    expect(sem.freePermits).toBe(1);
  });

  it("should release permit even after thrown error", async () => {
    const sem = new AsyncSemaphore(1);
    await expect(
      sem.runWithPermit(async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");
    expect(sem.freePermits).toBe(1);
  });

  it("should report correct stats", async () => {
    const sem = new AsyncSemaphore(3);
    const r = await sem.acquire();
    r();

    const stats = sem.getStats();
    expect(stats.permits).toBe(3);
    expect(stats.totalAcquired).toBe(1);
    expect(stats.freePermits).toBe(3);
  });
});
