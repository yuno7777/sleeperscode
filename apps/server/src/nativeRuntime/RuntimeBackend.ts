import {
  DEFAULT_RUNTIME_BACKEND,
  RuntimeBackend,
  type RuntimeBackend as RuntimeBackendValue,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export type ActiveRuntimeBackend = Exclude<RuntimeBackendValue, "auto">;

export interface RuntimeBackendSelection {
  readonly requested: RuntimeBackendValue;
  readonly active: ActiveRuntimeBackend;
  readonly source: "environment" | "legacy-environment" | "settings";
}

const isRuntimeBackend = Schema.is(RuntimeBackend);

export function selectRuntimeBackend(input: {
  readonly configured?: RuntimeBackendValue | undefined;
  readonly environment: NodeJS.ProcessEnv;
}): RuntimeBackendSelection {
  const environmentBackend = input.environment.T3CODE_RUNTIME_BACKEND?.trim().toLowerCase();
  const requested = isRuntimeBackend(environmentBackend)
    ? environmentBackend
    : input.environment.T3CODE_RUST_RUNTIME === "1"
      ? "rust"
      : input.environment.T3CODE_RUST_RUNTIME === "0"
        ? "node"
        : (input.configured ?? DEFAULT_RUNTIME_BACKEND);
  const source = isRuntimeBackend(environmentBackend)
    ? "environment"
    : input.environment.T3CODE_RUST_RUNTIME === "1" || input.environment.T3CODE_RUST_RUNTIME === "0"
      ? "legacy-environment"
      : "settings";

  return {
    requested,
    // Auto stays conservative until the packaged sidecar and whole-app
    // differential suite are release-qualified.
    active: requested === "rust" ? "rust" : "node",
    source,
  };
}
