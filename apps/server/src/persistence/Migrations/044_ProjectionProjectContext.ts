import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const columns = [
  [
    "shared_provider_configuration_json",
    '{"rulePaths":[],"mcpServerNames":[],"mcpProfileName":null,"mcpToolCallBudget":null,"recommendedRuntimeMode":null,"recommendedInteractionMode":null}',
  ],
  ["handoffs_json", "[]"],
  ["knowledge_notes_json", "[]"],
] as const;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const existing = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`;
  for (const [name, defaultValue] of columns) {
    if (existing.some((column) => column.name === name)) continue;
    yield* sql.unsafe(
      `ALTER TABLE projection_projects ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${defaultValue}'`,
    );
  }
});
