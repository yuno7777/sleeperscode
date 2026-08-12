import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskProfile,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-08-09T00:00:00.000Z";
const encodeProfileJson = Schema.encodeSync(Schema.fromJsonString(TaskProfile));

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: ThreadId.make("thread-profile"),
      projectId: ProjectId.make("project-profile"),
      title: "Profile test",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
  updatedAt: NOW,
};

it.layer(NodeServices.layer)("turn task profiling", (it) => {
  it.effect("persists explainable metadata without copying prompt content", () =>
    Effect.gen(function* () {
      const privateMarker = "PRIVATE_MARKER_d9b887a8";
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-profile"),
          threadId: ThreadId.make("thread-profile"),
          message: {
            messageId: MessageId.make("message-profile"),
            role: "user",
            text: `Implement and test the React authentication UI. ${privateMarker}`,
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          repositoryEvidence: {
            version: 1,
            source: "root-markers",
            markers: ["package-json", "tsconfig-json"],
            languages: ["typescript"],
            frameworks: ["react"],
            testRunners: ["vitest"],
            workspace: "single-package",
            limited: false,
          },
          routerContext: {
            version: 1,
            candidates: [
              {
                instanceId: ProviderInstanceId.make("codex"),
                driver: ProviderDriverKind.make("codex"),
                eligible: true,
                blockers: [],
              },
              {
                instanceId: ProviderInstanceId.make("claudeAgent"),
                driver: ProviderDriverKind.make("claudeAgent"),
                eligible: false,
                blockers: ["unauthenticated"],
              },
            ],
            limited: false,
          },
          createdAt: NOW,
        },
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];
      const turnStart = events.find((event) => event.type === "thread.turn-start-requested");

      expect(turnStart?.type).toBe("thread.turn-start-requested");
      if (turnStart?.type !== "thread.turn-start-requested") return;
      const taskProfile = turnStart.payload.taskProfile;
      expect(taskProfile).toBeDefined();
      if (taskProfile === undefined) return;
      expect(taskProfile).toMatchObject({
        version: 1,
        visualRequirement: "possible",
        testingRequirement: "focused",
        securitySensitivity: "high",
        collaboration: "single-worker",
        repositoryEvidence: {
          frameworks: ["react"],
          testRunners: ["vitest"],
        },
      });
      expect(taskProfile.kinds).toEqual(expect.arrayContaining(["implementation", "design"]));
      expect(taskProfile.signals).toEqual(
        expect.arrayContaining([
          "implementation-request",
          "frontend-domain",
          "security-sensitive",
          "testing-request",
          "repository-evidence",
          "test-capability-detected",
        ]),
      );
      expect(encodeProfileJson(taskProfile)).not.toContain(privateMarker);
      expect(turnStart.payload.routerDecision).toMatchObject({
        version: 1,
        mode: "shadow",
        applied: false,
        effectiveSelection: { instanceId: "codex", model: "gpt-5.4" },
        selectionSource: "thread",
        selectedEligibility: "eligible",
        recommendation: { outcome: "retain-current", instanceId: "codex" },
        execution: { review: "required", research: false },
      });
    }),
  );

  it.effect("records a typed terminal observation without inferring success", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.outcome.record",
          commandId: CommandId.make("cmd-outcome"),
          threadId: ThreadId.make("thread-profile"),
          turnId: TurnId.make("turn-profile"),
          outcome: {
            version: 1,
            terminalState: "completed",
            provider: {
              driver: ProviderDriverKind.make("codex"),
              instanceId: ProviderInstanceId.make("codex"),
            },
            observedAt: NOW,
          },
          createdAt: NOW,
        },
        readModel,
      });

      expect(result).toMatchObject({
        type: "thread.turn-outcome-recorded",
        payload: {
          threadId: "thread-profile",
          turnId: "turn-profile",
          outcome: {
            version: 1,
            terminalState: "completed",
            provider: { driver: "codex", instanceId: "codex" },
            observedAt: NOW,
          },
        },
      });
      expect(result).not.toHaveProperty("payload.outcome.success");
    }),
  );
});
