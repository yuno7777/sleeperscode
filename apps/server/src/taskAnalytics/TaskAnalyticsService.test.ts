import {
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  UsageDay,
  type RouterDecision,
  type TaskProfile,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ProjectionTaskRunRepository,
  type ProjectionTaskRun,
} from "../persistence/Services/ProjectionTaskRuns.ts";
import {
  primaryDomainFromProfile,
  TaskAnalyticsService,
  layerTest,
} from "./TaskAnalyticsService.ts";

const taskProfile: TaskProfile = {
  version: 1,
  kinds: ["implementation"],
  complexity: { score: 72, band: "high" },
  domains: { frontend: 50, backend: 80, systems: 80, research: 0 },
  visualRequirement: "none",
  reasoningRequirement: "high",
  repoContextRequirement: "high",
  expectedFiles: "many",
  expectedDuration: "large",
  parallelizable: false,
  testingRequirement: "focused",
  securitySensitivity: "elevated",
  toolRequirements: ["filesystem", "shell", "git"],
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
  recommendation: { outcome: "insufficient-evidence" },
  candidates: [
    {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      eligible: true,
      blockers: [],
    },
    {
      instanceId: ProviderInstanceId.make("claude"),
      driver: ProviderDriverKind.make("claude"),
      eligible: false,
      blockers: ["unauthenticated"],
    },
  ],
  execution: {
    tools: ["filesystem", "shell", "git"],
    collaboration: "single-worker",
    review: "recommended",
    research: false,
  },
  reasons: ["multiple-eligible-candidates", "context-limited", "shadow-mode-no-override"],
};

const row: ProjectionTaskRun = {
  threadId: ThreadId.make("thread-task-analytics"),
  turnId: TurnId.make("turn-task-analytics"),
  messageId: MessageId.make("message-task-analytics"),
  taskProfile,
  routerDecision,
  outcome: {
    version: 1,
    terminalState: "completed",
    provider: {
      driver: ProviderDriverKind.make("codex"),
      instanceId: ProviderInstanceId.make("codex"),
    },
    observedAt: "2026-03-08T06:30:00.000Z",
  },
  requestedAt: "2026-03-08T06:00:00.000Z",
  observedAt: "2026-03-08T06:30:00.000Z",
};

it.effect("TaskAnalyticsService returns bounded factual evidence with zoned window bounds", () => {
  let observedInput: { since: string; until: string; limit: number } | null = null;
  const repository = Layer.succeed(
    ProjectionTaskRunRepository,
    ProjectionTaskRunRepository.of({
      replacePending: () => Effect.void,
      bindPendingTurn: () => Effect.void,
      recordOutcome: () => Effect.void,
      listByThreadId: () => Effect.succeed([]),
      listWindow: (input) =>
        Effect.sync(() => {
          observedInput = input;
          return [row];
        }),
      clearHistory: () => Effect.succeed({ deletedRecords: 4, clearedThroughSequence: 12 }),
      shouldProjectSequence: () => Effect.succeed(true),
    }),
  );

  const testLayer = layerTest("test-source").pipe(Layer.provide(repository));
  return Effect.gen(function* () {
    const service = yield* TaskAnalyticsService;
    const summary = yield* service.readSummary({
      sinceDay: UsageDay.make("2026-03-08"),
      untilDay: UsageDay.make("2026-03-08"),
      timeZone: "America/New_York",
    });

    assert.deepEqual(observedInput, {
      since: "2026-03-08T05:00:00.000Z",
      until: "2026-03-09T04:00:00.000Z",
      limit: 201,
    });
    assert.equal(summary.sourceFingerprint, "test-source");
    assert.equal(summary.truncated, false);
    assert.equal(summary.records.length, 1);
    const record = summary.records[0];
    assert.equal(record?.profile?.primaryDomain, "mixed");
    assert.equal(record?.route?.applied, false);
    assert.equal(record?.route?.selectedDriver, "codex");
    assert.equal(record?.route?.candidateCount, 2);
    assert.equal(record?.route?.eligibleCandidateCount, 1);
    assert.equal(record?.route?.contextLimited, true);
    assert.equal(record?.outcome?.terminalState, "completed");
    assert.notProperty(record ?? {}, "messageId");
    assert.notProperty(record ?? {}, "prompt");
    assert.notProperty(record ?? {}, "quality");
    assert.deepEqual(yield* service.clearHistory, { deletedRecords: 4 });
  }).pipe(Effect.provide(testLayer));
});

it("primaryDomainFromProfile handles empty and single-domain evidence", () => {
  assert.equal(
    primaryDomainFromProfile({
      ...taskProfile,
      domains: { frontend: 0, backend: 0, systems: 0, research: 0 },
    }),
    "general",
  );
  assert.equal(
    primaryDomainFromProfile({
      ...taskProfile,
      domains: { frontend: 90, backend: 10, systems: 0, research: 0 },
    }),
    "frontend",
  );
});
