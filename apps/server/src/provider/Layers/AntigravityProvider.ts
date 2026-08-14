import {
  type AntigravitySettings,
  type ModelCapabilities,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PRESENTATION = {
  displayName: "Antigravity",
  badgeLabel: "Web research",
  showInteractionModeToggle: true,
} as const;

const PROBE_TIMEOUT_MS = 15_000;

/**
 * `agy models` currently requires a terminal on Windows. Server probes use
 * redirected stdio, so keep one conservative, locally verified model available
 * when that optional inventory command cannot answer. Users can still add any
 * other current model through custom models.
 */
const HEADLESS_FALLBACK_MODELS = ["gemini-3.7-flash-high"] as const;

const MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  // Antigravity encodes effort in model slugs such as
  // `gemini-3.7-flash-high`; its CLI rejects --model with --effort.
  optionDescriptors: [],
});

export function parseAntigravityModels(output: string): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  const models: ServerProviderModel[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes(":")) continue;
    const slug = trimmed.split(/\s+/u)[0]?.trim();
    if (!slug || !/^[a-z0-9][a-z0-9._/-]*$/iu.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    models.push({
      slug,
      name: slug
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      isCustom: false,
      capabilities: MODEL_CAPABILITIES,
    });
  }
  return models;
}

const runCommand = (
  settings: AntigravitySettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    const binaryPath = settings.binaryPath || "agy";
    const resolved = yield* resolveSpawnCommand(binaryPath, args, { env: environment });
    return yield* spawnAndCollect(
      binaryPath,
      ChildProcess.make(resolved.command, resolved.args, {
        env: environment,
        shell: resolved.shell,
      }),
    );
  });

const modelsFrom = (
  settings: AntigravitySettings,
  discovered: ReadonlyArray<ServerProviderModel> = [],
) => providerModelsFromSettings(discovered, settings.customModels, MODEL_CAPABILITIES);

const fallbackModels = (): ReadonlyArray<ServerProviderModel> =>
  HEADLESS_FALLBACK_MODELS.map((slug) => ({
    slug,
    name: "Gemini 3.7 Flash (High)",
    isCustom: false,
    capabilities: MODEL_CAPABILITIES,
  }));

export const makePendingAntigravityProvider = (
  settings: AntigravitySettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: modelsFrom(settings),
      probe: settings.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking Antigravity CLI, models, and sign-in state...",
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Antigravity is disabled in Sleepers Code settings.",
          },
    });
  });

export const checkAntigravityProviderStatus = Effect.fn("checkAntigravityProviderStatus")(
  function* (
    settings: AntigravitySettings,
    environment: NodeJS.ProcessEnv = process.env,
  ): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const platform = yield* HostProcessPlatform;
    if (!settings.enabled) return yield* makePendingAntigravityProvider(settings);

    const versionAttempt = yield* runCommand(settings, ["--version"], environment).pipe(
      Effect.timeoutOption(PROBE_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(versionAttempt)) {
      const missing = isCommandMissingCause(versionAttempt.failure);
      return buildServerProvider({
        presentation: PRESENTATION,
        enabled: true,
        checkedAt,
        models: modelsFrom(settings),
        probe: {
          installed: !missing,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: missing
            ? "Antigravity CLI (`agy`) is not installed or not on PATH."
            : "Failed to execute the Antigravity CLI health check.",
        },
      });
    }
    if (Option.isNone(versionAttempt.success)) {
      return buildServerProvider({
        presentation: PRESENTATION,
        enabled: true,
        checkedAt,
        models: modelsFrom(settings),
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Antigravity CLI timed out while reporting its version.",
        },
      });
    }

    const versionResult = versionAttempt.success.value;
    const version = parseGenericCliVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
    // `agy models` requires a terminal on Windows and otherwise waits until
    // this timeout with redirected server stdio. Skip that known-dead probe so
    // provider refresh and startup stay fast; explicit turns remain the source
    // of real authentication and usage evidence.
    const modelAttempt =
      platform === "win32"
        ? null
        : yield* runCommand(settings, ["models"], environment).pipe(
            Effect.timeoutOption(PROBE_TIMEOUT_MS),
            Effect.result,
          );
    const probedModels =
      modelAttempt !== null && Result.isSuccess(modelAttempt) && Option.isSome(modelAttempt.success)
        ? parseAntigravityModels(modelAttempt.success.value.stdout)
        : [];
    const authenticated = probedModels.length > 0;
    const discoveredModels = authenticated ? probedModels : fallbackModels();

    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models: modelsFrom(settings, discoveredModels),
      probe: {
        installed: true,
        version,
        status: "ready",
        auth: { status: authenticated ? "authenticated" : "unknown" },
        message: authenticated
          ? "Ready through documented stream-JSON mode. Web search is verified from each session's reported tool inventory."
          : "Ready for explicit selection with a verified fallback model. Automatic routing stays off until the headless probe can confirm sign-in.",
      },
    });
  },
);
