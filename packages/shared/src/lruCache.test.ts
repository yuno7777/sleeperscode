import { describe, expect, it, vi } from "vitest";
import { LRUCache } from "./lruCache.ts";

describe("LRUCache", () => {
  it("should insert and retrieve items", () => {
    const cache = new LRUCache<string, number>({ maxSize: 3 });
    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBeUndefined();
  });

  it("should evict the least recently used item when capacity is exceeded", () => {
    const cache = new LRUCache<string, string>({ maxSize: 2 });
    cache.set("a", "alpha");
    cache.set("b", "beta");

    // Access "a" to make it recently used
    expect(cache.get("a")).toBe("alpha");

    // Inserting "c" should evict "b"
    cache.set("c", "gamma");

    expect(cache.has("a")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("should expire items according to TTL", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string, string>({ maxSize: 5, defaultTtlMs: 200 });

    cache.set("short", "lived");
    cache.set("custom", "override", 500);

    expect(cache.get("short")).toBe("lived");
    expect(cache.get("custom")).toBe("override");

    vi.advanceTimersByTime(250);
    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("custom")).toBe("override");

    vi.advanceTimersByTime(300);
    expect(cache.get("custom")).toBeUndefined();
    vi.useRealTimers();
  });

  it("should prune expired items correctly", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string, string>({ maxSize: 5 });
    cache.set("k1", "v1", 100);
    cache.set("k2", "v2", 300);
    cache.set("k3", "v3");

    vi.advanceTimersByTime(150);
    expect(cache.pruneExpired()).toBe(1);
    expect(cache.size).toBe(2);
    vi.useRealTimers();
  });

  it("should clear cache contents", () => {
    const cache = new LRUCache<string, number>({ maxSize: 3 });
    cache.set("x", 10);
    cache.set("y", 20);
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get("x")).toBeUndefined();
  });
});
