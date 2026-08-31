/**
 * UsageService - scans provider transcripts and returns priced daily usage.
 *
 * The scan reads the provider CLIs' own session files rather than Sleepers Code's
 * orchestration projections, so usage covers turns driven outside Sleepers Code too.
 * This is the approach `ccusage` takes.
 *
 * Transcripts are append-only, so parsed records are memoised per file by
 * `(size, mtime)`. A cold 30-day scan of ~1.4 GB lands around 2-3 seconds; warm
 * scans only reparse files that changed.
 *
 * @module UsageService
 */
import * as NodeOS from "node:os";

import {
  USAGE_CONTRACT_VERSION,
  deriveAgentStatusLevels,
  type ProviderDriverKind,
  type ServerProvider,
  type UsageBucket,
  type UsageProviderKind,
  type UsageProviderCoverage,
  type UsageSource,
  type UsageSummary,
  type UsageSummaryInput,
  UsageReadError,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { ServerConfig } from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { UsageAggregator } from "./usageAggregation.ts";
import { parseRateTable, type RateTable } from "./usagePricing.ts";
import {
  listTranscriptFiles,
  readDirectoryVolumeId,
  readTranscriptRecords,
} from "./usageTranscriptReader.ts";
import {
  decodeScanCache,
  dedupeWithinFile,
  encodeScanCache,
  pruneScanCache,
  type ScanCache,
} from "./usageScanCache.ts";
import type { UsageRecord } from "./usageTranscripts.ts";

const LITELLM_RATES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** Rates move rarely; a day-old table keeps the page working offline. */
const RATES_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Files are filtered by mtime before opening. The slack covers a session whose
 * last write lands just before local midnight on the window's first day.
 */
const MTIME_SLACK_MS = 36 * 60 * 60 * 1000;

/** Longest window the UI offers, plus slack. Older entries are pruned. */
const CACHE_RETENTION_DAYS = 90;

const usageProviderFromDriver = (driver: ProviderDriverKind): UsageProviderKind | null => {
  switch (String(driver)) {
    case "claudeAgent":
      return "claude";
    case "codex":
    case "cursor":
    case "grok":
    case "opencode":
    case "antigravity":
      return String(driver) as UsageProviderKind;
    default:
      return null;
  }
};

const providerDisplayName = (driver: ProviderDriverKind): string => {
  switch (String(driver)) {
    case "claudeAgent":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    case "grok":
      return "Grok";
    case "opencode":
      return "OpenCode";
    case "antigravity":
      return "Antigravity";
    default:
      return driver;
  }
};

export function makeUsageProviderCoverage(
  hostId: string,
  providers: ReadonlyArray<ServerProvider>,
  buckets: ReadonlyArray<UsageBucket>,
): ReadonlyArray<UsageProviderCoverage> {
  const observedProviders = new Set(buckets.map((bucket) => bucket.provider));
  return providers
    .filter((provider) => provider.installed)
    .map((provider) => {
      const usageProvider = usageProviderFromDriver(provider.driver);
      const reporting =
        usageProvider === "claude" || usageProvider === "codex"
          ? ("transcript" as const)
          : usageProvider === "antigravity"
            ? ("runtimeEvents" as const)
            : usageProvider === "opencode"
              ? ("database" as const)
              : ("notReported" as const);
      return {
        hostId,
        instanceId: provider.instanceId,
        provider: provider.driver,
        displayName: provider.displayName ?? providerDisplayName(provider.driver),
        installed: provider.installed,
        enabled: provider.enabled,
        authStatus: provider.auth.status,
        routable: deriveAgentStatusLevels(provider).routable,
        reporting,
        observed: usageProvider !== null && observedProviders.has(usageProvider),
        message:
          reporting !== "notReported"
            ? null
            : "This provider does not expose trustworthy durable usage totals yet.",
      };
    });
}

/** On-disk shape of the rate snapshot. */
const RatesCacheFile = Schema.Struct({
  fetchedAtMs: Schema.Number,
  document: Schema.Unknown,
});
const decodeRatesCache = Schema.decodeUnknownEffect(
  Schema.fromJsonString(RatesCacheFile as unknown as Schema.Codec<typeof RatesCacheFile.Type>),
);
const encodeRatesCache = Schema.encodeEffect(
  Schema.fromJsonString(RatesCacheFile as unknown as Schema.Codec<typeof RatesCacheFile.Type>),
);

/** The scan cache is narrowed by hand in `usageScanCache`, so JSON is enough here. */
const ScanCacheJson = Schema.fromJsonString(Schema.Unknown as unknown as Schema.Codec<unknown>);
const decodeScanCacheFile = Schema.decodeUnknownEffect(ScanCacheJson);
const encodeScanCacheFile = Schema.encodeEffect(ScanCacheJson);

const RuntimeUsageActivityRow = Schema.Struct({
  activityId: Schema.String,
  threadId: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  model: Schema.String,
  payloadJson: Schema.String,
});

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function parseRuntimeUsagePayload(payloadJson: string): {
  readonly usedTokens: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const payload = parsed as Record<string, unknown>;
  return {
    usedTokens: nonNegativeInteger(payload.usedTokens),
    inputTokens: nonNegativeInteger(payload.inputTokens),
    cachedInputTokens: nonNegativeInteger(payload.cachedInputTokens),
    outputTokens: nonNegativeInteger(payload.outputTokens),
    reasoningTokens: nonNegativeInteger(payload.reasoningOutputTokens),
  };
}

export class UsageService extends Context.Service<
  UsageService,
  {
    readonly readSummary: (input: UsageSummaryInput) => Effect.Effect<UsageSummary, UsageReadError>;
  }
>()("t3/usage/UsageService") {}

/** Empty summary, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  UsageService,
  UsageService.of({
    readSummary: (input) =>
      Effect.succeed({
        contractVersion: USAGE_CONTRACT_VERSION,
        readAt: "1970-01-01T00:00:00.000Z",
        timeZone: input.timeZone,
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        buckets: [],
        sources: [],
        providerCoverage: [],
        pricing: {
          status: "unavailable",
          source: LITELLM_RATES_URL,
          fetchedAt: null,
          knownModels: 0,
        },
        scanDurationMs: 0,
      }),
  }),
);

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;
  const sql = yield* SqlClient.SqlClient;

  const listAntigravityRuntimeUsage = SqlSchema.findAll({
    Request: Schema.Struct({ since: Schema.String, until: Schema.String }),
    Result: RuntimeUsageActivityRow,
    execute: ({ since, until }) => sql`
      SELECT
        activity.activity_id AS "activityId",
        activity.thread_id AS "threadId",
        activity.turn_id AS "turnId",
        activity.created_at AS "createdAt",
        COALESCE(
          json_extract(activity.payload_json, '$.usageModel'),
          json_extract(thread.model_selection_json, '$.model'),
          'antigravity'
        ) AS "model",
        activity.payload_json AS "payloadJson"
      FROM projection_thread_activities AS activity
      INNER JOIN projection_threads AS thread ON thread.thread_id = activity.thread_id
      WHERE activity.kind = 'context-window.updated'
        AND activity.created_at >= ${since}
        AND activity.created_at <= ${until}
        AND COALESCE(
          json_extract(activity.payload_json, '$.usageProvider'),
          json_extract(thread.model_selection_json, '$.provider')
        ) = 'antigravity'
      ORDER BY activity.created_at ASC, activity.activity_id ASC
    `,
  });

  const fileCache: ScanCache = new Map();
  let cacheDirty = false;

  const ratesCachePath = path.join(config.stateDir, "usage-model-rates.json");
  const scanCachePath = path.join(config.stateDir, "usage-scan-cache.json");
  let rates: RateTable = new Map();
  let ratesFetchedAtMs: number | null = null;
  let ratesStatus: UsageSummary["pricing"]["status"] = "unavailable";

  /**
   * Loads the LiteLLM rate table, preferring a fresh copy and falling back to
   * the on-disk snapshot. With neither, every model reports as unpriced rather
   * than the page failing.
   */
  const ensureRates = Effect.fn("UsageService.ensureRates")(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (ratesFetchedAtMs !== null && now - ratesFetchedAtMs < RATES_TTL_MS) return;

    if (ratesFetchedAtMs === null) {
      const fromDisk = yield* fileSystem.readFileString(ratesCachePath).pipe(
        Effect.flatMap((raw) => decodeRatesCache(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (fromDisk !== null) {
        const parsed = parseRateTable(fromDisk.document);
        if (parsed.size > 0) {
          rates = parsed;
          ratesFetchedAtMs = fromDisk.fetchedAtMs;
          ratesStatus = "cached";
          if (now - fromDisk.fetchedAtMs < RATES_TTL_MS) return;
        }
      }
    }

    const fetched = yield* httpClient.get(LITELLM_RATES_URL).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout(10_000),
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (fetched === null) {
      // The refresh failed; whatever we are serving is now past its TTL and
      // must not keep claiming to be fresh.
      if (rates.size > 0) ratesStatus = "cached";
      return;
    }

    const parsed = parseRateTable(fetched);
    if (parsed.size === 0) return;

    rates = parsed;
    ratesFetchedAtMs = now;
    ratesStatus = "fresh";

    yield* encodeRatesCache({ fetchedAtMs: now, document: fetched }).pipe(
      Effect.flatMap((serialized) => fileSystem.writeFileString(ratesCachePath, serialized)),
      Effect.catchCause(() => Effect.void),
    );
  });

  /**
   * Claude's config dir is the home itself when overridden, but a default
   * install nests transcripts under `~/.claude/projects`. Probe both.
   */
  const resolveClaudeTranscriptDir = (homePath: string) =>
    Effect.gen(function* () {
      const nested = path.join(homePath, ".claude", "projects");
      const nestedExists = yield* fileSystem
        .exists(nested)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      return nestedExists ? nested : path.join(homePath, "projects");
    });

  /** Resolves the transcript directory for each provider. */
  const resolveTranscriptDirs = Effect.fn("UsageService.resolveTranscriptDirs")(function* () {
    // A settings failure must surface as an error: swallowing it here would
    // present "zero usage from every provider" as a valid answer.
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause(
        (cause) =>
          new UsageReadError({
            reason: "scanFailed",
            // Bounded description; the squashed failure travels as the cause.
            // Squashed, not the Cause tree: a full tree in a Defect field is
            // the unbounded wire payload the bounded detail exists to avoid.
            detail: "Server settings could not be read.",
            cause: Cause.squash(cause),
          }),
      ),
    );

    const claudeHome = yield* resolveClaudeHomePath(settings.providers.claudeAgent);
    const claudeDir = yield* resolveClaudeTranscriptDir(claudeHome);
    const codexLayout = yield* resolveCodexHomeLayout(settings.providers.codex);

    return [
      { provider: "claude" as const, dir: claudeDir },
      { provider: "codex" as const, dir: path.join(codexLayout.sharedHomePath, "sessions") },
    ];
  });

  /**
   * Loads the persisted scan cache exactly once per process.
   *
   * `Effect.cached` makes concurrent first readers await the same load rather
   * than each seeing a "loaded" flag set before the read finished and cold
   * scanning against an empty cache.
   */
  const ensureScanCacheLoaded = yield* Effect.cached(
    Effect.gen(function* () {
      const document = yield* fileSystem.readFileString(scanCachePath).pipe(
        Effect.flatMap((raw) => decodeScanCacheFile(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (document === null) return;
      for (const [path, entry] of decodeScanCache(document)) fileCache.set(path, entry);
    }),
  );

  const persistScanCache = Effect.fn("UsageService.persistScanCache")(function* () {
    if (!cacheDirty) return;
    // Cleared only after the write lands, so a failed persist is retried on
    // the next scan instead of leaving disk permanently stale.
    yield* encodeScanCacheFile(encodeScanCache(fileCache)).pipe(
      Effect.flatMap((serialized) => fileSystem.writeFileString(scanCachePath, serialized)),
      Effect.map(() => {
        cacheDirty = false;
      }),
      // A cache we cannot write is a slower next start, not a failed read.
      Effect.catchCause(() => Effect.void),
    );
  });

  /** Parses one transcript, reusing the cached result when it is unchanged. */
  const readFileRecords = (
    filePath: string,
    size: number,
    mtimeMs: number,
    provider: UsageProviderKind,
  ): Effect.Effect<readonly UsageRecord[]> =>
    Effect.gen(function* () {
      const cached = fileCache.get(filePath);
      // Provider is part of the identity: if both providers were ever pointed
      // at one directory, a hit parsed by the other parser must not be reused.
      if (
        cached &&
        cached.size === size &&
        cached.mtimeMs === mtimeMs &&
        cached.provider === provider
      ) {
        return cached.records;
      }

      const parsed = yield* Effect.promise(() => readTranscriptRecords(filePath, provider));
      // A read failure is not an empty transcript: caching it under this
      // (size, mtime) would silently drop the file's usage until it changes.
      if (parsed === null) return [];
      // Stored already de-duplicated within the file, which is 99% of all
      // duplicates. The aggregator still runs the cross-file dedupe pass.
      const records = dedupeWithinFile(parsed);

      fileCache.set(filePath, { size, mtimeMs, provider, records });
      cacheDirty = true;
      return records;
    });

  const readSummary = Effect.fn("UsageService.readSummary")(function* (input: UsageSummaryInput) {
    if (input.sinceDay > input.untilDay) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: `sinceDay '${input.sinceDay}' is after untilDay '${input.untilDay}'`,
      });
    }

    const startedAtMs = yield* Clock.currentTimeMillis;
    yield* ensureRates();
    yield* ensureScanCacheLoaded;

    const hostId = NodeOS.hostname();
    // The home resolvers ask for `Path` themselves; satisfy them from the
    // instance we already hold so `readSummary` stays context-free.
    const dirs = yield* resolveTranscriptDirs().pipe(Effect.provideService(Path.Path, path));
    const windowStart = DateTime.make(`${input.sinceDay}T00:00:00Z`);
    if (Option.isNone(windowStart)) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: `sinceDay '${input.sinceDay}' is not a valid date`,
      });
    }
    const windowStartMs = DateTime.toEpochMillis(windowStart.value) - MTIME_SLACK_MS;

    const aggregator = new UsageAggregator({
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      rates,
    });

    const sources: UsageSource[] = [];
    const livePaths = new Set<string>();
    const walkedRoots: string[] = [];

    const runtimeWindowEnd = DateTime.make(`${input.untilDay}T23:59:59.999Z`);
    const runtimeRows = Option.isNone(runtimeWindowEnd)
      ? null
      : yield* listAntigravityRuntimeUsage({
          since: DateTime.formatIso(
            DateTime.makeUnsafe(DateTime.toEpochMillis(windowStart.value) - MTIME_SLACK_MS),
          ),
          until: DateTime.formatIso(
            DateTime.makeUnsafe(DateTime.toEpochMillis(runtimeWindowEnd.value) + MTIME_SLACK_MS),
          ),
        }).pipe(Effect.catchCause(() => Effect.succeed(null)));
    const runtimeSessions = new Set<string>();
    if (runtimeRows !== null) {
      for (const row of runtimeRows) {
        const usage = parseRuntimeUsagePayload(row.payloadJson);
        if (usage === null) continue;
        const inputIncludesCacheDistance = Math.abs(
          usage.usedTokens - (usage.inputTokens + usage.outputTokens),
        );
        const inputExcludesCacheDistance = Math.abs(
          usage.usedTokens - (usage.inputTokens + usage.cachedInputTokens + usage.outputTokens),
        );
        const uncachedInputTokens =
          inputIncludesCacheDistance <= inputExcludesCacheDistance
            ? Math.max(0, usage.inputTokens - usage.cachedInputTokens)
            : usage.inputTokens;
        const fallbackUncachedTokens =
          uncachedInputTokens + usage.cachedInputTokens + usage.outputTokens === 0
            ? usage.usedTokens
            : uncachedInputTokens;
        const sessionId = `${row.threadId}:${row.turnId ?? row.activityId}`;
        if (
          aggregator.add({
            provider: "antigravity",
            timestampMs: Date.parse(row.createdAt),
            model: row.model,
            sessionId,
            totals: {
              uncachedInputTokens: fallbackUncachedTokens,
              cachedInputTokens: usage.cachedInputTokens,
              cacheCreationTokens: 0,
              outputTokens: usage.outputTokens,
              reasoningTokens: usage.reasoningTokens,
            },
            reportedCostUsd: null,
            dedupeKey: `runtime-activity:${row.activityId}`,
          })
        ) {
          runtimeSessions.add(sessionId);
        }
      }
    }
    sources.push({
      fingerprint: {
        hostId,
        provider: "antigravity",
        resolvedHomePath: `${config.dbPath}#runtime-usage`,
        volumeId: yield* Effect.promise(() => readDirectoryVolumeId(config.stateDir)),
      },
      status: runtimeRows === null ? "failed" : "partial",
      scannedFiles: runtimeRows === null ? 0 : 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: runtimeSessions.size,
      message:
        runtimeRows === null
          ? "The local runtime usage ledger could not be read."
          : "Includes Antigravity turns run through Sleepers Code; external CLI sessions are not available.",
    });

    for (const { provider, dir } of dirs) {
      const volumeId = yield* Effect.promise(() => readDirectoryVolumeId(dir));
      const exists = yield* fileSystem
        .exists(dir)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));

      if (!exists) {
        sources.push({
          fingerprint: { hostId, provider, resolvedHomePath: dir, volumeId },
          status: "missing",
          scannedFiles: 0,
          skippedFiles: 0,
          malformedRecords: 0,
          distinctSessions: 0,
          message: "No transcript directory on this environment.",
        });
        continue;
      }

      walkedRoots.push(dir);
      const files = yield* Effect.promise(() => listTranscriptFiles(dir, windowStartMs));
      let scannedFiles = 0;
      let skippedFiles = 0;
      // Distinct per directory. Buckets carry per-cell session counts, but a
      // session spans days and models, so clients total this figure instead.
      const sessionIds = new Set<string>();

      for (const file of files) {
        livePaths.add(file.path);
        const records = yield* readFileRecords(file.path, file.size, file.mtimeMs, provider);
        if (records.length === 0) {
          skippedFiles += 1;
          continue;
        }
        scannedFiles += 1;
        for (const record of records) {
          // Only sessions that contributed in-window count: the mtime slack
          // admits boundary files whose records fall outside the range.
          if (aggregator.add(record) && record.sessionId.length > 0) {
            sessionIds.add(record.sessionId);
          }
        }
      }

      sources.push({
        fingerprint: { hostId, provider, resolvedHomePath: dir, volumeId },
        status: "ok",
        scannedFiles,
        skippedFiles,
        malformedRecords: 0,
        distinctSessions: sessionIds.size,
        message: null,
      });
    }

    const pruned = pruneScanCache(fileCache, {
      livePaths,
      walkedRoots,
      windowStartMs,
      retentionCutoffMs: startedAtMs - CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    });
    if (pruned > 0) cacheDirty = true;
    yield* persistScanCache();

    const aggregated = aggregator.finish();
    const readAt = yield* DateTime.now;
    const finishedAtMs = yield* Clock.currentTimeMillis;

    return {
      contractVersion: USAGE_CONTRACT_VERSION,
      readAt: DateTime.formatIso(readAt),
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      buckets: aggregated.buckets,
      sources,
      providerCoverage: [],
      pricing: {
        status: ratesStatus,
        source: LITELLM_RATES_URL,
        fetchedAt:
          ratesFetchedAtMs === null
            ? null
            : DateTime.formatIso(DateTime.makeUnsafe(ratesFetchedAtMs)),
        knownModels: rates.size,
      },
      scanDurationMs: Math.max(0, finishedAtMs - startedAtMs),
    } satisfies UsageSummary;
  });

  return { readSummary } as const;
});

export const layer = Layer.effect(UsageService, make);
