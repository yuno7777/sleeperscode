import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const RUNTIME_PROTOCOL_VERSION = 1 as const;

export const RuntimeBackend = Schema.Literals(["node", "rust", "auto"]);
export type RuntimeBackend = typeof RuntimeBackend.Type;
export const DEFAULT_RUNTIME_BACKEND: RuntimeBackend = "node";

export const RuntimeOutputMode = Schema.Literals(["error", "truncate"]);
export type RuntimeOutputMode = typeof RuntimeOutputMode.Type;

export const RuntimeRunRequest = Schema.Struct({
  version: Schema.Literal(RUNTIME_PROTOCOL_VERSION),
  type: Schema.Literal("run"),
  requestId: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  env: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
  stdin: Schema.NullOr(Schema.String),
  timeoutMs: PositiveInt,
  maxOutputBytes: NonNegativeInt,
  outputMode: RuntimeOutputMode,
  truncatedMarker: Schema.String,
});
export type RuntimeRunRequest = typeof RuntimeRunRequest.Type;

export const RuntimeCancelRequest = Schema.Struct({
  version: Schema.Literal(RUNTIME_PROTOCOL_VERSION),
  type: Schema.Literal("cancel"),
  requestId: TrimmedNonEmptyString,
});
export type RuntimeCancelRequest = typeof RuntimeCancelRequest.Type;

export const RuntimeShutdownRequest = Schema.Struct({
  version: Schema.Literal(RUNTIME_PROTOCOL_VERSION),
  type: Schema.Literal("shutdown"),
});
export type RuntimeShutdownRequest = typeof RuntimeShutdownRequest.Type;

export const RuntimeRequest = Schema.Union([
  RuntimeRunRequest,
  RuntimeCancelRequest,
  RuntimeShutdownRequest,
]);
export type RuntimeRequest = typeof RuntimeRequest.Type;

export const RuntimeCapabilities = Schema.Struct({
  finiteProcesses: Schema.Boolean,
  concurrentProcesses: Schema.Boolean,
  cancellation: Schema.Boolean,
  streamingProcesses: Schema.Boolean,
  shellCommands: Schema.Boolean,
});
export type RuntimeCapabilities = typeof RuntimeCapabilities.Type;

export const RuntimeHelloEvent = Schema.Struct({
  version: Schema.Literal(RUNTIME_PROTOCOL_VERSION),
  type: Schema.Literal("hello"),
  runtimeVersion: TrimmedNonEmptyString,
  sidecarPid: PositiveInt,
  platform: TrimmedNonEmptyString,
  arch: TrimmedNonEmptyString,
  capabilities: RuntimeCapabilities,
});
export type RuntimeHelloEvent = typeof RuntimeHelloEvent.Type;

export const RuntimeProcessStartedEvent = Schema.Struct({
  version: Schema.Literal(RUNTIME_PROTOCOL_VERSION),
  type: Schema.Literal("processStarted"),
  requestId: TrimmedNonEmptyString,
  pid: PositiveInt,
});
export type RuntimeProcessStartedEvent = typeof RuntimeProcessStartedEvent.Type;

export const RuntimeProcessCompletedEvent = Schema.Struct({
  version: Schema.Literal(RUNTIME_PROTOCOL_VERSION),
  type: Schema.Literal("processCompleted"),
  requestId: TrimmedNonEmptyString,
  exitCode: Schema.NullOr(Schema.Int),
  timedOut: Schema.Boolean,
  cancelled: Schema.Boolean,
  stdout: Schema.String,
  stderr: Schema.String,
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
});
export type RuntimeProcessCompletedEvent = typeof RuntimeProcessCompletedEvent.Type;

export const RuntimeErrorEvent = Schema.Struct({
  version: Schema.Literal(RUNTIME_PROTOCOL_VERSION),
  type: Schema.Literal("error"),
  requestId: Schema.NullOr(TrimmedNonEmptyString),
  code: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  recoverable: Schema.Boolean,
  debugDetail: Schema.NullOr(Schema.String),
  stream: Schema.NullOr(Schema.Literals(["stdout", "stderr"])),
  maxOutputBytes: Schema.NullOr(NonNegativeInt),
  observedOutputBytes: Schema.NullOr(NonNegativeInt),
});
export type RuntimeErrorEvent = typeof RuntimeErrorEvent.Type;

export const RuntimeEvent = Schema.Union([
  RuntimeHelloEvent,
  RuntimeProcessStartedEvent,
  RuntimeProcessCompletedEvent,
  RuntimeErrorEvent,
]);
export type RuntimeEvent = typeof RuntimeEvent.Type;
