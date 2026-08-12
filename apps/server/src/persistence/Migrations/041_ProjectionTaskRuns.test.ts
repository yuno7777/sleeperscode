import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_ProjectionTaskRuns", (it) => {
  it.effect("creates the privacy-bounded task run projection", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* runMigrations({ toMigrationInclusive: 41 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_task_runs)
      `;
      assert.deepEqual(
        columns.map((column) => column.name),
        [
          "row_id",
          "thread_id",
          "turn_id",
          "message_id",
          "task_profile_json",
          "router_decision_json",
          "outcome_json",
          "requested_at",
          "observed_at",
        ],
      );
    }),
  );
});
