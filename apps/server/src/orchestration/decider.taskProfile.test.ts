import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  TaskProfile,
  ThreadId,
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
      });
      expect(taskProfile.kinds).toEqual(expect.arrayContaining(["implementation", "design"]));
      expect(taskProfile.signals).toEqual(
        expect.arrayContaining([
          "implementation-request",
          "frontend-domain",
          "security-sensitive",
          "testing-request",
        ]),
      );
      expect(encodeProfileJson(taskProfile)).not.toContain(privateMarker);
    }),
  );
});
