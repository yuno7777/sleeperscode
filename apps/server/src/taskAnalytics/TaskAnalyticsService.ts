/**
 * TaskAnalyticsService - reads compact, content-free task/router evidence.
 */
import { createHash } from "node:crypto";
import * as NodeOS from "node:os";

import {
  TASK_ANALYTICS_CONTRACT_VERSION,
  TASK_ANALYTICS_MAX_RECORDS,
  TaskAnalyticsMutationError,
  TaskAnalyticsReadError,
  type TaskAnalyticsClearResult,
  type TaskAnalyticsPrimaryDomain,
  type TaskAnalyticsRecord,
  type TaskAnalyticsSummary,
  type TaskAnalyticsSummaryInput,
  type TaskProfile,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerConfig } from "../config.ts";
import { ProjectionTaskRunRepositoryLive } from "../persistence/Layers/ProjectionTaskRuns.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import {
  ProjectionTaskRunRepository,
  type ProjectionTaskRun,
} from "../persistence/Services/ProjectionTaskRuns.ts";

export interface TaskAnalyticsServiceShape {
  readonly readSummary: (
    input: TaskAnalyticsSummaryInput,
  ) => Effect.Effect<TaskAnalyticsSummary, TaskAnalyticsReadError>;
  readonly clearHistory: Effect.Effect<TaskAnalyticsClearResult, TaskAnalyticsMutationError>;
}

export class TaskAnalyticsService extends Context.Service<
  TaskAnalyticsService,
  TaskAnalyticsServiceShape
>()("t3/taskAnalytics/TaskAnalyticsService") {}

const domainEntries = ["frontend", "backend", "systems", "research"] as const;

export function primaryDomainFromProfile(profile: TaskProfile): TaskAnalyticsPrimaryDomain {
  const highest = Math.max(...domainEntries.map((domain) => profile.domains[domain]));
  if (highest === 0) return "general";
  const leaders = domainEntries.filter((domain) => profile.domains[domain] === highest);
  return leaders.length === 1 ? leaders[0]! : "mixed";
}

function toAnalyticsRecord(row: ProjectionTaskRun): TaskAnalyticsRecord {
  const route = row.routerDecision;
  const selectedCandidate = route?.candidates.find(
    (candidate) => candidate.instanceId === route.effectiveSelection.instanceId,
  );
  return {
    threadId: row.threadId,
    requestedAt: row.requestedAt,
    profile:
      row.taskProfile === null
        ? null
        : {
            kinds: row.taskProfile.kinds,
            complexity: row.taskProfile.complexity.band,
            primaryDomain: primaryDomainFromProfile(row.taskProfile),
            testingRequirement: row.taskProfile.testingRequirement,
            securitySensitivity: row.taskProfile.securitySensitivity,
          },
    route:
      route === null
        ? null
        : {
            mode: route.mode,
            applied: route.applied,
            selectedInstanceId: route.effectiveSelection.instanceId,
            selectedDriver: selectedCandidate?.driver ?? null,
            model: route.effectiveSelection.model.slice(0, 256),
            selectionSource: route.selectionSource,
            selectedEligibility: route.selectedEligibility,
            recommendation: route.recommendation.outcome,
            candidateCount: route.candidates.length,
            eligibleCandidateCount: route.candidates.filter((candidate) => candidate.eligible)
              .length,
            contextLimited: route.reasons.includes("context-limited"),
            reasons: route.reasons,
          },
    outcome: row.outcome,
  };
}

function makeBoundary(day: string, timeZone: string) {
  const inRequestedZone = DateTime.makeZoned(`${day}T00:00:00`, {
    timeZone,
    adjustForTimeZone: true,
  });
  return Option.orElse(inRequestedZone, () =>
    DateTime.makeZoned(`${day}T00:00:00`, {
      timeZone: "UTC",
      adjustForTimeZone: true,
    }),
  );
}

const make = (sourceFingerprint: string) =>
  Effect.gen(function* () {
    const repository = yield* ProjectionTaskRunRepository;

    const readSummary = Effect.fn("TaskAnalyticsService.readSummary")(function* (
      input: TaskAnalyticsSummaryInput,
    ) {
      if (input.sinceDay > input.untilDay) {
        return yield* new TaskAnalyticsReadError({
          reason: "invalidWindow",
          detail: "The first analytics day must not be after the last analytics day.",
        });
      }

      const since = makeBoundary(input.sinceDay, input.timeZone);
      const untilStart = makeBoundary(input.untilDay, input.timeZone);
      if (Option.isNone(since) || Option.isNone(untilStart)) {
        return yield* new TaskAnalyticsReadError({
          reason: "invalidWindow",
          detail: "The analytics window contains an invalid calendar day.",
        });
      }

      const rows = yield* repository
        .listWindow({
          since: DateTime.formatIso(since.value),
          until: DateTime.formatIso(DateTime.add(untilStart.value, { days: 1 })),
          limit: TASK_ANALYTICS_MAX_RECORDS + 1,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TaskAnalyticsReadError({
                reason: "readFailed",
                detail: "The local task-run projection could not be read.",
                cause,
              }),
          ),
        );

      const now = yield* DateTime.now;
      return {
        contractVersion: TASK_ANALYTICS_CONTRACT_VERSION,
        readAt: DateTime.formatIso(now),
        sourceFingerprint,
        timeZone: input.timeZone,
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        records: rows.slice(0, TASK_ANALYTICS_MAX_RECORDS).map(toAnalyticsRecord),
        truncated: rows.length > TASK_ANALYTICS_MAX_RECORDS,
      } satisfies TaskAnalyticsSummary;
    });

    const clearHistory = repository.clearHistory().pipe(
      Effect.map(({ deletedRecords }) => ({ deletedRecords }) satisfies TaskAnalyticsClearResult),
      Effect.mapError(
        (cause) =>
          new TaskAnalyticsMutationError({
            reason: "clearFailed",
            detail: "The local task and router history could not be cleared.",
            cause,
          }),
      ),
    );

    return TaskAnalyticsService.of({ readSummary, clearHistory });
  });

export const layerTest = (sourceFingerprint = "task-analytics-test-source") =>
  Layer.effect(TaskAnalyticsService, make(sourceFingerprint));

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const sourceFingerprint = createHash("sha256")
      .update(`${NodeOS.hostname()}\0${config.dbPath}`)
      .digest("hex");
    return layerTest(sourceFingerprint).pipe(
      Layer.provide(ProjectionTaskRunRepositoryLive),
      Layer.provide(SqlitePersistenceLayerLive),
    );
  }),
);
