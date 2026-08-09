import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import type { CursorAcpRuntimeInput } from "./CursorAcpSupport.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import type { InstalledAcpProviderConfig } from "./InstalledAcpProviderConfig.ts";

export const makeGenericAcpRuntime = (
  config: InstalledAcpProviderConfig,
  input: Omit<CursorAcpRuntimeInput, "cursorSettings">,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const { childProcessSpawner, environment, ...runtimeOptions } = input;
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...runtimeOptions,
        spawn: {
          command: config.commandPath,
          args: config.args,
          cwd: input.cwd,
          env: {
            ...environment,
            ...config.environment,
          },
        },
      }).pipe(
        Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner)),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });
