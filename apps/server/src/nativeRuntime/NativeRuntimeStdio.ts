import * as Effect from "effect/Effect";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";

import type {
  NativeRuntimeClientError,
  NativeRuntimeStreamingSession,
} from "./NativeRuntimeClient.ts";

const encoder = new TextEncoder();

function mapNativeError(
  method: "read" | "write",
  cause: NativeRuntimeClientError,
): PlatformError.PlatformError {
  return PlatformError.systemError({
    _tag: "Unknown",
    module: "NativeRuntimeStdio",
    method,
    description: cause.message,
    cause,
  });
}

export function make(session: NativeRuntimeStreamingSession): Stdio.Stdio {
  return Stdio.make({
    args: Effect.succeed([]),
    stdin: session.output.pipe(
      Stream.filter((event) => event.stream === "stdout"),
      Stream.map((event) => event.bytes),
      Stream.mapError((cause) => mapNativeError("read", cause)),
    ),
    stdout: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        session
          .write(typeof chunk === "string" ? encoder.encode(chunk) : chunk)
          .pipe(Effect.mapError((cause) => mapNativeError("write", cause))),
      ),
    stderr: () => Sink.drain,
  });
}
