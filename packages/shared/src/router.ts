import {
  deriveAgentStatusLevels,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type RouterCandidate,
  type RouterContext,
  type RouterDecision,
  type RouterDecisionReason,
  type RouterExecutionStyle,
  type RouterReviewRequirement,
  type RouterSelectionSource,
  type ServerProvider,
  type TaskProfile,
  type TaskRepositoryEvidence,
} from "@t3tools/contracts";

import { classifyTaskProfile } from "./taskProfile.ts";

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

export type AdaptiveRoutingMode = "shadow" | "auto" | "lean" | "deep";

export interface ScoredRouterCandidate extends RouterCandidate {
  readonly score: number;
  readonly fitLabel: string;
}

export interface AdaptiveRouteResolution {
  readonly mode: AdaptiveRoutingMode;
  readonly applied: boolean;
  readonly selectedInstanceId: ProviderInstanceId;
  readonly recommendedCandidate: ScoredRouterCandidate | null;
  readonly candidates: ReadonlyArray<ScoredRouterCandidate>;
  readonly executionStyle: RouterExecutionStyle;
  readonly summary: string;
}

const LEAN_DRIVER_WEIGHT: Record<string, number> = {
  opencode: 18,
  codex: 16,
  cursor: 16,
  grok: 16,
  antigravity: 15,
  claudeAgent: 12,
};

const DEEP_DRIVER_WEIGHT: Record<string, number> = {
  claudeAgent: 24,
  codex: 22,
  antigravity: 19,
  opencode: 15,
  cursor: 15,
  grok: 13,
};

export function scoreRouterCandidates(input: {
  readonly taskProfile: TaskProfile;
  readonly context: RouterContext;
  readonly mode: AdaptiveRoutingMode;
  readonly currentInstanceId?: ProviderInstanceId;
}): ReadonlyArray<ScoredRouterCandidate> {
  const style =
    input.mode === "lean"
      ? "lean"
      : input.mode === "deep"
        ? "standard"
        : executionStyle(input.taskProfile);
  const needsDeep =
    input.mode === "deep" ||
    input.taskProfile.complexity.band === "high" ||
    input.taskProfile.complexity.band === "very-high" ||
    input.taskProfile.kinds.includes("debugging") ||
    input.taskProfile.kinds.includes("review");
  const needsResearch = input.taskProfile.kinds.includes("research");

  return input.context.candidates
    .map((candidate): ScoredRouterCandidate => {
      if (!candidate.eligible) {
        return {
          ...candidate,
          score: 0,
          fitLabel: `Blocked (${candidate.blockers.join(", ") || "unavailable"})`,
        };
      }
      let score = 60;
      const weights = style === "lean" && !needsDeep ? LEAN_DRIVER_WEIGHT : DEEP_DRIVER_WEIGHT;
      score += weights[candidate.driver] ?? 14;
      if (needsResearch && (candidate.driver === "antigravity" || candidate.driver === "claudeAgent")) {
        score += 8;
      }
      if (input.currentInstanceId && candidate.instanceId === input.currentInstanceId) {
        score += 5;
      }
      const clamped = Math.min(100, score);
      const fitLabel =
        style === "lean" && !needsDeep
          ? "Fast lean fit"
          : needsDeep
            ? "Deep reasoning fit"
            : needsResearch
              ? "Research fit"
              : "Balanced fit";
      return { ...candidate, score: clamped, fitLabel };
    })
    .toSorted((left, right) => right.score - left.score || compareCandidateIdentity(left, right));
}

export function resolveAdaptiveRoute(input: {
  readonly mode: AdaptiveRoutingMode;
  readonly taskProfile: TaskProfile;
  readonly context: RouterContext;
  readonly effectiveSelection: ModelSelection;
  readonly selectionSource?: RouterSelectionSource;
}): AdaptiveRouteResolution {
  const candidates = scoreRouterCandidates({
    taskProfile: input.taskProfile,
    context: input.context,
    mode: input.mode,
    currentInstanceId: input.effectiveSelection.instanceId,
  });
  const recommendedCandidate = candidates.find((candidate) => candidate.eligible) ?? null;
  const style: RouterExecutionStyle =
    input.mode === "lean"
      ? "lean"
      : input.mode === "deep"
        ? "standard"
        : executionStyle(input.taskProfile);
  const canApply =
    input.mode !== "shadow" &&
    input.selectionSource !== "turn-override" &&
    recommendedCandidate !== null;
  const selectedInstanceId = canApply
    ? recommendedCandidate.instanceId
    : input.effectiveSelection.instanceId;
  const applied = canApply && selectedInstanceId !== input.effectiveSelection.instanceId;
  const summary =
    recommendedCandidate === null
      ? "No routable provider available."
      : applied
        ? `Routed to ${recommendedCandidate.driver} (${recommendedCandidate.score}/100 · ${recommendedCandidate.fitLabel}).`
        : `${recommendedCandidate.driver} leads (${recommendedCandidate.score}/100 · ${recommendedCandidate.fitLabel}).`;

  return {
    mode: input.mode,
    applied,
    selectedInstanceId,
    recommendedCandidate,
    candidates,
    executionStyle: style,
    summary,
  };
}

export type ContextWindowHealth = "healthy" | "elevated" | "critical";

export interface ThreadContextInspection {
  readonly userTokens: number;
  readonly assistantTokens: number;
  readonly activityTokens: number;
  readonly draftTokens: number;
  readonly totalTokens: number;
  readonly windowLimitTokens: number;
  readonly utilizationRatio: number;
  readonly health: ContextWindowHealth;
  readonly referencedFiles: ReadonlyArray<string>;
  readonly checkpointFiles: ReadonlyArray<string>;
  readonly taskProfile: TaskProfile;
}

// shortcut: ~4 chars/token heuristic avoids shipping a multi-MB BPE tokenizer to browser/mobile clients.
const estimateTokens = (text: string): number =>
  text.length === 0 ? 0 : Math.ceil(text.length / 4);

const FILE_REF_PATTERN =
  /\b[\w./-]+\.(?:c|cc|cpp|css|go|html|java|js|jsx|json|kt|md|mjs|py|rs|sql|swift|toml|ts|tsx|yaml|yml)\b/g;

export function inspectThreadContext(input: {
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  readonly activityCount?: number;
  readonly checkpointFiles?: ReadonlyArray<string>;
  readonly draftText?: string;
  readonly windowLimitTokens?: number;
  readonly repositoryEvidence?: TaskRepositoryEvidence;
}): ThreadContextInspection {
  let userTokens = 0;
  let assistantTokens = 0;
  const fileMatches: string[] = [];

  for (const message of input.messages) {
    const tokens = estimateTokens(message.text);
    if (message.role === "user") {
      userTokens += tokens;
    } else {
      assistantTokens += tokens;
    }
    const refs = message.text.match(FILE_REF_PATTERN);
    if (refs) fileMatches.push(...refs);
  }

  const draftText = input.draftText?.trim() ?? "";
  if (draftText.length > 0) {
    const refs = draftText.match(FILE_REF_PATTERN);
    if (refs) fileMatches.push(...refs);
  }

  const draftTokens = estimateTokens(draftText);
  const activityTokens = Math.max(0, (input.activityCount ?? 0) * 45);
  const totalTokens = userTokens + assistantTokens + activityTokens + draftTokens;
  const windowLimitTokens = Math.max(4_000, input.windowLimitTokens ?? 200_000);
  const utilizationRatio = Math.min(1, totalTokens / windowLimitTokens);
  const health: ContextWindowHealth =
    utilizationRatio >= 0.85 ? "critical" : utilizationRatio >= 0.65 ? "elevated" : "healthy";

  const latestUserText =
    draftText.length > 0
      ? draftText
      : ([...input.messages].reverse().find((message) => message.role === "user")?.text ??
        "General task");
  const taskProfile = classifyTaskProfile({
    text: latestUserText,
    ...(input.repositoryEvidence ? { repositoryEvidence: input.repositoryEvidence } : {}),
  });

  return {
    userTokens,
    assistantTokens,
    activityTokens,
    draftTokens,
    totalTokens,
    windowLimitTokens,
    utilizationRatio,
    health,
    referencedFiles: unique(fileMatches).slice(0, 16),
    checkpointFiles: unique(input.checkpointFiles ?? []).slice(0, 16),
    taskProfile,
  };
}

export interface StructuredHandoffPacket {
  readonly title: string;
  readonly targetInstanceId: ProviderInstanceId;
  readonly targetDriver: ProviderDriverKind;
  readonly changedFiles: ReadonlyArray<string>;
  readonly verificationSummary: ReadonlyArray<string>;
  readonly prompt: string;
}

export function buildStructuredHandoffPacket(input: {
  readonly threadTitle: string;
  readonly branch?: string | null;
  readonly targetInstanceId: ProviderInstanceId;
  readonly targetDriver: ProviderDriverKind;
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  readonly changedFiles?: ReadonlyArray<string>;
  readonly verificationSummary?: ReadonlyArray<string>;
  readonly remaining?: ReadonlyArray<string>;
  readonly followUpNote?: string;
}): StructuredHandoffPacket {
  const changedFiles = unique(input.changedFiles ?? []).slice(0, 16);
  const verificationSummary = unique(input.verificationSummary ?? []).slice(0, 8);
  const recentTurns = input.messages
    .filter((message) => message.text.trim().length > 0)
    .slice(-4)
    .map((message) => {
      const compact = message.text.trim().replace(/\s+/g, " ").slice(0, 280);
      return `- [${message.role}]: ${compact}`;
    });

  const lines = [
    `Cross-provider handoff from thread: ${input.threadTitle}`,
    ...(input.branch ? [`Branch: ${input.branch}`] : []),
    `Target agent driver: ${input.targetDriver}`,
    ...(changedFiles.length > 0
      ? ["Checkpointed files:", ...changedFiles.map((path) => `- ${path}`)]
      : []),
    ...(verificationSummary.length > 0
      ? ["Verified commands:", ...verificationSummary.map((item) => `- ${item}`)]
      : []),
    ...(input.remaining && input.remaining.length > 0
      ? ["Remaining objectives:", ...input.remaining.map((item) => `- ${item}`)]
      : []),
    ...(recentTurns.length > 0 ? ["Recent conversation digest:", ...recentTurns] : []),
    ...(input.followUpNote?.trim()
      ? [`Immediate instruction: ${input.followUpNote.trim()}`]
      : [
          "Continue from this state. Inspect the modified files before making further edits and verify your changes.",
        ]),
  ];

  return {
    title: `Handoff (${input.targetDriver}): ${input.threadTitle}`,
    targetInstanceId: input.targetInstanceId,
    targetDriver: input.targetDriver,
    changedFiles,
    verificationSummary,
    prompt: lines.join("\n"),
  };
}

export interface AgentArenaCompetitor {
  readonly slot: "A" | "B";
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly score: number;
  readonly threadTitle: string;
  readonly prompt: string;
}

export function planAgentArenaRun(input: {
  readonly prompt: string;
  readonly baseTitle: string;
  readonly context: RouterContext;
  readonly mode?: AdaptiveRoutingMode;
  readonly preferredInstanceId?: ProviderInstanceId;
}): ReadonlyArray<AgentArenaCompetitor> {
  const trimmedPrompt = input.prompt.trim();
  if (trimmedPrompt.length === 0) return [];
  const taskProfile = classifyTaskProfile({ text: trimmedPrompt });
  const ranked = scoreRouterCandidates({
    taskProfile,
    context: input.context,
    mode: input.mode ?? "auto",
    ...(input.preferredInstanceId ? { currentInstanceId: input.preferredInstanceId } : {}),
  }).filter((candidate) => candidate.eligible);

  if (ranked.length < 2) return [];
  const first = ranked[0]!;
  const second =
    ranked.find(
      (candidate) =>
        candidate.instanceId !== first.instanceId && candidate.driver !== first.driver,
    ) ?? ranked[1]!;

  return (
    [
      { slot: "A" as const, candidate: first },
      { slot: "B" as const, candidate: second },
    ] as const
  ).map(({ slot, candidate }) => ({
    slot,
    instanceId: candidate.instanceId,
    driver: candidate.driver,
    score: candidate.score,
    threadTitle: `[Arena ${slot} · ${candidate.driver}] ${input.baseTitle}`,
    prompt: trimmedPrompt,
  }));
}
