import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_analytics_privacy (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      cleared_through_sequence INTEGER NOT NULL,
      cleared_at TEXT NOT NULL
    )
  `;
});
