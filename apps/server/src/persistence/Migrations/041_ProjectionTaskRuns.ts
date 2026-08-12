import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_task_runs (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      message_id TEXT NOT NULL,
      task_profile_json TEXT,
      router_decision_json TEXT,
      outcome_json TEXT,
      requested_at TEXT NOT NULL,
      observed_at TEXT
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_task_runs_pending_thread
    ON projection_task_runs(thread_id)
    WHERE turn_id IS NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_task_runs_turn
    ON projection_task_runs(thread_id, turn_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_task_runs_observed
    ON projection_task_runs(observed_at, thread_id, turn_id)
  `;
});
