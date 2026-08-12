import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

/**
 * A provider's factual terminal state for one turn. This is deliberately not
 * named success: completion does not prove correctness or user satisfaction.
 */
export const TaskOutcomeTerminalState = Schema.Literals([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "aborted",
]);
export type TaskOutcomeTerminalState = typeof TaskOutcomeTerminalState.Type;

/**
 * Content-free evidence that a provider turn reached a terminal state.
 * Quality, cost, and change survival are separate observations added only
 * when their evidence exists.
 */
export const TaskOutcomeObservation = Schema.Struct({
  version: Schema.Literal(1),
  terminalState: TaskOutcomeTerminalState,
  provider: Schema.Struct({
    driver: ProviderDriverKind,
    instanceId: Schema.optionalKey(ProviderInstanceId),
  }),
  observedAt: IsoDateTime,
});
export type TaskOutcomeObservation = typeof TaskOutcomeObservation.Type;
