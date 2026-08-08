// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import * as NativeRuntimeBinary from "../../nativeRuntime/NativeRuntimeBinary.ts";
import * as NativeRuntimeClient from "../../nativeRuntime/NativeRuntimeClient.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const concurrencyLevels = [1, 3, 5, 10] as const;

const runMockSession = (
  index: number,
  nativeRuntime: NativeRuntimeClient.NativeRuntimeClient["Service"],
) =>
  Effect.gen(function* () {
    const runtime = yield* AcpSessionRuntime.AcpSessionRuntime;
    const started = yield* runtime.start();
    const eventsFiber = yield* runtime
      .getEvents()
      .pipe(Stream.take(4), Stream.runCollect, Effect.forkChild);
    const prompt = yield* runtime.prompt({
      prompt: [{ type: "text", text: `stress-session-${index}` }],
    });
    const events = Array.from(yield* Fiber.join(eventsFiber));

    expect(started.sessionId).toBe("mock-session-1");
    expect(prompt.stopReason).toBe("end_turn");
    expect(events.map((event) => event._tag)).toEqual([
      "PlanUpdated",
      "AssistantItemStarted",
      "ContentDelta",
      "AssistantItemCompleted",
    ]);
  }).pipe(
    Effect.provide(
      AcpSessionRuntime.layer({
        nativeRuntime,
        spawn: {
          command: process.execPath,
          args: ["--experimental-strip-types", mockAgentPath],
        },
        cwd: process.cwd(),
        clientInfo: { name: "t3-stress-test", version: "0.0.0" },
        authMethodId: "test",
      }),
    ),
    Effect.scoped,
  );

describe("provider streaming concurrency", () => {
  for (const concurrency of concurrencyLevels) {
    it.effect(`runs ${concurrency} isolated ACP session${concurrency === 1 ? "" : "s"}`, () =>
      Effect.gen(function* () {
        const nativeRuntime = yield* NativeRuntimeClient.make().pipe(
          Effect.provide(NativeRuntimeBinary.layer),
        );
        yield* Effect.all(
          Array.from({ length: concurrency }, (_, index) => runMockSession(index, nativeRuntime)),
          { concurrency: "unbounded", discard: true },
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  }
});
