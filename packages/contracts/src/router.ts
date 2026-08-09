import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import { TaskCollaborationRecommendation, TaskToolRequirement } from "./taskProfile.ts";

export const AgentRoutingBlocker = Schema.Literals([
  "driver_unavailable",
  "not_installed",
  "provider_error",
  "disabled",
  "unauthenticated",
]);
export type AgentRoutingBlocker = typeof AgentRoutingBlocker.Type;

export const RouterCandidate = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  eligible: Schema.Boolean,
  blockers: Schema.Array(AgentRoutingBlocker),
});
export type RouterCandidate = typeof RouterCandidate.Type;

/** Server-owned, transient input to the pure router policy. */
export const RouterContext = Schema.Struct({
  version: Schema.Literal(1),
  candidates: Schema.Array(RouterCandidate),
  limited: Schema.Boolean,
});
export type RouterContext = typeof RouterContext.Type;

export const RouterSelectionSource = Schema.Literals(["turn-override", "thread"]);
export type RouterSelectionSource = typeof RouterSelectionSource.Type;

export const RouterCandidateEligibility = Schema.Literals(["eligible", "excluded", "unknown"]);
export type RouterCandidateEligibility = typeof RouterCandidateEligibility.Type;

export const RouterRecommendationOutcome = Schema.Literals([
  "retain-current",
  "single-eligible-alternative",
  "no-eligible-candidate",
  "insufficient-evidence",
]);
export type RouterRecommendationOutcome = typeof RouterRecommendationOutcome.Type;

export const RouterReviewRequirement = Schema.Literals(["none", "recommended", "required"]);
export type RouterReviewRequirement = typeof RouterReviewRequirement.Type;

export const RouterDecisionReason = Schema.Literals([
  "turn-override-authoritative",
  "thread-selection-authoritative",
  "selected-provider-eligible",
  "selected-provider-excluded",
  "selected-provider-unknown",
  "single-eligible-alternative",
  "multiple-eligible-candidates",
  "no-eligible-candidates",
  "review-recommended",
  "review-required",
  "research-required",
  "collaboration-recommended",
  "context-limited",
  "shadow-mode-no-override",
]);
export type RouterDecisionReason = typeof RouterDecisionReason.Type;

/**
 * Version 1 is deliberately shadow-only. It explains the current selection
 * and execution policy without changing the provider or model chosen by the
 * user. Candidate ranking waits for measured outcome evidence.
 */
export const RouterDecision = Schema.Struct({
  version: Schema.Literal(1),
  mode: Schema.Literal("shadow"),
  applied: Schema.Literal(false),
  effectiveSelection: Schema.Struct({
    instanceId: ProviderInstanceId,
    model: TrimmedNonEmptyString,
  }),
  selectionSource: RouterSelectionSource,
  selectedEligibility: RouterCandidateEligibility,
  recommendation: Schema.Struct({
    outcome: RouterRecommendationOutcome,
    instanceId: Schema.optionalKey(ProviderInstanceId),
  }),
  candidates: Schema.Array(RouterCandidate),
  execution: Schema.Struct({
    tools: Schema.Array(TaskToolRequirement),
    collaboration: TaskCollaborationRecommendation,
    review: RouterReviewRequirement,
    research: Schema.Boolean,
  }),
  reasons: Schema.Array(RouterDecisionReason),
});
export type RouterDecision = typeof RouterDecision.Type;
