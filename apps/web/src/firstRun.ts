import { deriveAgentStatusLevels, type ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const FIRST_RUN_STORAGE_KEY = "sleepers-code:first-run:v1";

export const FirstRunState = Schema.Struct({
  version: Schema.Literal(1),
  completed: Schema.Boolean,
});
export type FirstRunState = typeof FirstRunState.Type;

export const EMPTY_FIRST_RUN_STATE: FirstRunState = {
  version: 1,
  completed: false,
};

export interface FirstRunProviderSummary {
  readonly total: number;
  readonly installed: number;
  readonly authenticated: number;
  readonly routable: number;
}

export function shouldPresentFirstRun(input: {
  readonly enabled: boolean;
  readonly serverReady: boolean;
  readonly completed: boolean;
}): boolean {
  return input.enabled && input.serverReady && !input.completed;
}

export function summarizeFirstRunProviders(
  providers: ReadonlyArray<ServerProvider>,
): FirstRunProviderSummary {
  return providers.reduce<FirstRunProviderSummary>(
    (summary, provider) => {
      const levels = deriveAgentStatusLevels(provider);
      return {
        total: summary.total + 1,
        installed: summary.installed + Number(provider.installed),
        authenticated: summary.authenticated + Number(provider.auth.status === "authenticated"),
        routable: summary.routable + Number(levels.routable),
      };
    },
    { total: 0, installed: 0, authenticated: 0, routable: 0 },
  );
}

export function orderFirstRunProviders(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> {
  return [...providers].sort((left, right) => {
    const leftLevels = deriveAgentStatusLevels(left);
    const rightLevels = deriveAgentStatusLevels(right);
    return (
      Number(rightLevels.routable) - Number(leftLevels.routable) ||
      Number(right.installed) - Number(left.installed) ||
      (left.displayName ?? left.driver).localeCompare(right.displayName ?? right.driver)
    );
  });
}
