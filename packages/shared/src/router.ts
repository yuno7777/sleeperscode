import {
  deriveAgentStatusLevels,
  type ModelSelection,
  type RouterCandidate,
  type RouterContext,
  type RouterDecision,
  type RouterDecisionReason,
  type RouterReviewRequirement,
  type RouterSelectionSource,
  type ServerProvider,
  type TaskProfile,
} from "@t3tools/contracts";

const ROUTER_CONTEXT_MAX_CANDIDATES = 64;

const compareCandidateIdentity = (left: RouterCandidate, right: RouterCandidate): number => {
  if (left.instanceId < right.instanceId) return -1;
  if (left.instanceId > right.instanceId) return 1;
  return 0;
};

export function buildRouterContext(providers: ReadonlyArray<ServerProvider>): RouterContext {
  const candidates = providers
    .map((provider): RouterCandidate => {
      const levels = deriveAgentStatusLevels(provider);
      return {
        instanceId: provider.instanceId,
        driver: provider.driver,
        eligible: levels.routable,
        blockers: levels.routingBlockers,
      };
    })
    .sort(compareCandidateIdentity);

  return {
    version: 1,
    candidates: candidates.slice(0, ROUTER_CONTEXT_MAX_CANDIDATES),
    limited: candidates.length > ROUTER_CONTEXT_MAX_CANDIDATES,
  };
}

const reviewRequirement = (profile: TaskProfile): RouterReviewRequirement => {
  if (
    profile.securitySensitivity === "high" ||
    profile.kinds.includes("review") ||
    profile.complexity.band === "very-high"
  ) {
    return "required";
  }
  if (profile.securitySensitivity === "elevated" || profile.complexity.band === "high") {
    return "recommended";
  }
  return "none";
};

const unique = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(values)];

export function planRouterDecision(input: {
  readonly taskProfile: TaskProfile;
  readonly context: RouterContext;
  readonly effectiveSelection: ModelSelection;
  readonly selectionSource: RouterSelectionSource;
}): RouterDecision {
  const selected = input.context.candidates.find(
    (candidate) => candidate.instanceId === input.effectiveSelection.instanceId,
  );
  const eligible = input.context.candidates.filter((candidate) => candidate.eligible);
  const selectedEligibility =
    selected === undefined ? "unknown" : selected.eligible ? "eligible" : "excluded";
  const recommendation =
    selectedEligibility === "eligible"
      ? {
          outcome: "retain-current" as const,
          instanceId: input.effectiveSelection.instanceId,
        }
      : eligible.length === 1
        ? {
            outcome: "single-eligible-alternative" as const,
            instanceId: eligible[0]!.instanceId,
          }
        : eligible.length === 0 && !input.context.limited
          ? { outcome: "no-eligible-candidate" as const }
          : { outcome: "insufficient-evidence" as const };
  const review = reviewRequirement(input.taskProfile);
  const research = input.taskProfile.kinds.includes("research");
  const reasons = unique<RouterDecisionReason>([
    input.selectionSource === "turn-override"
      ? "turn-override-authoritative"
      : "thread-selection-authoritative",
    selectedEligibility === "eligible"
      ? "selected-provider-eligible"
      : selectedEligibility === "excluded"
        ? "selected-provider-excluded"
        : "selected-provider-unknown",
    ...(selectedEligibility !== "eligible"
      ? eligible.length === 0 && !input.context.limited
        ? (["no-eligible-candidates"] as const)
        : eligible.length === 1
          ? (["single-eligible-alternative"] as const)
          : (["multiple-eligible-candidates"] as const)
      : []),
    ...(review === "required"
      ? (["review-required"] as const)
      : review === "recommended"
        ? (["review-recommended"] as const)
        : []),
    ...(research ? (["research-required"] as const) : []),
    ...(input.taskProfile.collaboration === "single-worker"
      ? []
      : (["collaboration-recommended"] as const)),
    ...(input.context.limited ? (["context-limited"] as const) : []),
    "shadow-mode-no-override",
  ]);

  return {
    version: 1,
    mode: "shadow",
    applied: false,
    effectiveSelection: {
      instanceId: input.effectiveSelection.instanceId,
      model: input.effectiveSelection.model,
    },
    selectionSource: input.selectionSource,
    selectedEligibility,
    recommendation,
    candidates: input.context.candidates,
    execution: {
      tools: input.taskProfile.toolRequirements,
      collaboration: input.taskProfile.collaboration,
      review,
      research,
    },
    reasons,
  };
}
