import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";
import { classifyAttentionThread } from "./attention.ts";

function thread(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    id: "thread-1" as never,
    environmentId: "environment-1" as never,
    projectId: "project-1" as never,
    title: "Test thread",
    modelSelection: { instanceId: "codex" as never, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    session: null,
    ...overrides,
  } as EnvironmentThreadShell;
}

describe("classifyAttentionThread", () => {
  it("prioritizes work that needs the user", () => {
    expect(classifyAttentionThread(thread({ hasPendingApprovals: true }), false)?.kind).toBe(
      "approval",
    );
    expect(classifyAttentionThread(thread({ hasPendingUserInput: true }), false)?.kind).toBe(
      "input",
    );
    expect(
      classifyAttentionThread(thread({ latestTurn: { state: "error" } as never }), false)?.kind,
    ).toBe("failed");
    expect(classifyAttentionThread(thread({ hasActionableProposedPlan: true }), false)?.kind).toBe(
      "plan",
    );
  });

  it("requires a handoff verification record after completion", () => {
    const completed = thread({ latestTurn: { state: "completed" } as never });
    expect(classifyAttentionThread(completed, false)?.kind).toBe("verification");
    expect(classifyAttentionThread(completed, true)).toBeNull();
  });
});
