import {
  deriveAgentStatusLevels,
  type ModelSelection,
  type RouterCandidate,
  type RouterContext,
  type RouterDecision,
  type RouterDecisionReason,
  type RouterExecutionStyle,
  type RouterReviewRequirement,
  type RouterSelectionSource,
  type ServerProvider,
  type TaskProfile,
} from "@t3tools/contracts";

const ROUTER_CONTEXT_MAX_CANDIDATES = 64;

export interface RouterDecisionReasonExplanation {
  readonly label: string;
  readonly detail: string;
}

/** User-facing copy for every bounded router reason code. */
export const ROUTER_DECISION_REASON_EXPLANATIONS = {
  "turn-override-authoritative": {
    label: "Turn override kept",
    detail: "This turn's explicit provider and model choice remained authoritative.",
  },
  "thread-selection-authoritative": {
    label: "Thread selection kept",
    detail: "The provider and model already selected for this thread remained authoritative.",
  },
  "selected-provider-eligible": {
    label: "Selected provider is routable",
    detail: "The selected provider was installed, enabled, authenticated, and available.",
  },
  "selected-provider-excluded": {
    label: "Selected provider is not routable",
    detail: "The selected provider failed at least one current routing eligibility check.",
  },
  "selected-provider-unknown": {
    label: "Selected provider was not observed",
    detail: "The selected provider was absent from the bounded provider snapshot.",
  },
  "single-eligible-alternative": {
    label: "One eligible alternative",
    detail: "Exactly one other provider passed the current routing eligibility checks.",
  },
  "multiple-eligible-candidates": {
    label: "Several eligible providers",
    detail: "More than one provider was eligible, so no unsupported ranking was invented.",
  },
  "no-eligible-candidates": {
    label: "No eligible providers",
    detail: "No observed provider passed all current routing eligibility checks.",
  },
  "review-recommended": {
    label: "Review recommended",
    detail: "The task profile indicates that an independent review would be useful.",
  },
  "review-required": {
    label: "Review required",
    detail: "The task profile indicates that an independent review should be required.",
  },
  "research-required": {
    label: "Research capability needed",
    detail: "The task profile includes research work and may need web or document access.",
  },
  "collaboration-recommended": {
    label: "Collaboration recommended",
    detail: "The task profile indicates useful independent or parallel work.",
  },
  "lean-execution-recommended": {
    label: "Lean execution recommended",
    detail:
      "This appears to be a small, low-risk change, so extra orchestration is unlikely to help.",
  },
  "context-limited": {
    label: "Provider context was limited",
    detail: "The provider snapshot was bounded, so absence was not treated as definitive.",
  },
  "shadow-mode-no-override": {
    label: "Shadow mode only",
    detail: "The router recorded evidence but did not change the user's selection.",
  },
} satisfies Record<RouterDecisionReason, RouterDecisionReasonExplanation>;

export function explainRouterDecisionReason(
  reason: RouterDecisionReason,
): RouterDecisionReasonExplanation {
  return ROUTER_DECISION_REASON_EXPLANATIONS[reason];
}

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

const executionStyle = (profile: TaskProfile): RouterExecutionStyle =>
  profile.signals.includes("trivial-change") &&
  profile.complexity.band === "low" &&
  profile.collaboration === "single-worker" &&
  profile.securitySensitivity === "normal" &&
  profile.testingRequirement !== "broad" &&
  profile.visualRequirement !== "required"
    ? "lean"
    : "standard";

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
  const style = executionStyle(input.taskProfile);
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
    ...(style === "lean" ? (["lean-execution-recommended"] as const) : []),
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
      style,
      tools: input.taskProfile.toolRequirements,
      collaboration: input.taskProfile.collaboration,
      review,
      research,
    },
    reasons,
  };
}
