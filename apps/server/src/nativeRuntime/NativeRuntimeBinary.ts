// @effect-diagnostics nodeBuiltinImport:off
import {
  HostProcessArchitecture,
  HostProcessEnvironment,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class NativeRuntimeBinaryNotFound extends Schema.TaggedErrorClass<NativeRuntimeBinaryNotFound>()(
  "NativeRuntimeBinaryNotFound",
  {
    platform: Schema.String,
    architecture: Schema.String,
    candidates: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Native runtime binary was not found for ${this.platform}/${this.architecture}.`;
  }
}

export class NativeRuntimeBinaryNotExecutable extends Schema.TaggedErrorClass<NativeRuntimeBinaryNotExecutable>()(
  "NativeRuntimeBinaryNotExecutable",
  {
    path: Schema.String,
    mode: Schema.Number,
  },
) {
  override get message(): string {
    return `Native runtime binary at '${this.path}' is not executable.`;
  }
}

export type NativeRuntimeBinaryError =
  | NativeRuntimeBinaryNotFound
  | NativeRuntimeBinaryNotExecutable;

export class NativeRuntimeBinary extends Context.Service<
  NativeRuntimeBinary,
  {
    readonly resolve: Effect.Effect<string, NativeRuntimeBinaryError>;
  }
>()("t3/nativeRuntime/NativeRuntimeBinary") {}

function binaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "t3-runtime-sidecar.exe" : "t3-runtime-sidecar";
}

export const make = Effect.fn("nativeRuntime.nativeRuntimeBinary.make")(function* () {
  const platform = yield* HostProcessPlatform;
  const architecture = yield* HostProcessArchitecture;
  const environment = yield* HostProcessEnvironment;
  const executableName = binaryName(platform);
  const candidates = [
    environment.T3CODE_RUNTIME_SIDECAR_PATH,
    NodePath.resolve(import.meta.dirname, "runtime-sidecar", executableName),
    NodePath.resolve(import.meta.dirname, "../../../../target/release", executableName),
    NodePath.resolve(import.meta.dirname, "../../../../target/debug", executableName),
    NodePath.resolve(import.meta.dirname, "../../../target/release", executableName),
    NodePath.resolve(import.meta.dirname, "../../../target/debug", executableName),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const resolve: NativeRuntimeBinary["Service"]["resolve"] = Effect.gen(function* () {
    for (const candidate of candidates) {
      if (!NodeFS.existsSync(candidate)) continue;
      if (platform !== "win32") {
        const mode = NodeFS.statSync(candidate).mode;
        if ((mode & 0o111) === 0) {
          return yield* new NativeRuntimeBinaryNotExecutable({
            path: candidate,
            mode,
          });
        }
      }
      return candidate;
    }
    return yield* new NativeRuntimeBinaryNotFound({
      platform,
      architecture,
      candidates,
    });
  });

  return NativeRuntimeBinary.of({ resolve });
});

export const layer = Layer.effect(NativeRuntimeBinary, make());
