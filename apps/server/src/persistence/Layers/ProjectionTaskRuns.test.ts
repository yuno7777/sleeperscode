import {
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type RouterDecision,
  type TaskProfile,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionTaskRunRepository } from "../Services/ProjectionTaskRuns.ts";
import { ProjectionTaskRunRepositoryLive } from "./ProjectionTaskRuns.ts";

const layer = it.layer(
  ProjectionTaskRunRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const taskProfile: TaskProfile = {
  version: 1,
  kinds: ["implementation"],
  complexity: { score: 40, band: "medium" },
  domains: { frontend: 0, backend: 70, systems: 20, research: 0 },
  visualRequirement: "none",
  reasoningRequirement: "medium",
  repoContextRequirement: "medium",
  expectedFiles: "few",
  expectedDuration: "medium",
  parallelizable: false,
  testingRequirement: "focused",
  securitySensitivity: "normal",
  toolRequirements: ["filesystem", "shell"],
  collaboration: "single-worker",
  signals: ["implementation-request"],
};

const routerDecision: RouterDecision = {
  version: 1,
  mode: "shadow",
  applied: false,
  effectiveSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6-sol",
  },
  selectionSource: "thread",
  selectedEligibility: "eligible",
  recommendation: {
    outcome: "retain-current",
    instanceId: ProviderInstanceId.make("codex"),
  },
  candidates: [
    {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      eligible: true,
      blockers: [],
    },
  ],
  execution: {
    tools: ["filesystem", "shell"],
    collaboration: "single-worker",
    review: "none",
    research: false,
  },
  reasons: [
    "thread-selection-authoritative",
    "selected-provider-eligible",
    "shadow-mode-no-override",
  ],
};

layer("ProjectionTaskRunRepository", (it) => {
  it.effect("round-trips evidence and supports more than one task on a provider turn", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionTaskRunRepository;
      const threadId = ThreadId.make("thread-task-run-repository");
      const turnId = TurnId.make("turn-shared");
      const firstAt = "2026-08-12T12:00:00.000Z";
      const secondAt = "2026-08-12T12:00:30.000Z";
      const observedAt = "2026-08-12T12:01:00.000Z";

      yield* repository.replacePending({
        threadId,
        messageId: MessageId.make("message-task-run-first"),
        taskProfile,
        routerDecision,
        requestedAt: firstAt,
      });
      yield* repository.bindPendingTurn({ threadId, turnId });
      yield* repository.replacePending({
        threadId,
        messageId: MessageId.make("message-task-run-second"),
        taskProfile,
        routerDecision,
        requestedAt: secondAt,
      });
      yield* repository.bindPendingTurn({ threadId, turnId });
      yield* repository.recordOutcome({
        threadId,
        turnId,
        outcome: {
          version: 1,
          terminalState: "completed",
          provider: {
            driver: ProviderDriverKind.make("codex"),
            instanceId: ProviderInstanceId.make("codex"),
          },
          observedAt,
        },
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((row) => row.messageId),
        ["message-task-run-first", "message-task-run-second"],
      );
      for (const row of rows) {
        assert.equal(row.turnId, turnId);
        assert.equal(row.taskProfile?.complexity.band, "medium");
        assert.equal(row.routerDecision?.applied, false);
        assert.equal(row.outcome?.terminalState, "completed");
        assert.equal(row.observedAt, observedAt);
      }

      const latest = yield* repository.listWindow({
        since: "2026-08-12T00:00:00.000Z",
        until: "2026-08-13T00:00:00.000Z",
        limit: 1,
      });
      assert.equal(latest.length, 1);
      assert.equal(latest[0]?.messageId, "message-task-run-second");
    }),
  );
});
