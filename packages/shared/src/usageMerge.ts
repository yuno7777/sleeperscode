/**
 * Merges per-environment usage summaries into the single view the page renders.
 *
 * Pure, so the de-duplication and derivation rules can be tested without a
 * connected environment.
 *
 * @module usageMerge
 */
import type {
  EnvironmentId,
  UsageBucket,
  UsageProviderCoverage,
  UsageProviderKind,
  UsageSourceFingerprint,
  UsageSummary,
} from "@t3tools/contracts";

export interface EnvironmentUsage {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly summary: UsageSummary;
}

export interface ProviderTotals {
  readonly provider: UsageProviderKind;
  readonly costUsd: number;
  /** At least one contributing record had a reported or model-derived price. */
  readonly hasPricedUsage: boolean;
  readonly totalTokens: number;
  readonly records: number;
  readonly costShare: number;
  readonly tokenShare: number;
}

export interface ModelTotals {
  readonly model: string;
  readonly provider: UsageProviderKind;
  readonly costUsd: number;
  /** At least one contributing record had a reported or model-derived price. */
  readonly hasPricedUsage: boolean;
  readonly totalTokens: number;
  readonly records: number;
  readonly costShare: number;
}

export interface DailyTotals {
  readonly day: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<UsageProviderKind, DailyProviderTotals>;
}

/** Price completeness for one provider on one calendar day. */
export interface DailyProviderTotals {
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly hasPricedUsage: boolean;
  readonly hasUnpricedUsage: boolean;
}

export interface CostQuality {
  readonly providerReportedShare: number;
  readonly modelPricedShare: number;
  readonly unpricedShare: number;
  readonly cacheSavingsUsd: number;
}

export interface MergedProviderCoverage extends UsageProviderCoverage {
  readonly environmentLabels: readonly string[];
}

export interface MergedUsage {
  readonly costUsd: number;
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly sessions: number;
  readonly providers: readonly ProviderTotals[];
  readonly providerCoverage: readonly MergedProviderCoverage[];
  readonly models: readonly ModelTotals[];
  readonly daily: readonly DailyTotals[];
  readonly costQuality: CostQuality;
  /** Environments whose data was dropped as a duplicate of another's. */
  readonly duplicateSources: readonly string[];
  readonly contributingEnvironments: readonly EnvironmentId[];
  readonly staleEnvironments: readonly EnvironmentId[];
}

/**
 * Two sources are the same physical transcript directory only when host,
 * provider, path and filesystem identity all agree.
 *
 * `volumeId` is what stops two machines that happen to share a hostname and a
 * home path, which is every Mac in a fleet, from collapsing into one source and
 * having one of them silently dropped.
 */
function fingerprintKey(fingerprint: UsageSourceFingerprint): string {
  return [
    fingerprint.hostId,
    fingerprint.provider,
    fingerprint.resolvedHomePath,
    fingerprint.volumeId,
  ].join(" ");
}

/**
 * Decides which environment owns each physical transcript directory.
 *
 * Several environments on one machine (worktree servers, for instance) resolve
 * the same provider home and would otherwise double count every token. The
 * first environment in a stable order claims a fingerprint; the rest have that
 * provider's buckets dropped. Environments are sorted by id so the winner does
 * not change between renders.
 */
function claimSources(environments: readonly EnvironmentUsage[]): {
  readonly ownerByFingerprint: ReadonlyMap<string, EnvironmentId>;
  readonly duplicates: readonly string[];
} {
  const ownerByFingerprint = new Map<string, EnvironmentId>();
  const duplicates: string[] = [];

  const ordered = [...environments].sort((a, b) => a.environmentId.localeCompare(b.environmentId));

  for (const environment of ordered) {
    for (const source of environment.summary.sources) {
      if (source.status === "missing") continue;
      const key = fingerprintKey(source.fingerprint);
      if (ownerByFingerprint.has(key)) {
        duplicates.push(`${environment.label}: ${source.fingerprint.resolvedHomePath}`);
        continue;
      }
      ownerByFingerprint.set(key, environment.environmentId);
    }
  }

  return { ownerByFingerprint, duplicates };
}

/** Sources this environment owns after fingerprint claims, plus their buckets. */
function ownedContribution(
  environment: EnvironmentUsage,
  ownerByFingerprint: ReadonlyMap<string, EnvironmentId>,
): { readonly buckets: readonly UsageBucket[]; readonly sessions: number } {
  const ownedProviders = new Set<UsageProviderKind>();
  let sessions = 0;
  for (const source of environment.summary.sources) {
    if (source.status === "missing") continue;
    const key = fingerprintKey(source.fingerprint);
    if (ownerByFingerprint.get(key) === environment.environmentId) {
      ownedProviders.add(source.fingerprint.provider);
      // Distinct within a directory. Summing per-bucket session counts instead
      // would count a session once per day and model it spans.
      sessions += source.distinctSessions;
    }
  }
  return {
    buckets: environment.summary.buckets.filter((bucket) => ownedProviders.has(bucket.provider)),
    sessions,
  };
}

function bucketTokens(bucket: UsageBucket): number {
  // reasoningTokens is a subset of outputTokens and must not be added again.
  return (
    bucket.totals.uncachedInputTokens +
    bucket.totals.cachedInputTokens +
    bucket.totals.cacheCreationTokens +
    bucket.totals.outputTokens
  );
}

function usageProviderFromCoverage(coverage: UsageProviderCoverage): UsageProviderKind | undefined {
  const provider = String(coverage.provider);
  if (provider === "claudeAgent") return "claude";
  if (
    provider === "codex" ||
    provider === "cursor" ||
    provider === "grok" ||
    provider === "opencode" ||
    provider === "antigravity"
  ) {
    return provider;
  }
  return undefined;
}

const EMPTY_MERGED: MergedUsage = {
  costUsd: 0,
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  records: 0,
  sessions: 0,
  providers: [],
  providerCoverage: [],
  models: [],
  daily: [],
  costQuality: {
    providerReportedShare: 0,
    modelPricedShare: 0,
    unpricedShare: 0,
    cacheSavingsUsd: 0,
  },
  duplicateSources: [],
  contributingEnvironments: [],
  staleEnvironments: [],
};

/**
 * Merges every connected environment's summary.
 *
 * `expectedContractVersion` guards against an environment running older server
 * code: rather than blocking the page, its data is excluded and its id is
 * reported so the UI can say coverage is partial.
 */
export function mergeUsage(
  environments: readonly EnvironmentUsage[],
  expectedContractVersion: number,
): MergedUsage {
  if (environments.length === 0) return EMPTY_MERGED;

  const current: EnvironmentUsage[] = [];
  const staleEnvironments: EnvironmentId[] = [];
  for (const environment of environments) {
    if (environment.summary.contractVersion === expectedContractVersion) {
      current.push(environment);
    } else {
      staleEnvironments.push(environment.environmentId);
    }
  }

  const { ownerByFingerprint, duplicates } = claimSources(current);
  const providerCoverageByKey = new Map<string, MergedProviderCoverage>();
  for (const environment of current) {
    for (const coverage of environment.summary.providerCoverage) {
      const key = `${coverage.hostId}\0${coverage.instanceId}`;
      const existing = providerCoverageByKey.get(key);
      if (existing === undefined) {
        providerCoverageByKey.set(key, {
          ...coverage,
          environmentLabels: [environment.label],
        });
        continue;
      }
      providerCoverageByKey.set(key, {
        ...existing,
        routable: existing.routable || coverage.routable,
        observed: existing.observed || coverage.observed,
        reporting:
          existing.reporting === "transcript" || coverage.reporting === "transcript"
            ? "transcript"
            : existing.reporting === "database" || coverage.reporting === "database"
              ? "database"
              : existing.reporting === "runtimeEvents" || coverage.reporting === "runtimeEvents"
                ? "runtimeEvents"
                : "notReported",
        environmentLabels: existing.environmentLabels.includes(environment.label)
          ? existing.environmentLabels
          : [...existing.environmentLabels, environment.label],
      });
    }
  }

  let costUsd = 0;
  let uncachedInputTokens = 0;
  let cachedInputTokens = 0;
  let cacheCreationTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let records = 0;
  let sessions = 0;
  let cacheSavingsUsd = 0;
  let providerReportedRecords = 0;
  let unpricedRecords = 0;

  const providerAccumulator = new Map<
    UsageProviderKind,
    { costUsd: number; hasPricedUsage: boolean; totalTokens: number; records: number }
  >();
  const modelAccumulator = new Map<
    string,
    {
      provider: UsageProviderKind;
      costUsd: number;
      hasPricedUsage: boolean;
      totalTokens: number;
      records: number;
    }
  >();
  const dailyAccumulator = new Map<
    string,
    {
      costUsd: number;
      totalTokens: number;
      byProvider: Map<UsageProviderKind, DailyProviderTotals>;
    }
  >();
  const contributingEnvironments: EnvironmentId[] = [];

  for (const environment of current) {
    const { buckets, sessions: environmentSessions } = ownedContribution(
      environment,
      ownerByFingerprint,
    );
    if (buckets.length > 0) contributingEnvironments.push(environment.environmentId);
    sessions += environmentSessions;

    for (const bucket of buckets) {
      const tokens = bucketTokens(bucket);

      costUsd += bucket.costUsd;
      cacheSavingsUsd += bucket.cacheSavingsUsd;
      uncachedInputTokens += bucket.totals.uncachedInputTokens;
      cachedInputTokens += bucket.totals.cachedInputTokens;
      cacheCreationTokens += bucket.totals.cacheCreationTokens;
      outputTokens += bucket.totals.outputTokens;
      reasoningTokens += bucket.totals.reasoningTokens;
      records += bucket.records;
      unpricedRecords += bucket.unpricedRecords;
      if (bucket.costSource === "providerReported") providerReportedRecords += bucket.records;

      const provider = providerAccumulator.get(bucket.provider) ?? {
        costUsd: 0,
        hasPricedUsage: false,
        totalTokens: 0,
        records: 0,
      };
      provider.costUsd += bucket.costUsd;
      provider.hasPricedUsage ||= bucket.unpricedRecords < bucket.records;
      provider.totalTokens += tokens;
      provider.records += bucket.records;
      providerAccumulator.set(bucket.provider, provider);

      const modelKey = `${bucket.provider} ${bucket.model}`;
      const model = modelAccumulator.get(modelKey) ?? {
        provider: bucket.provider,
        costUsd: 0,
        hasPricedUsage: false,
        totalTokens: 0,
        records: 0,
      };
      model.costUsd += bucket.costUsd;
      model.hasPricedUsage ||= bucket.unpricedRecords < bucket.records;
      model.totalTokens += tokens;
      model.records += bucket.records;
      modelAccumulator.set(modelKey, model);

      const day = dailyAccumulator.get(bucket.day) ?? {
        costUsd: 0,
        totalTokens: 0,
        byProvider: new Map<UsageProviderKind, DailyProviderTotals>(),
      };
      day.costUsd += bucket.costUsd;
      day.totalTokens += tokens;
      const existingDayProvider = day.byProvider.get(bucket.provider);
      day.byProvider.set(bucket.provider, {
        costUsd: (existingDayProvider?.costUsd ?? 0) + bucket.costUsd,
        totalTokens: (existingDayProvider?.totalTokens ?? 0) + tokens,
        hasPricedUsage:
          (existingDayProvider?.hasPricedUsage ?? false) || bucket.unpricedRecords < bucket.records,
        hasUnpricedUsage:
          (existingDayProvider?.hasUnpricedUsage ?? false) || bucket.unpricedRecords > 0,
      });
      dailyAccumulator.set(bucket.day, day);
    }
  }

  const totalTokens = uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;

  for (const coverage of providerCoverageByKey.values()) {
    if (coverage.reporting === "notReported") continue;
    const provider = usageProviderFromCoverage(coverage);
    if (provider !== undefined && !providerAccumulator.has(provider)) {
      providerAccumulator.set(provider, {
        costUsd: 0,
        hasPricedUsage: false,
        totalTokens: 0,
        records: 0,
      });
    }
  }

  const providers: ProviderTotals[] = [...providerAccumulator.entries()]
    .map(([provider, totals]) => ({
      provider,
      costUsd: totals.costUsd,
      hasPricedUsage: totals.hasPricedUsage,
      totalTokens: totals.totalTokens,
      records: totals.records,
      costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
      tokenShare: totalTokens === 0 ? 0 : totals.totalTokens / totalTokens,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const models: ModelTotals[] = [...modelAccumulator.entries()]
    .map(([key, totals]) => ({
      model: key.slice(key.indexOf(" ") + 1),
      provider: totals.provider,
      costUsd: totals.costUsd,
      hasPricedUsage: totals.hasPricedUsage,
      totalTokens: totals.totalTokens,
      records: totals.records,
      costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  const daily: DailyTotals[] = [...dailyAccumulator.entries()]
    .map(([day, totals]) => ({
      day,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      byProvider: totals.byProvider,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    costUsd,
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    records,
    sessions,
    providers,
    providerCoverage: [...providerCoverageByKey.values()].sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName) || a.instanceId.localeCompare(b.instanceId),
    ),
    models,
    daily,
    costQuality: {
      providerReportedShare: records === 0 ? 0 : providerReportedRecords / records,
      unpricedShare: records === 0 ? 0 : unpricedRecords / records,
      modelPricedShare:
        records === 0 ? 0 : (records - providerReportedRecords - unpricedRecords) / records,
      cacheSavingsUsd,
    },
    duplicateSources: duplicates,
    contributingEnvironments,
    staleEnvironments,
  };
}
