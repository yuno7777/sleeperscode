import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  CommandId,
  type ClientOrchestrationCommand,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import {
  canonicalizeClientCommandTimestamps,
  readRouterContext,
  resolveTurnRepositoryRoot,
} from "./Normalizer.ts";

const clientCreatedAt = "2031-01-01T00:00:00.000Z";
const serverReceivedAt = "2026-07-18T00:00:00.000Z";

describe("canonicalizeClientCommandTimestamps", () => {
  it("replaces a client command timestamp with the server receipt timestamp", () => {
    const command: ClientOrchestrationCommand = {
      type: "project.create",
      commandId: CommandId.make("command-1"),
      projectId: ProjectId.make("project-1"),
      title: "Clock-safe project",
      workspaceRoot: "/tmp/clock-safe-project",
      createdAt: clientCreatedAt,
    };

    expect(canonicalizeClientCommandTimestamps(command, serverReceivedAt)).toEqual({
      ...command,
      createdAt: serverReceivedAt,
    });
  });

  it("replaces both timestamps when the first turn bootstraps a thread", () => {
    const command: ClientOrchestrationCommand = {
      type: "thread.turn.start",
      commandId: CommandId.make("command-2"),
      threadId: ThreadId.make("thread-1"),
      message: {
        messageId: MessageId.make("message-1"),
        role: "user",
        text: "Start a thread",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      bootstrap: {
        createThread: {
          projectId: ProjectId.make("project-1"),
          title: "Clock-safe thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: clientCreatedAt,
        },
      },
      createdAt: clientCreatedAt,
    };

    const result = canonicalizeClientCommandTimestamps(command, serverReceivedAt);

    expect(result.type).toBe("thread.turn.start");
    if (result.type !== "thread.turn.start") {
      throw new Error("Expected a thread.turn.start command");
    }
    expect(result.createdAt).toBe(serverReceivedAt);
    expect(result.bootstrap?.createThread?.createdAt).toBe(serverReceivedAt);
  });
});

describe("resolveTurnRepositoryRoot", () => {
  const command: Extract<ClientOrchestrationCommand, { type: "thread.turn.start" }> = {
    type: "thread.turn.start",
    commandId: CommandId.make("command-root"),
    threadId: ThreadId.make("thread-root"),
    message: {
      messageId: MessageId.make("message-root"),
      role: "user",
      text: "Implement the change",
      attachments: [],
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: clientCreatedAt,
  };

  it("prefers the existing thread worktree", async () => {
    const root = await Effect.runPromise(
      resolveTurnRepositoryRoot(command, {
        getThreadShellById: () =>
          Effect.succeed(
            Option.some({
              projectId: ProjectId.make("project-root"),
              worktreePath: "C:\\repo\\worktree",
            } as OrchestrationThreadShell),
          ),
        getProjectShellById: () => Effect.die("project query should not run"),
      }),
    );

    expect(root).toBe("C:\\repo\\worktree");
  });

  it("falls back to the existing thread project root", async () => {
    const root = await Effect.runPromise(
      resolveTurnRepositoryRoot(command, {
        getThreadShellById: () =>
          Effect.succeed(
            Option.some({
              projectId: ProjectId.make("project-root"),
              worktreePath: null,
            } as OrchestrationThreadShell),
          ),
        getProjectShellById: () =>
          Effect.succeed(
            Option.some({ workspaceRoot: "C:\\repo\\project" } as OrchestrationProjectShell),
          ),
      }),
    );

    expect(root).toBe("C:\\repo\\project");
  });
});

describe("readRouterContext", () => {
  it("degrades provider snapshot failures to limited empty context", async () => {
    const context = await Effect.runPromise(
      readRouterContext({ getProviders: Effect.die("provider snapshot unavailable") }),
    );

    expect(context).toEqual({ version: 1, candidates: [], limited: true });
  });
});
