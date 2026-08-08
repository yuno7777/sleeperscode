import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { NativeRuntimeClient, layer } from "./NativeRuntimeClient.ts";

const TestLayer = layer.pipe(Layer.provide(NodeServices.layer));

describe("NativeRuntimeClient", () => {
  it.live("runs a real process through the Rust sidecar", () =>
    Effect.gen(function* () {
      const runtime = yield* NativeRuntimeClient;
      const result = yield* runtime.run({
        command: process.execPath,
        args: ["-e", 'process.stdout.write("native-out"); process.stderr.write("native-err")'],
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
        outputMode: "error",
        truncatedMarker: "",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("native-out");
      expect(result.stderr).toBe("native-err");
      expect(result.timedOut).toBe(false);
      expect(result.cancelled).toBe(false);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("reuses the sidecar for concurrent bounded requests", () =>
    Effect.gen(function* () {
      const runtime = yield* NativeRuntimeClient;
      const run = (value: string) =>
        runtime.run({
          command: process.execPath,
          args: ["-e", `setTimeout(() => process.stdout.write(${JSON.stringify(value)}), 100)`],
          timeoutMs: 5_000,
          maxOutputBytes: 4_096,
          outputMode: "error",
          truncatedMarker: "",
        });
      const [first, second] = yield* Effect.all([run("one"), run("two")], {
        concurrency: "unbounded",
      });

      expect(first.stdout).toBe("one");
      expect(second.stdout).toBe("two");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("round-trips binary stdin larger than one protocol chunk", () =>
    Effect.gen(function* () {
      const runtime = yield* NativeRuntimeClient;
      const session = yield* runtime.startStreaming({
        command: process.execPath,
        args: ["-e", "process.stdin.pipe(process.stdout)"],
      });
      const outputFiber = yield* Effect.forkChild(Stream.runCollect(session.output), {
        startImmediately: true,
      });
      const expected = Uint8Array.from(
        { length: 64 * 1024 + 257 },
        (_, index) => (index * 31) % 256,
      );

      yield* session.write(expected);
      yield* session.closeStdin;
      const exit = yield* session.exit;
      const events = Array.from(yield* Fiber.join(outputFiber));
      const stdout = Buffer.concat(
        events
          .filter((event) => event.stream === "stdout")
          .map((event) => Buffer.from(event.bytes)),
      );
      const sequences = events
        .filter((event) => event.stream === "stdout")
        .map((event) => event.sequence);

      expect(exit).toEqual({ exitCode: 0, stopped: false });
      expect(stdout).toEqual(Buffer.from(expected));
      expect(sequences).toEqual(sequences.map((_, index) => index));
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("isolates concurrent streaming sessions on one sidecar", () =>
    Effect.gen(function* () {
      const runtime = yield* NativeRuntimeClient;
      const runSession = (value: string, delayMs: number) =>
        Effect.gen(function* () {
          const session = yield* runtime.startStreaming({
            command: process.execPath,
            args: [
              "-e",
              `const chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>setTimeout(()=>process.stdout.write(Buffer.concat(chunks)),${delayMs}))`,
            ],
          });
          const outputFiber = yield* Effect.forkChild(Stream.runCollect(session.output), {
            startImmediately: true,
          });
          yield* session.write(Buffer.from(value));
          yield* session.closeStdin;
          const exit = yield* session.exit;
          const output = Buffer.concat(
            Array.from(yield* Fiber.join(outputFiber))
              .filter((event) => event.stream === "stdout")
              .map((event) => Buffer.from(event.bytes)),
          ).toString("utf8");
          return { exit, output };
        });

      const [first, second] = yield* Effect.all(
        [runSession("first-session", 100), runSession("second-session", 10)],
        { concurrency: "unbounded" },
      );

      expect(first).toEqual({ exit: { exitCode: 0, stopped: false }, output: "first-session" });
      expect(second).toEqual({ exit: { exitCode: 0, stopped: false }, output: "second-session" });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("reports streaming spawn failures before process start", () =>
    Effect.gen(function* () {
      const runtime = yield* NativeRuntimeClient;
      const error = yield* runtime
        .startStreaming({
          command: `sleepers-missing-stream-executable-${process.pid}.exe`,
          args: [],
        })
        .pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "NativeRuntimeRequestFailed",
        code: "PROCESS_SPAWN_FAILED",
        processStarted: false,
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("acknowledges stop before reporting a stopped streaming exit", () =>
    Effect.gen(function* () {
      const runtime = yield* NativeRuntimeClient;
      const session = yield* runtime.startStreaming({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      });

      expect(session.pid).toBeGreaterThan(0);
      yield* session.stop;
      expect(yield* session.exit).toEqual({ exitCode: null, stopped: true });
      expect(Array.from(yield* Stream.runCollect(session.output))).toEqual([]);
    }).pipe(Effect.provide(TestLayer)),
  );
});
