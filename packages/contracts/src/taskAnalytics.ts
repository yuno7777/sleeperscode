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

/**
 * Direct, user-supplied quality evidence for one task run.
 *
 * This intentionally stays coarse and content-free. It is neither inferred
 * from provider lifecycle state nor treated as proof that a task was correct.
 */
export const TaskFeedbackValue = Schema.Literals(["accepted", "needs-repair", "rejected"]);
export type TaskFeedbackValue = typeof TaskFeedbackValue.Type;

export const TaskFeedbackObservation = Schema.Struct({
  version: Schema.Literal(1),
  value: TaskFeedbackValue,
  observedAt: IsoDateTime,
});
export type TaskFeedbackObservation = typeof TaskFeedbackObservation.Type;

export const TaskAnalyticsRecord = Schema.Struct({
  threadId: ThreadId,
  requestedAt: IsoDateTime,
  /** Request-to-terminal elapsed time. Absent for pending rows and older servers. */
  elapsedMs: Schema.optionalKey(NonNegativeInt),
  /** Absent when an older server does not support explicit task feedback. */
  feedback: Schema.optionalKey(Schema.NullOr(TaskFeedbackObservation)),
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

export const TaskAnalyticsClearInput = Schema.Struct({});
export type TaskAnalyticsClearInput = typeof TaskAnalyticsClearInput.Type;

export const TaskAnalyticsClearResult = Schema.Struct({
  deletedRecords: NonNegativeInt,
});
export type TaskAnalyticsClearResult = typeof TaskAnalyticsClearResult.Type;

export const TaskAnalyticsFeedbackInput = Schema.Struct({
  threadId: ThreadId,
  requestedAt: IsoDateTime,
  /** `null` removes an earlier observation. */
  feedback: Schema.NullOr(TaskFeedbackValue),
});
export type TaskAnalyticsFeedbackInput = typeof TaskAnalyticsFeedbackInput.Type;

export const TaskAnalyticsFeedbackResult = Schema.Struct({
  feedback: Schema.NullOr(TaskFeedbackObservation),
});
export type TaskAnalyticsFeedbackResult = typeof TaskAnalyticsFeedbackResult.Type;

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

export class TaskAnalyticsMutationError extends Schema.TaggedErrorClass<TaskAnalyticsMutationError>()(
  "TaskAnalyticsMutationError",
  {
    reason: Schema.Literals(["clearFailed", "feedbackFailed", "taskNotFound"]),
    detail: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Task analytics mutation failed (${this.reason}): ${this.detail}`;
  }
}
