import {
  RUNTIME_PROTOCOL_VERSION,
  RUNTIME_STREAM_CHUNK_MAX_BYTES,
  RuntimeEvent as RuntimeEventSchema,
  RuntimeRequest as RuntimeRequestSchema,
  type RuntimeEvent,
  type RuntimeHelloEvent,
  type RuntimeControl,
  type RuntimeProcessCompletedEvent,
  type RuntimeRequest,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Ndjson from "effect/unstable/encoding/Ndjson";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NativeRuntimeBinary from "./NativeRuntimeBinary.ts";

const HANDSHAKE_TIMEOUT = Duration.seconds(5);
const FORCE_KILL_AFTER = Duration.seconds(2);
const STREAM_OUTPUT_QUEUE_CAPACITY = 64;

export interface NativeRuntimeRunInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly stdin?: string | undefined;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly outputMode: "error" | "truncate";
  readonly truncatedMarker: string;
}

export interface NativeRuntimeStreamingInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

export interface NativeRuntimeStreamChunk {
  readonly stream: "stdout" | "stderr";
  readonly sequence: number;
  readonly bytes: Uint8Array;
}

export interface NativeRuntimeStreamingExit {
  readonly exitCode: number | null;
  readonly stopped: boolean;
}

export interface NativeRuntimeStreamingSession {
  readonly sessionId: string;
  readonly pid: number;
  readonly output: Stream.Stream<NativeRuntimeStreamChunk, NativeRuntimeClientError>;
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, NativeRuntimeClientError>;
  readonly closeStdin: Effect.Effect<void, NativeRuntimeClientError>;
  readonly stop: Effect.Effect<void, NativeRuntimeClientError>;
  readonly exit: Effect.Effect<NativeRuntimeStreamingExit, NativeRuntimeClientError>;
}

export type NativeRuntimeRunOutput = Omit<
  RuntimeProcessCompletedEvent,
  "type" | "version" | "requestId"
>;

export class NativeRuntimeSpawnFailed extends Schema.TaggedErrorClass<NativeRuntimeSpawnFailed>()(
  "NativeRuntimeSpawnFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Failed to start native runtime '${this.path}'.`;
  }
}

export class NativeRuntimeHandshakeTimedOut extends Schema.TaggedErrorClass<NativeRuntimeHandshakeTimedOut>()(
  "NativeRuntimeHandshakeTimedOut",
  { timeoutMs: Schema.Number },
) {
  override get message(): string {
    return `Native runtime handshake timed out after ${this.timeoutMs}ms.`;
  }
}

export class NativeRuntimeProtocolFailed extends Schema.TaggedErrorClass<NativeRuntimeProtocolFailed>()(
  "NativeRuntimeProtocolFailed",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Native runtime protocol operation '${this.operation}' failed.`;
  }
}

export class NativeRuntimeExited extends Schema.TaggedErrorClass<NativeRuntimeExited>()(
  "NativeRuntimeExited",
  { exitCode: Schema.Number },
) {
  override get message(): string {
    return `Native runtime exited with code ${this.exitCode}.`;
  }
}

export class NativeRuntimeStreamingUnsupported extends Schema.TaggedErrorClass<NativeRuntimeStreamingUnsupported>()(
  "NativeRuntimeStreamingUnsupported",
  { runtimeVersion: Schema.String },
) {
  override get message(): string {
    return `Native runtime ${this.runtimeVersion} does not support streaming processes.`;
  }
}

export class NativeRuntimeRequestFailed extends Schema.TaggedErrorClass<NativeRuntimeRequestFailed>()(
  "NativeRuntimeRequestFailed",
  {
    requestId: Schema.String,
    code: Schema.String,
    detail: Schema.String,
    processStarted: Schema.Boolean,
    stream: Schema.optional(Schema.Literals(["stdout", "stderr"])),
    maxOutputBytes: Schema.optional(Schema.Number),
    observedOutputBytes: Schema.optional(Schema.Number),
  },
) {
  override get message(): string {
    return `Native runtime request '${this.requestId}' failed (${this.code}): ${this.detail}`;
  }
}

export const isNativeRuntimeRequestFailed = Schema.is(NativeRuntimeRequestFailed);

export type NativeRuntimeClientError =
  | NativeRuntimeBinary.NativeRuntimeBinaryError
  | NativeRuntimeSpawnFailed
  | NativeRuntimeHandshakeTimedOut
  | NativeRuntimeProtocolFailed
  | NativeRuntimeExited
  | NativeRuntimeStreamingUnsupported
  | NativeRuntimeRequestFailed;

export class NativeRuntimeClient extends Context.Service<
  NativeRuntimeClient,
  {
    readonly run: (
      input: NativeRuntimeRunInput,
    ) => Effect.Effect<NativeRuntimeRunOutput, NativeRuntimeClientError>;
    readonly startStreaming: (
      input: NativeRuntimeStreamingInput,
    ) => Effect.Effect<NativeRuntimeStreamingSession, NativeRuntimeClientError>;
  }
>()("t3/nativeRuntime/NativeRuntimeClient") {}

interface PendingRequest {
  readonly deferred: Deferred.Deferred<NativeRuntimeRunOutput, NativeRuntimeClientError>;
  readonly processStarted: boolean;
}

interface StreamingSessionState {
  readonly started: Deferred.Deferred<number, NativeRuntimeClientError>;
  readonly exit: Deferred.Deferred<NativeRuntimeStreamingExit, NativeRuntimeClientError>;
  readonly output: Queue.Queue<NativeRuntimeStreamChunk, NativeRuntimeClientError | Cause.Done>;
  readonly processStarted: boolean;
}

interface PendingStreamingControl {
  readonly sessionId: string;
  readonly control: RuntimeControl;
  readonly deferred: Deferred.Deferred<void, NativeRuntimeClientError>;
}

type StreamingControlInput =
  | {
      readonly control: "write";
      readonly dataBase64: string;
    }
  | {
      readonly control: "closeStdin" | "stop";
    };

const decodeRuntimeEvent = Schema.decodeUnknownEffect(RuntimeEventSchema);
const encodeRuntimeRequest = Schema.encodeEffect(Schema.fromJsonString(RuntimeRequestSchema));

export const make = Effect.fn("nativeRuntime.nativeRuntimeClient.make")(function* () {
  const binary = yield* NativeRuntimeBinary.NativeRuntimeBinary;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const runtimeScope = yield* Scope.make("sequential");
  const handleRef = yield* Ref.make<Option.Option<ChildProcessSpawner.ChildProcessHandle>>(
    Option.none(),
  );
  const helloRef = yield* Ref.make<Option.Option<RuntimeHelloEvent>>(Option.none());
  const pendingRef = yield* Ref.make(new Map<string, PendingRequest>());
  const streamingRef = yield* Ref.make(new Map<string, StreamingSessionState>());
  const controlRef = yield* Ref.make(new Map<string, PendingStreamingControl>());
  const sessionMutex = yield* Semaphore.make(1);
  const commandMutex = yield* Semaphore.make(1);

  const failPending = Effect.fn("nativeRuntime.nativeRuntimeClient.failPending")(function* (
    error: NativeRuntimeClientError,
  ) {
    yield* Ref.set(helloRef, Option.none());
    const pending = yield* Ref.getAndSet(pendingRef, new Map());
    yield* Effect.forEach(
      pending.entries(),
      ([requestId, request]) =>
        Deferred.fail(
          request.deferred,
          new NativeRuntimeRequestFailed({
            requestId,
            code: "NATIVE_RUNTIME_UNAVAILABLE",
            detail: error.message,
            processStarted: request.processStarted,
          }),
        ),
      { discard: true },
    );
    const controls = yield* Ref.getAndSet(controlRef, new Map());
    yield* Effect.forEach(controls.values(), (control) => Deferred.fail(control.deferred, error), {
      discard: true,
    });
    const sessions = yield* Ref.getAndSet(streamingRef, new Map());
    yield* Effect.forEach(
      sessions.values(),
      (session) =>
        Effect.all(
          [
            Deferred.fail(session.started, error),
            Deferred.fail(session.exit, error),
            Queue.fail(session.output, error),
          ],
          { discard: true },
        ),
      { discard: true },
    );
  });

  const writeRequest = (
    handle: ChildProcessSpawner.ChildProcessHandle,
    request: RuntimeRequest,
  ): Effect.Effect<void, NativeRuntimeProtocolFailed> =>
    commandMutex.withPermits(1)(
      encodeRuntimeRequest(request).pipe(
        Effect.map((encoded) => `${encoded}\n`),
        Effect.flatMap((encoded) =>
          Stream.run(Stream.encodeText(Stream.make(encoded)), handle.stdin),
        ),
        Effect.mapError(
          (cause) => new NativeRuntimeProtocolFailed({ operation: request.type, cause }),
        ),
      ),
    );

  const processEvent = (
    event: RuntimeEvent,
    hello: Deferred.Deferred<RuntimeHelloEvent>,
  ): Effect.Effect<void> => {
    switch (event.type) {
      case "hello":
        return Deferred.succeed(hello, event).pipe(Effect.asVoid);
      case "processStarted":
        return Effect.gen(function* () {
          yield* Ref.update(pendingRef, (pending) => {
            const request = pending.get(event.requestId);
            if (!request) return pending;
            const next = new Map(pending);
            next.set(event.requestId, { ...request, processStarted: true });
            return next;
          });
          const session = yield* Ref.modify(streamingRef, (sessions) => {
            const current = sessions.get(event.requestId);
            if (!current) return [Option.none<StreamingSessionState>(), sessions];
            const next = new Map(sessions);
            next.set(event.requestId, { ...current, processStarted: true });
            return [Option.some(current), next];
          });
          if (Option.isSome(session)) {
            yield* Deferred.succeed(session.value.started, event.pid);
          }
        });
      case "processOutput":
        return Effect.gen(function* () {
          const sessions = yield* Ref.get(streamingRef);
          const session = sessions.get(event.requestId);
          if (!session) return;
          yield* Queue.offer(session.output, {
            stream: event.stream,
            sequence: event.sequence,
            bytes: Uint8Array.from(Buffer.from(event.dataBase64, "base64")),
          });
        });
      case "processExited":
        return Effect.gen(function* () {
          const session = yield* Ref.modify(streamingRef, (sessions) => {
            const next = new Map(sessions);
            const current = next.get(event.requestId);
            next.delete(event.requestId);
            return [Option.fromUndefinedOr(current), next];
          });
          if (Option.isNone(session)) return;
          yield* Deferred.succeed(session.value.exit, {
            exitCode: event.exitCode,
            stopped: event.stopped,
          });
          yield* Queue.end(session.value.output);
        });
      case "controlAccepted":
        return Effect.gen(function* () {
          const control = yield* Ref.modify(controlRef, (controls) => {
            const next = new Map(controls);
            const current = next.get(event.requestId);
            next.delete(event.requestId);
            return [Option.fromUndefinedOr(current), next];
          });
          if (Option.isNone(control)) return;
          if (
            control.value.sessionId !== event.sessionId ||
            control.value.control !== event.control
          ) {
            yield* Deferred.fail(
              control.value.deferred,
              new NativeRuntimeProtocolFailed({
                operation: "control-receipt",
                cause: `Unexpected ${event.control} receipt for ${event.sessionId}.`,
              }),
            );
            return;
          }
          yield* Deferred.succeed(control.value.deferred, undefined);
        });
      case "processCompleted":
        return Effect.gen(function* () {
          const request = yield* Ref.modify(pendingRef, (pending) => {
            const next = new Map(pending);
            const current = next.get(event.requestId);
            next.delete(event.requestId);
            return [Option.fromUndefinedOr(current), next];
          });
          if (Option.isNone(request)) return;
          const { type: _type, version: _version, requestId: _requestId, ...result } = event;
          yield* Deferred.succeed(request.value.deferred, result);
        });
      case "error":
        if (event.requestId === null) return Effect.void;
        const requestId = event.requestId;
        return Effect.gen(function* () {
          const makeError = (processStarted: boolean) =>
            new NativeRuntimeRequestFailed({
              requestId,
              code: event.code,
              detail: event.message,
              processStarted,
              ...(event.stream === null ? {} : { stream: event.stream }),
              ...(event.maxOutputBytes === null ? {} : { maxOutputBytes: event.maxOutputBytes }),
              ...(event.observedOutputBytes === null
                ? {}
                : { observedOutputBytes: event.observedOutputBytes }),
            });
          const request = yield* Ref.modify(pendingRef, (pending) => {
            const next = new Map(pending);
            const current = next.get(requestId);
            next.delete(requestId);
            return [Option.fromUndefinedOr(current), next];
          });
          if (Option.isSome(request)) {
            yield* Deferred.fail(request.value.deferred, makeError(request.value.processStarted));
            return;
          }
          const control = yield* Ref.modify(controlRef, (controls) => {
            const next = new Map(controls);
            const current = next.get(requestId);
            next.delete(requestId);
            return [Option.fromUndefinedOr(current), next];
          });
          if (Option.isSome(control)) {
            yield* Deferred.fail(control.value.deferred, makeError(true));
            return;
          }
          const session = yield* Ref.modify(streamingRef, (sessions) => {
            const next = new Map(sessions);
            const current = next.get(requestId);
            next.delete(requestId);
            return [Option.fromUndefinedOr(current), next];
          });
          if (Option.isNone(session)) return;
          const error = makeError(session.value.processStarted);
          yield* Deferred.fail(session.value.started, error);
          yield* Deferred.fail(session.value.exit, error);
          yield* Queue.fail(session.value.output, error);
        });
    }
  };

  const start = Effect.fn("nativeRuntime.nativeRuntimeClient.start")(function* () {
    const executablePath = yield* binary.resolve;
    const handle = yield* spawner
      .spawn(
        ChildProcess.make(executablePath, [], {
          stdin: { stream: "pipe", endOnDone: false },
          stdout: "pipe",
          stderr: "pipe",
          killSignal: "SIGTERM",
          forceKillAfter: FORCE_KILL_AFTER,
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, runtimeScope),
        Effect.mapError((cause) => new NativeRuntimeSpawnFailed({ path: executablePath, cause })),
      );
    yield* Ref.set(handleRef, Option.some(handle));
    const hello = yield* Deferred.make<RuntimeHelloEvent>();

    const eventReader = yield* handle.stdout.pipe(
      Stream.pipeThroughChannel(Ndjson.decode({ ignoreEmptyLines: true })),
      Stream.mapEffect((value) =>
        decodeRuntimeEvent(value).pipe(
          Effect.mapError(
            (cause) => new NativeRuntimeProtocolFailed({ operation: "decode-event", cause }),
          ),
        ),
      ),
      Stream.runForEach((event) => processEvent(event, hello)),
      Effect.catchCause((cause) =>
        failPending(
          new NativeRuntimeProtocolFailed({ operation: "read-events", cause: Cause.squash(cause) }),
        ),
      ),
      Effect.forkIn(runtimeScope),
    );
    yield* handle.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkIn(runtimeScope));
    yield* handle.exitCode.pipe(
      Effect.flatMap((exitCode) => Fiber.await(eventReader).pipe(Effect.as(exitCode))),
      Effect.matchEffect({
        onFailure: (cause) =>
          failPending(new NativeRuntimeProtocolFailed({ operation: "read-exit-code", cause })),
        onSuccess: (exitCode) =>
          Ref.update(handleRef, (current) =>
            Option.filter(current, (candidate) => candidate.pid !== handle.pid),
          ).pipe(Effect.andThen(failPending(new NativeRuntimeExited({ exitCode })))),
      }),
      Effect.forkIn(runtimeScope),
    );

    const handshake = yield* Deferred.await(hello).pipe(
      Effect.timeoutOption(HANDSHAKE_TIMEOUT),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new NativeRuntimeHandshakeTimedOut({
                timeoutMs: Duration.toMillis(HANDSHAKE_TIMEOUT),
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    if (handshake.version !== RUNTIME_PROTOCOL_VERSION) {
      return yield* new NativeRuntimeProtocolFailed({
        operation: "handshake-version",
        cause: `Expected ${RUNTIME_PROTOCOL_VERSION}, received ${handshake.version}`,
      });
    }
    yield* Ref.set(helloRef, Option.some(handshake));
    return handle;
  });

  const ensureHandle = sessionMutex.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.get(handleRef);
      if (Option.isSome(current)) return current.value;
      return yield* start();
    }),
  );

  const nextRequestId = Effect.fn("nativeRuntime.nativeRuntimeClient.nextRequestId")(function* (
    prefix: string,
  ) {
    return `${prefix}:${yield* Random.nextInt}:${yield* Random.nextInt}`;
  });

  const sendStreamingControl = Effect.fn("nativeRuntime.nativeRuntimeClient.sendStreamingControl")(
    function* (
      handle: ChildProcessSpawner.ChildProcessHandle,
      sessionId: string,
      input: StreamingControlInput,
    ) {
      const requestId = yield* nextRequestId(input.control);
      const deferred = yield* Deferred.make<void, NativeRuntimeClientError>();
      yield* Ref.update(controlRef, (controls) => {
        const next = new Map(controls);
        next.set(requestId, { sessionId, control: input.control, deferred });
        return next;
      });
      const request =
        input.control === "write"
          ? ({
              version: RUNTIME_PROTOCOL_VERSION,
              type: "write",
              requestId,
              sessionId,
              dataBase64: input.dataBase64,
            } satisfies RuntimeRequest)
          : input.control === "closeStdin"
            ? ({
                version: RUNTIME_PROTOCOL_VERSION,
                type: "closeStdin",
                requestId,
                sessionId,
              } satisfies RuntimeRequest)
            : ({
                version: RUNTIME_PROTOCOL_VERSION,
                type: "stop",
                requestId,
                sessionId,
              } satisfies RuntimeRequest);
      yield* Effect.gen(function* () {
        yield* writeRequest(handle, request);
        yield* Deferred.await(deferred);
      }).pipe(
        Effect.ensuring(
          Ref.update(controlRef, (controls) => {
            const next = new Map(controls);
            next.delete(requestId);
            return next;
          }),
        ),
      );
    },
  );

  const startStreaming: NativeRuntimeClient["Service"]["startStreaming"] = Effect.fn(
    "nativeRuntime.nativeRuntimeClient.startStreaming",
  )(function* (input) {
    const handle = yield* ensureHandle;
    const hello = yield* Ref.get(helloRef);
    if (Option.isNone(hello)) {
      return yield* new NativeRuntimeProtocolFailed({
        operation: "streaming-capability",
        cause: "The native runtime handshake is unavailable.",
      });
    }
    if (!hello.value.capabilities.streamingProcesses) {
      return yield* new NativeRuntimeStreamingUnsupported({
        runtimeVersion: hello.value.runtimeVersion,
      });
    }

    const sessionId = yield* nextRequestId("stream");
    const interruptRequestId = yield* nextRequestId("interrupt-stop");
    const started = yield* Deferred.make<number, NativeRuntimeClientError>();
    const exit = yield* Deferred.make<NativeRuntimeStreamingExit, NativeRuntimeClientError>();
    const output = yield* Queue.bounded<
      NativeRuntimeStreamChunk,
      NativeRuntimeClientError | Cause.Done
    >(STREAM_OUTPUT_QUEUE_CAPACITY);
    const state = { started, exit, output, processStarted: false } satisfies StreamingSessionState;
    yield* Ref.update(streamingRef, (sessions) => {
      const next = new Map(sessions);
      next.set(sessionId, state);
      return next;
    });

    const env =
      input.env === undefined
        ? null
        : Object.fromEntries(
            Object.entries(input.env).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          );
    yield* writeRequest(handle, {
      version: RUNTIME_PROTOCOL_VERSION,
      type: "start",
      requestId: sessionId,
      command: input.command,
      args: [...input.args],
      cwd: input.cwd ?? null,
      env,
    }).pipe(
      Effect.tapError((error) =>
        Ref.update(streamingRef, (sessions) => {
          const next = new Map(sessions);
          next.delete(sessionId);
          return next;
        }).pipe(
          Effect.andThen(Deferred.fail(started, error)),
          Effect.andThen(Deferred.fail(exit, error)),
          Effect.andThen(Queue.fail(output, error)),
        ),
      ),
    );
    const pid = yield* Deferred.await(started).pipe(
      Effect.onInterrupt(() =>
        writeRequest(handle, {
          version: RUNTIME_PROTOCOL_VERSION,
          type: "stop",
          requestId: interruptRequestId,
          sessionId,
        }).pipe(Effect.ignore),
      ),
    );

    const write = Effect.fn("nativeRuntime.nativeRuntimeStreamingSession.write")(function* (
      bytes: Uint8Array,
    ) {
      for (let offset = 0; offset < bytes.byteLength; offset += RUNTIME_STREAM_CHUNK_MAX_BYTES) {
        const chunk = bytes.subarray(
          offset,
          Math.min(offset + RUNTIME_STREAM_CHUNK_MAX_BYTES, bytes.byteLength),
        );
        yield* sendStreamingControl(handle, sessionId, {
          control: "write",
          dataBase64: Buffer.from(chunk).toString("base64"),
        });
      }
    });

    return {
      sessionId,
      pid,
      output: Stream.fromQueue(output),
      write,
      closeStdin: sendStreamingControl(handle, sessionId, { control: "closeStdin" }),
      stop: sendStreamingControl(handle, sessionId, { control: "stop" }),
      exit: Deferred.await(exit),
    } satisfies NativeRuntimeStreamingSession;
  });

  const run: NativeRuntimeClient["Service"]["run"] = Effect.fn(
    "nativeRuntime.nativeRuntimeClient.run",
  )(function* (input) {
    const handle = yield* ensureHandle;
    const requestId = yield* nextRequestId("run");
    const deferred = yield* Deferred.make<NativeRuntimeRunOutput, NativeRuntimeClientError>();
    yield* Ref.update(pendingRef, (pending) => {
      const next = new Map(pending);
      next.set(requestId, { deferred, processStarted: false });
      return next;
    });
    const env =
      input.env === undefined
        ? null
        : Object.fromEntries(
            Object.entries(input.env).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          );
    const request = {
      version: RUNTIME_PROTOCOL_VERSION,
      type: "run",
      requestId,
      command: input.command,
      args: [...input.args],
      cwd: input.cwd ?? null,
      env,
      stdin: input.stdin ?? null,
      timeoutMs: Math.max(1, Math.ceil(input.timeoutMs)),
      maxOutputBytes: input.maxOutputBytes,
      outputMode: input.outputMode,
      truncatedMarker: input.truncatedMarker,
    } satisfies RuntimeRequest;
    yield* writeRequest(handle, request).pipe(
      Effect.mapError(
        (error) =>
          new NativeRuntimeRequestFailed({
            requestId,
            code: "NATIVE_RUNTIME_WRITE_FAILED",
            detail: error.message,
            processStarted: true,
          }),
      ),
      Effect.tapError(() =>
        Ref.update(pendingRef, (pending) => {
          const next = new Map(pending);
          next.delete(requestId);
          return next;
        }),
      ),
    );
    return yield* Deferred.await(deferred).pipe(
      Effect.onInterrupt(() =>
        writeRequest(handle, {
          version: RUNTIME_PROTOCOL_VERSION,
          type: "cancel",
          requestId,
        }).pipe(Effect.ignore),
      ),
    );
  });

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const handle = yield* Ref.get(handleRef);
      if (Option.isSome(handle)) {
        const running = yield* handle.value.isRunning.pipe(Effect.orElseSucceed(() => false));
        if (running) {
          yield* writeRequest(handle.value, {
            version: RUNTIME_PROTOCOL_VERSION,
            type: "shutdown",
          }).pipe(Effect.ignore);
        }
      }
      yield* Scope.close(runtimeScope, Exit.void);
    }),
  );

  return NativeRuntimeClient.of({ run, startStreaming });
});

export const layer = Layer.effect(NativeRuntimeClient, make()).pipe(
  Layer.provide(NativeRuntimeBinary.layer),
);
