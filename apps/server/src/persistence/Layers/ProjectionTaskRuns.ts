import { RouterDecision, TaskOutcomeObservation, TaskProfile } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  BindProjectionTaskRunInput,
  ListProjectionTaskRunsInput,
  ListProjectionTaskRunsWindowInput,
  ProjectionPendingTaskRun,
  ProjectionTaskRun,
  ProjectionTaskRunRepository,
  RecordProjectionTaskOutcomeInput,
  type ProjectionTaskRunRepositoryShape,
} from "../Services/ProjectionTaskRuns.ts";

const ProjectionTaskRunDbRow = ProjectionTaskRun.mapFields(
  Struct.assign({
    taskProfile: Schema.NullOr(Schema.fromJsonString(TaskProfile)),
    routerDecision: Schema.NullOr(Schema.fromJsonString(RouterDecision)),
    outcome: Schema.NullOr(Schema.fromJsonString(TaskOutcomeObservation)),
  }),
);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionTaskRunRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const deletePending = SqlSchema.void({
    Request: ListProjectionTaskRunsInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_task_runs
      WHERE thread_id = ${threadId} AND turn_id IS NULL
    `,
  });

  const insertPending = SqlSchema.void({
    Request: ProjectionPendingTaskRun,
    execute: (row) => sql`
      INSERT INTO projection_task_runs (
        thread_id,
        turn_id,
        message_id,
        task_profile_json,
        router_decision_json,
        outcome_json,
        requested_at,
        observed_at
      ) VALUES (
        ${row.threadId},
        NULL,
        ${row.messageId},
        ${row.taskProfile === null ? null : JSON.stringify(row.taskProfile)},
        ${row.routerDecision === null ? null : JSON.stringify(row.routerDecision)},
        NULL,
        ${row.requestedAt},
        NULL
      )
    `,
  });

  const bindPending = SqlSchema.void({
    Request: BindProjectionTaskRunInput,
    execute: ({ threadId, turnId }) => sql`
      UPDATE projection_task_runs
      SET turn_id = ${turnId}
      WHERE thread_id = ${threadId} AND turn_id IS NULL
    `,
  });

  const updateOutcome = SqlSchema.void({
    Request: RecordProjectionTaskOutcomeInput,
    execute: ({ threadId, turnId, outcome }) => sql`
      UPDATE projection_task_runs
      SET
        outcome_json = ${JSON.stringify(outcome)},
        observed_at = ${outcome.observedAt}
      WHERE thread_id = ${threadId} AND turn_id = ${turnId}
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: ListProjectionTaskRunsInput,
    Result: ProjectionTaskRunDbRow,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        turn_id AS "turnId",
        message_id AS "messageId",
        task_profile_json AS "taskProfile",
        router_decision_json AS "routerDecision",
        outcome_json AS "outcome",
        requested_at AS "requestedAt",
        observed_at AS "observedAt"
      FROM projection_task_runs
      WHERE thread_id = ${threadId}
      ORDER BY requested_at ASC, row_id ASC
    `,
  });

  const listWindowRows = SqlSchema.findAll({
    Request: ListProjectionTaskRunsWindowInput,
    Result: ProjectionTaskRunDbRow,
    execute: ({ since, until, limit }) => sql`
      SELECT
        thread_id AS "threadId",
        turn_id AS "turnId",
        message_id AS "messageId",
        task_profile_json AS "taskProfile",
        router_decision_json AS "routerDecision",
        outcome_json AS "outcome",
        requested_at AS "requestedAt",
        observed_at AS "observedAt"
      FROM projection_task_runs
      WHERE requested_at >= ${since} AND requested_at < ${until}
      ORDER BY requested_at DESC, row_id DESC
      LIMIT ${limit}
    `,
  });

  const replacePending: ProjectionTaskRunRepositoryShape["replacePending"] = (row) =>
    sql
      .withTransaction(
        deletePending({ threadId: row.threadId }).pipe(Effect.flatMap(() => insertPending(row))),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionTaskRunRepository.replacePending:query",
            "ProjectionTaskRunRepository.replacePending:encodeRequest",
          ),
        ),
      );

  const bindPendingTurn: ProjectionTaskRunRepositoryShape["bindPendingTurn"] = (input) =>
    bindPending(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRunRepository.bindPendingTurn:query")),
    );

  const recordOutcome: ProjectionTaskRunRepositoryShape["recordOutcome"] = (input) =>
    updateOutcome(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTaskRunRepository.recordOutcome:query")),
    );

  const listByThreadId: ProjectionTaskRunRepositoryShape["listByThreadId"] = (input) =>
    listRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionTaskRunRepository.listByThreadId:query",
          "ProjectionTaskRunRepository.listByThreadId:decodeRows",
        ),
      ),
      Effect.map((rows) => rows as ReadonlyArray<ProjectionTaskRun>),
    );

  const listWindow: ProjectionTaskRunRepositoryShape["listWindow"] = (input) =>
    listWindowRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionTaskRunRepository.listWindow:query",
          "ProjectionTaskRunRepository.listWindow:decodeRows",
        ),
      ),
      Effect.map((rows) => rows as ReadonlyArray<ProjectionTaskRun>),
    );

  return {
    replacePending,
    bindPendingTurn,
    recordOutcome,
    listByThreadId,
    listWindow,
  } satisfies ProjectionTaskRunRepositoryShape;
});

export const ProjectionTaskRunRepositoryLive = Layer.effect(
  ProjectionTaskRunRepository,
  makeProjectionTaskRunRepository,
);
