import { describe, expect, it } from "vitest";
import { RateLimitTracker } from "./rateLimitTracker.ts";

describe("RateLimitTracker", () => {
  it("should allow consumption within limits", () => {
    const tracker = new RateLimitTracker({ windowMs: 1000, maxUnits: 10 });
    expect(tracker.canConsume(5)).toBe(true);
    expect(tracker.tryConsume(5)).toBe(true);
    expect(tracker.getCurrentUsage()).toBe(5);
    expect(tracker.getRemaining()).toBe(5);
  });

  it("should reject consumption exceeding limits", () => {
    const tracker = new RateLimitTracker({ windowMs: 1000, maxUnits: 5 });
    expect(tracker.tryConsume(4)).toBe(true);
    expect(tracker.canConsume(2)).toBe(false);
    expect(tracker.tryConsume(2)).toBe(false);
    expect(tracker.getCurrentUsage()).toBe(4);
  });

  it("should slide the window and release expired units", () => {
    const tracker = new RateLimitTracker({ windowMs: 1000, maxUnits: 10 });
    const t0 = 10000;

    tracker.record(6, t0);
    expect(tracker.getCurrentUsage(t0)).toBe(6);

    // After 500ms, usage is still 6
    expect(tracker.getCurrentUsage(t0 + 500)).toBe(6);

    // After 1001ms, previous 6 units fall out of the window
    expect(tracker.getCurrentUsage(t0 + 1001)).toBe(0);
    expect(tracker.getRemaining(t0 + 1001)).toBe(10);
  });

  it("should calculate correct utilization stats", () => {
    const tracker = new RateLimitTracker({ windowMs: 2000, maxUnits: 100 });
    tracker.record(25);
    const stats = tracker.getStats();

    expect(stats.currentUsage).toBe(25);
    expect(stats.remainingUnits).toBe(75);
    expect(stats.utilizationPercentage).toBe(25);
  });

  it("should reset properly", () => {
    const tracker = new RateLimitTracker({ windowMs: 1000, maxUnits: 50 });
    tracker.record(30);
    expect(tracker.getCurrentUsage()).toBe(30);

    tracker.reset();
    expect(tracker.getCurrentUsage()).toBe(0);
  });
});
