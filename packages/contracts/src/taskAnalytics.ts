/**
 * Privacy-bounded task and shadow-router analytics.
 *
 * The server returns compact, content-free records. Prompt text, repository
 * paths, provider errors, diffs, and inferred quality never cross this API.
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ThreadId } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  RouterCandidateEligibility,
  RouterDecisionReason,
  RouterRecommendationOutcome,
  RouterSelectionSource,
} from "./router.ts";
import {
  TaskComplexityBand,
  TaskKind,
  TaskSecuritySensitivity,
  TaskTestingRequirement,
} from "./taskProfile.ts";
import { TaskOutcomeObservation } from "./taskOutcome.ts";
import { UsageDay } from "./usage.ts";

export const TASK_ANALYTICS_CONTRACT_VERSION = 1 as const;
export const TASK_ANALYTICS_MAX_RECORDS = 200 as const;

export const TaskAnalyticsPrimaryDomain = Schema.Literals([
  "general",
  "frontend",
  "backend",
  "systems",
  "research",
  "mixed",
]);
export type TaskAnalyticsPrimaryDomain = typeof TaskAnalyticsPrimaryDomain.Type;

export const TaskAnalyticsProfile = Schema.Struct({
  kinds: Schema.Array(TaskKind),
  complexity: TaskComplexityBand,
  primaryDomain: TaskAnalyticsPrimaryDomain,
  testingRequirement: TaskTestingRequirement,
  securitySensitivity: TaskSecuritySensitivity,
});
export type TaskAnalyticsProfile = typeof TaskAnalyticsProfile.Type;

export const TaskAnalyticsRoute = Schema.Struct({
  mode: Schema.Literal("shadow"),
  applied: Schema.Literal(false),
  selectedInstanceId: ProviderInstanceId,
  selectedDriver: Schema.NullOr(ProviderDriverKind),
  model: Schema.String.check(Schema.isMaxLength(256)),
  selectionSource: RouterSelectionSource,
  selectedEligibility: RouterCandidateEligibility,
  recommendation: RouterRecommendationOutcome,
  candidateCount: NonNegativeInt,
  eligibleCandidateCount: NonNegativeInt,
  contextLimited: Schema.Boolean,
  reasons: Schema.Array(RouterDecisionReason),
});
export type TaskAnalyticsRoute = typeof TaskAnalyticsRoute.Type;

export const TaskAnalyticsRecord = Schema.Struct({
  threadId: ThreadId,
  requestedAt: IsoDateTime,
  profile: Schema.NullOr(TaskAnalyticsProfile),
  route: Schema.NullOr(TaskAnalyticsRoute),
  outcome: Schema.NullOr(TaskOutcomeObservation),
});
export type TaskAnalyticsRecord = typeof TaskAnalyticsRecord.Type;

export const TaskAnalyticsSummaryInput = Schema.Struct({
  sinceDay: UsageDay,
  untilDay: UsageDay,
  timeZone: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
});
export type TaskAnalyticsSummaryInput = typeof TaskAnalyticsSummaryInput.Type;

export const TaskAnalyticsSummary = Schema.Struct({
  contractVersion: Schema.Number,
  readAt: IsoDateTime,
  sourceFingerprint: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
  timeZone: Schema.String,
  sinceDay: UsageDay,
  untilDay: UsageDay,
  records: Schema.Array(TaskAnalyticsRecord).check(Schema.isMaxLength(TASK_ANALYTICS_MAX_RECORDS)),
  truncated: Schema.Boolean,
});
export type TaskAnalyticsSummary = typeof TaskAnalyticsSummary.Type;

export class TaskAnalyticsReadError extends Schema.TaggedErrorClass<TaskAnalyticsReadError>()(
  "TaskAnalyticsReadError",
  {
    reason: Schema.Literals(["invalidWindow", "readFailed"]),
    detail: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Task analytics read failed (${this.reason}): ${this.detail}`;
  }
}
