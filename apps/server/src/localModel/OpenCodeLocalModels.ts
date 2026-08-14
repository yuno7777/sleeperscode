/**
 * Projects discovered local runtimes into OpenCode's inline provider config.
 *
 * The inline environment value is scoped to the OpenCode child process. It
 * makes local models available to OpenCode's complete coding-agent tool loop
 * without writing the user's global or project configuration files.
 *
 * @module localModel/OpenCodeLocalModels
 */
import type { LocalModelRuntime, OpenCodeSettings } from "@t3tools/contracts";

import type { LocalModelProbeResult } from "./LocalModelDiscovery.ts";

const INLINE_CONFIG_ENV = "OPENCODE_CONFIG_CONTENT";

interface LocalProviderDefinition {
  readonly id: string;
  readonly name: string;
}

const PROVIDER_DEFINITION: Record<LocalModelRuntime, LocalProviderDefinition> = {
  ollama: { id: "sleepers-ollama", name: "Ollama (local)" },
  lmstudio: { id: "sleepers-lmstudio", name: "LM Studio (local)" },
  "openai-compatible": { id: "sleepers-local", name: "Local endpoint" },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseInlineConfig = (raw: string | undefined): Record<string, unknown> | null => {
  if (raw === undefined || raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const openCodeBaseUrl = (result: Extract<LocalModelProbeResult, { status: "ready" }>): string => {
  const baseUrl = result.baseUrl.replace(/\/+$/, "");
  return result.runtime === "ollama" ? `${baseUrl}/v1` : baseUrl;
};

export function shouldDiscoverOpenCodeLocalModels(
  settings: Pick<OpenCodeSettings, "enabled" | "discoverLocalModels" | "serverUrl">,
): boolean {
  return settings.enabled && settings.discoverLocalModels && settings.serverUrl.length === 0;
}

/**
 * Adds ready local runtimes to an OpenCode child-process environment.
 *
 * Invalid existing inline config is preserved unchanged. Overwriting it would
 * turn discovery into an unrelated configuration repair, and could hide a user
 * mistake behind a generated value. Existing `sleepers-*` providers also win.
 */
export function withOpenCodeLocalModels(
  environment: NodeJS.ProcessEnv,
  probeResults: ReadonlyArray<LocalModelProbeResult>,
): NodeJS.ProcessEnv {
  const config = parseInlineConfig(environment[INLINE_CONFIG_ENV]);
  if (config === null) return environment;

  const configuredProviders = config["provider"];
  if (configuredProviders !== undefined && !isRecord(configuredProviders)) return environment;

  let providers = configuredProviders ?? {};
  let added = false;

  for (const result of probeResults) {
    if (result.status !== "ready" || result.models.length === 0) continue;
    const definition = PROVIDER_DEFINITION[result.runtime];
    if (Object.hasOwn(providers, definition.id)) continue;

    const models = Object.fromEntries(
      result.models.map((model) => [model.id, { name: model.id }] as const),
    );
    if (Object.keys(models).length === 0) continue;

    providers = Object.assign({}, providers, {
      [definition.id]: {
        npm: "@ai-sdk/openai-compatible",
        name: definition.name,
        options: { baseURL: openCodeBaseUrl(result) },
        models,
      },
    });
    added = true;
  }

  if (!added) return environment;
  return {
    ...environment,
    [INLINE_CONFIG_ENV]: JSON.stringify({ ...config, provider: providers }),
  };
}
