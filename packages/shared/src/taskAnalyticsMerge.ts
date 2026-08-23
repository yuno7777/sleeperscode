/** Pure cross-environment merge for privacy-bounded task analytics. */
import {
  TASK_ANALYTICS_CONTRACT_VERSION,
  type EnvironmentId,
  type ProviderDriverKind,
  type RouterCandidateEligibility,
  type RouterRecommendationOutcome,
  type TaskAnalyticsPrimaryDomain,
  type TaskAnalyticsRecord,
  type TaskAnalyticsSummary,
  type TaskComplexityBand,
  type TaskFeedbackValue,
  type TaskKind,
  type TaskOutcomeTerminalState,
} from "@t3tools/contracts";

export interface EnvironmentTaskAnalytics {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly summary: TaskAnalyticsSummary;
}

export type MergedTaskAnalyticsRecord = TaskAnalyticsRecord & {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
};

export interface MergedTaskAnalytics {
  readonly totalTasks: number;
  readonly profiledTasks: number;
  readonly routedTasks: number;
  readonly terminalTasks: number;
  readonly timedTasks: number;
  readonly feedbackTasks: number;
  readonly totalElapsedMs: number;
  readonly averageElapsedMs: number | null;
  readonly limitedRoutes: number;
  readonly feedback: readonly { readonly value: TaskFeedbackValue; readonly count: number }[];
  readonly terminalStates: readonly {
    readonly state: TaskOutcomeTerminalState;
    readonly count: number;
  }[];
  readonly providers: readonly { readonly driver: ProviderDriverKind; readonly count: number }[];
  readonly kinds: readonly { readonly kind: TaskKind; readonly count: number }[];
  readonly domains: readonly {
    readonly domain: TaskAnalyticsPrimaryDomain;
    readonly count: number;
  }[];
  readonly complexities: readonly {
    readonly complexity: TaskComplexityBand;
    readonly count: number;
  }[];
  readonly recommendations: readonly {
    readonly recommendation: RouterRecommendationOutcome;
    readonly count: number;
  }[];
  readonly eligibilities: readonly {
    readonly eligibility: RouterCandidateEligibility;
    readonly count: number;
  }[];
  readonly records: readonly MergedTaskAnalyticsRecord[];
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly EnvironmentId[];
  readonly truncated: boolean;
}

function increment<Key>(counts: Map<Key, number>, key: Key): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function descending<Key>(counts: ReadonlyMap<Key, number>): readonly [Key, number][] {
  return [...counts].sort((left, right) => right[1] - left[1]);
}

export function mergeTaskAnalytics(
  environments: readonly EnvironmentTaskAnalytics[],
  contractVersion = TASK_ANALYTICS_CONTRACT_VERSION,
): MergedTaskAnalytics {
  const seenSources = new Map<string, string>();
  const duplicateSources: string[] = [];
  const staleEnvironments: EnvironmentId[] = [];
  const records: MergedTaskAnalyticsRecord[] = [];
  let truncated = false;

  for (const environment of environments) {
    if (environment.summary.contractVersion !== contractVersion) {
      staleEnvironments.push(environment.environmentId);
      continue;
    }
    const claimedBy = seenSources.get(environment.summary.sourceFingerprint);
    if (claimedBy !== undefined) {
      duplicateSources.push(`${environment.label} (same store as ${claimedBy})`);
      continue;
    }
    seenSources.set(environment.summary.sourceFingerprint, environment.label);
    truncated ||= environment.summary.truncated;
    records.push(
      ...environment.summary.records.map((record) => ({
        ...record,
        environmentId: environment.environmentId,
        environmentLabel: environment.label,
      })),
    );
  }

  records.sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));

  const terminalStates = new Map<TaskOutcomeTerminalState, number>();
  const providers = new Map<ProviderDriverKind, number>();
  const kinds = new Map<TaskKind, number>();
  const domains = new Map<TaskAnalyticsPrimaryDomain, number>();
  const complexities = new Map<TaskComplexityBand, number>();
  const recommendations = new Map<RouterRecommendationOutcome, number>();
  const eligibilities = new Map<RouterCandidateEligibility, number>();
  const feedback = new Map<TaskFeedbackValue, number>();
  let profiledTasks = 0;
  let routedTasks = 0;
  let terminalTasks = 0;
  let timedTasks = 0;
  let feedbackTasks = 0;
  let totalElapsedMs = 0;
  let limitedRoutes = 0;

  for (const record of records) {
    if (record.profile !== null) {
      profiledTasks += 1;
      for (const kind of record.profile.kinds) increment(kinds, kind);
      increment(domains, record.profile.primaryDomain);
      increment(complexities, record.profile.complexity);
    }
    if (record.route !== null) {
      routedTasks += 1;
      if (record.route.contextLimited) limitedRoutes += 1;
      increment(recommendations, record.route.recommendation);
      increment(eligibilities, record.route.selectedEligibility);
    }
    if (record.outcome !== null) {
      terminalTasks += 1;
      increment(terminalStates, record.outcome.terminalState);
      increment(providers, record.outcome.provider.driver);
    }
    if (record.elapsedMs !== undefined) {
      timedTasks += 1;
      totalElapsedMs += record.elapsedMs;
    }
    if (record.feedback !== undefined && record.feedback !== null) {
      feedbackTasks += 1;
      increment(feedback, record.feedback.value);
    }
  }

  return {
    totalTasks: records.length,
    profiledTasks,
    routedTasks,
    terminalTasks,
    timedTasks,
    feedbackTasks,
    totalElapsedMs,
    averageElapsedMs: timedTasks === 0 ? null : Math.round(totalElapsedMs / timedTasks),
    limitedRoutes,
    feedback: descending(feedback).map(([value, count]) => ({ value, count })),
    terminalStates: descending(terminalStates).map(([state, count]) => ({ state, count })),
    providers: descending(providers).map(([driver, count]) => ({ driver, count })),
    kinds: descending(kinds).map(([kind, count]) => ({ kind, count })),
    domains: descending(domains).map(([domain, count]) => ({ domain, count })),
    complexities: descending(complexities).map(([complexity, count]) => ({ complexity, count })),
    recommendations: descending(recommendations).map(([recommendation, count]) => ({
      recommendation,
      count,
    })),
    eligibilities: descending(eligibilities).map(([eligibility, count]) => ({
      eligibility,
      count,
    })),
    records,
    duplicateSources,
    staleEnvironments,
    truncated,
  };
}
