import {
  ProjectId,
  ThreadId,
  type OrchestrationProject,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import {
  buildProjectContextSnapshot,
  classifyProjectContextDocuments,
} from "./buildProjectContext.ts";

const project: OrchestrationProject = {
  id: ProjectId.make("project-context"),
  title: "Context project",
  workspaceRoot: "/workspace/context",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  faviconPath: null,
  scripts: [],
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
  deletedAt: null,
};

function thread(
  input: Partial<OrchestrationThread> & Pick<OrchestrationThread, "id" | "title">,
): OrchestrationThread {
  const { id, title, ...overrides } = input;
  return {
    id,
    projectId: project.id,
    title,
    modelSelection: { instanceId: "codex" as never, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

describe("classifyProjectContextDocuments", () => {
  it("keeps only known local guides and rules in a stable order", () => {
    assert.deepEqual(
      classifyProjectContextDocuments([
        "docs/architecture.md",
        "README.md",
        "AGENTS.md",
        "notes/private.txt",
        ".github/instructions/review.md",
        "README.md",
      ]),
      [
        { path: ".github/instructions/review.md", kind: "rule" },
        { path: "AGENTS.md", kind: "rule" },
        { path: "docs/architecture.md", kind: "guide" },
        { path: "README.md", kind: "guide" },
      ],
    );
  });
});

describe("buildProjectContextSnapshot", () => {
  it("shows local sources, recent checkpoints, and same-worktree conflicts", () => {
    const current = thread({
      id: ThreadId.make("current"),
      title: "Current work",
      branch: "feature/context",
      worktreePath: "/workspace/context-worktree",
    });
    const related = thread({
      id: ThreadId.make("related"),
      title: "Related work",
      worktreePath: "/workspace/context-worktree",
      updatedAt: "2026-08-31T01:00:00.000Z",
      checkpoints: [
        {
          turnId: "turn-1" as never,
          checkpointTurnCount: 2,
          checkpointRef: "refs/t3/checkpoints/2" as never,
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: "2026-08-31T01:00:00.000Z",
        },
      ],
    });
    const snapshot = buildProjectContextSnapshot({
      project,
      currentThread: current,
      threads: [current, related],
      workspacePaths: ["README.md", "AGENTS.md"],
      repositoryEvidence: null,
      generatedAt: "2026-08-31T02:00:00.000Z",
    });

    assert.equal(snapshot.currentBranch, "feature/context");
    assert.deepEqual(snapshot.rules, [{ path: "AGENTS.md", kind: "rule" }]);
    assert.deepEqual(snapshot.documents, [{ path: "README.md", kind: "guide" }]);
    assert.equal(snapshot.relatedThreads[0]?.sharesWorktreeWithCurrentThread, true);
    assert.equal(snapshot.recentCheckpoints[0]?.turnCount, 2);
  });
});
