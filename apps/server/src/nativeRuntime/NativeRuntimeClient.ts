import {
  RUNTIME_PROTOCOL_VERSION,
  RuntimeEvent as RuntimeEventSchema,
  RuntimeRequest as RuntimeRequestSchema,
  type RuntimeEvent,
  type RuntimeHelloEvent,
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
  | NativeRuntimeRequestFailed;

export class NativeRuntimeClient extends Context.Service<
  NativeRuntimeClient,
  {
    readonly run: (
      input: NativeRuntimeRunInput,
    ) => Effect.Effect<NativeRuntimeRunOutput, NativeRuntimeClientError>;
  }
>()("t3/nativeRuntime/NativeRuntimeClient") {}

interface PendingRequest {
  readonly deferred: Deferred.Deferred<NativeRuntimeRunOutput, NativeRuntimeClientError>;
  readonly processStarted: boolean;
}

const decodeRuntimeEvent = Schema.decodeUnknownEffect(RuntimeEventSchema);
const encodeRuntimeRequest = Schema.encodeEffect(Schema.fromJsonString(RuntimeRequestSchema));

export const make = Effect.fn("nativeRuntime.nativeRuntimeClient.make")(function* () {
  const binary = yield* NativeRuntimeBinary.NativeRuntimeBinary;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const runtimeScope = yield* Scope.make("sequential");
  const handleRef = yield* Ref.make<Option.Option<ChildProcessSpawner.ChildProcessHandle>>(
    Option.none(),
  );
  const pendingRef = yield* Ref.make(new Map<string, PendingRequest>());
  const sessionMutex = yield* Semaphore.make(1);
  const commandMutex = yield* Semaphore.make(1);

  const failPending = (error: NativeRuntimeClientError) =>
    Effect.gen(function* () {
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
        return Ref.update(pendingRef, (pending) => {
          const request = pending.get(event.requestId);
          if (!request) return pending;
          const next = new Map(pending);
          next.set(event.requestId, { ...request, processStarted: true });
          return next;
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
        return Effect.gen(function* () {
          const request = yield* Ref.modify(pendingRef, (pending) => {
            const next = new Map(pending);
            const current = next.get(event.requestId!);
            next.delete(event.requestId!);
            return [Option.fromUndefinedOr(current), next];
          });
          if (Option.isNone(request)) return;
          yield* Deferred.fail(
            request.value.deferred,
            new NativeRuntimeRequestFailed({
              requestId: event.requestId!,
              code: event.code,
              detail: event.message,
              processStarted: request.value.processStarted,
              ...(event.stream === null ? {} : { stream: event.stream }),
              ...(event.maxOutputBytes === null ? {} : { maxOutputBytes: event.maxOutputBytes }),
              ...(event.observedOutputBytes === null
                ? {}
                : { observedOutputBytes: event.observedOutputBytes }),
            }),
          );
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
    return handle;
  });

  const ensureHandle = sessionMutex.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.get(handleRef);
      if (Option.isSome(current)) return current.value;
      return yield* start();
    }),
  );

  const run: NativeRuntimeClient["Service"]["run"] = Effect.fn(
    "nativeRuntime.nativeRuntimeClient.run",
  )(function* (input) {
    const handle = yield* ensureHandle;
    const requestId = `${yield* Random.nextInt}:${yield* Random.nextInt}`;
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

  return NativeRuntimeClient.of({ run });
});

export const layer = Layer.effect(NativeRuntimeClient, make()).pipe(
  Layer.provide(NativeRuntimeBinary.layer),
);
