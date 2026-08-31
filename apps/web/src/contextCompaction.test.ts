import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity, ProjectContextCheckpoint } from "@t3tools/contracts";
import { deriveContextCompactionRecovery } from "./contextCompaction.ts";

const activity: OrchestrationThreadActivity = {
  id: "compaction" as never,
  tone: "info",
  kind: "context-compaction",
  summary: "Context compacted",
  payload: {},
  turnId: null,
  createdAt: "2026-08-31T10:00:00.000Z",
};

const checkpoint: ProjectContextCheckpoint = {
  threadId: "thread-1" as never,
  turnCount: 2,
  fileCount: 1,
  completedAt: "2026-08-31T10:01:00.000Z",
};

describe("deriveContextCompactionRecovery", () => {
  it("requires a later checkpoint on the same thread", () => {
    expect(
      deriveContextCompactionRecovery({
        activities: [activity],
        checkpoints: [checkpoint],
        threadId: "thread-1",
      }),
    ).toEqual({ compactedAt: activity.createdAt, checkpointedAfterCompaction: true });
    expect(
      deriveContextCompactionRecovery({
        activities: [activity],
        checkpoints: [{ ...checkpoint, threadId: "thread-2" as never }],
        threadId: "thread-1",
      }),
    ).toEqual({ compactedAt: activity.createdAt, checkpointedAfterCompaction: false });
  });
});
