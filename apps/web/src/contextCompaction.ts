import type { OrchestrationThreadActivity, ProjectContextCheckpoint } from "@t3tools/contracts";

export type ContextCompactionRecovery = {
  readonly compactedAt: string;
  readonly checkpointedAfterCompaction: boolean;
};

/**
 * A checkpoint is the only recovery evidence shown here. A context-meter
 * percentage or an automatic-compaction capability never proves a resumable
 * repository state on its own.
 */
export function deriveContextCompactionRecovery(input: {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly checkpoints: ReadonlyArray<ProjectContextCheckpoint>;
  readonly threadId: string | null | undefined;
}): ContextCompactionRecovery | null {
  const latestCompaction = [...input.activities]
    .reverse()
    .find((activity) => activity.kind === "context-compaction");
  if (!latestCompaction) return null;
  const checkpointedAfterCompaction = input.checkpoints.some(
    (checkpoint) =>
      (input.threadId === null ||
        input.threadId === undefined ||
        checkpoint.threadId === input.threadId) &&
      checkpoint.completedAt >= latestCompaction.createdAt,
  );
  return { compactedAt: latestCompaction.createdAt, checkpointedAfterCompaction };
}
