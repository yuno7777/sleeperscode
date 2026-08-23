/**
 * ProjectionTaskRunRepository - Durable, content-free task attribution rows.
 *
 * A pending row captures the server-owned task profile and shadow router
 * decision. The provider lifecycle later binds it to a concrete turn and
 * records only the factual terminal observation.
 */
import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  RouterDecision,
  TaskFeedbackObservation,
  TaskOutcomeObservation,
  TaskProfile,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionTaskRun = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  messageId: MessageId,
  taskProfile: Schema.NullOr(TaskProfile),
  routerDecision: Schema.NullOr(RouterDecision),
  outcome: Schema.NullOr(TaskOutcomeObservation),
  feedback: Schema.NullOr(TaskFeedbackObservation),
  requestedAt: IsoDateTime,
  observedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionTaskRun = typeof ProjectionTaskRun.Type;

export const ProjectionPendingTaskRun = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  taskProfile: Schema.NullOr(TaskProfile),
  routerDecision: Schema.NullOr(RouterDecision),
  requestedAt: IsoDateTime,
});
export type ProjectionPendingTaskRun = typeof ProjectionPendingTaskRun.Type;

export const BindProjectionTaskRunInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
});
export type BindProjectionTaskRunInput = typeof BindProjectionTaskRunInput.Type;

export const RecordProjectionTaskOutcomeInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  outcome: TaskOutcomeObservation,
});
export type RecordProjectionTaskOutcomeInput = typeof RecordProjectionTaskOutcomeInput.Type;

export const SetProjectionTaskFeedbackInput = Schema.Struct({
  threadId: ThreadId,
  requestedAt: IsoDateTime,
  feedback: Schema.NullOr(TaskFeedbackObservation),
});
export type SetProjectionTaskFeedbackInput = typeof SetProjectionTaskFeedbackInput.Type;

export const ListProjectionTaskRunsInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionTaskRunsInput = typeof ListProjectionTaskRunsInput.Type;

export const ListProjectionTaskRunsWindowInput = Schema.Struct({
  since: IsoDateTime,
  until: IsoDateTime,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 })),
});
export type ListProjectionTaskRunsWindowInput = typeof ListProjectionTaskRunsWindowInput.Type;

export const ProjectionTaskRunSequenceInput = Schema.Struct({
  sequence: NonNegativeInt,
});
export type ProjectionTaskRunSequenceInput = typeof ProjectionTaskRunSequenceInput.Type;

export interface ClearProjectionTaskRunsResult {
  readonly deletedRecords: number;
  readonly clearedThroughSequence: number;
}

export interface ProjectionTaskRunRepositoryShape {
  readonly replacePending: (
    row: ProjectionPendingTaskRun,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly bindPendingTurn: (
    input: BindProjectionTaskRunInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly recordOutcome: (
    input: RecordProjectionTaskOutcomeInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  /** Returns false when the public task key does not resolve to exactly one row. */
  readonly setFeedback: (
    input: SetProjectionTaskFeedbackInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: ListProjectionTaskRunsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionTaskRun>, ProjectionRepositoryError>;
  readonly listWindow: (
    input: ListProjectionTaskRunsWindowInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionTaskRun>, ProjectionRepositoryError>;
  readonly clearHistory: () => Effect.Effect<
    ClearProjectionTaskRunsResult,
    ProjectionRepositoryError
  >;
  readonly shouldProjectSequence: (
    input: ProjectionTaskRunSequenceInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
}

export class ProjectionTaskRunRepository extends Context.Service<
  ProjectionTaskRunRepository,
  ProjectionTaskRunRepositoryShape
>()("t3/persistence/Services/ProjectionTaskRuns/ProjectionTaskRunRepository") {}
