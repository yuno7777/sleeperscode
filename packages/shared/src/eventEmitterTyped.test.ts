import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "./eventEmitterTyped.ts";

interface TestEvents {
  "agent:start": { agentId: string };
  "agent:progress": { percent: number; step: string };
  "agent:error": { message: string };
}

describe("TypedEventEmitter", () => {
  it("should register and emit synchronous and asynchronous events", async () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const received: string[] = [];

    emitter.on("agent:start", (data) => {
      received.push(`start:${data.agentId}`);
    });

    emitter.on("agent:start", async (data) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      received.push(`async:${data.agentId}`);
    });

    await emitter.emit("agent:start", { agentId: "agent-007" });

    expect(received).toContain("start:agent-007");
    expect(received).toContain("async:agent-007");
  });

  it("should support once listener", async () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    let count = 0;

    emitter.once("agent:error", () => {
      count++;
    });

    await emitter.emit("agent:error", { message: "Error 1" });
    await emitter.emit("agent:error", { message: "Error 2" });

    expect(count).toBe(1);
    expect(emitter.listenerCount("agent:error")).toBe(0);
  });

  it("should unsubscribe via returned callback", async () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    let calls = 0;

    const unsubscribe = emitter.on("agent:progress", () => {
      calls++;
    });

    await emitter.emit("agent:progress", { percent: 50, step: "halfway" });
    expect(calls).toBe(1);

    unsubscribe();
    await emitter.emit("agent:progress", { percent: 100, step: "done" });
    expect(calls).toBe(1);
  });

  it("should remove all listeners", async () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    emitter.on("agent:start", () => {});
    emitter.on("agent:progress", () => {});

    expect(emitter.listenerCount("agent:start")).toBe(1);
    expect(emitter.listenerCount("agent:progress")).toBe(1);

    emitter.removeAllListeners("agent:start");
    expect(emitter.listenerCount("agent:start")).toBe(0);
    expect(emitter.listenerCount("agent:progress")).toBe(1);

    emitter.removeAllListeners();
    expect(emitter.listenerCount("agent:progress")).toBe(0);
  });
});
