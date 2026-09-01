import type { ContinuationPacket } from "./continuationPacket.ts";

export type ReviewGateStatus = "ready" | "needs-attention" | "incomplete" | "not-applicable";

export type ReviewGateCheck = {
  readonly id: "changes" | "verification" | "recovery" | "research";
  readonly status: "passed" | "needs-attention" | "not-run" | "not-applicable";
  readonly label: string;
};

export type ReviewGate = {
  readonly status: ReviewGateStatus;
  readonly title: string;
  readonly checks: ReadonlyArray<ReviewGateCheck>;
};

/**
 * Produces a review state from durable, explicit evidence. It intentionally
 * never treats an assistant's prose, a completed turn, or a checkpoint as a
 * successful test run.
 */
export function deriveReviewGate(input: {
  readonly packet: ContinuationPacket;
  readonly quotaExhausted: boolean;
  readonly compactionNeedsCheckpoint: boolean;
  readonly threadError: boolean;
}): ReviewGate {
  const hasChanges = input.packet.changed.length > 0;
  const hasFailedVerification = input.packet.verificationReceipts.some(
    (receipt) => receipt.outcome === "failed",
  );
  const hasPassedVerification = input.packet.verificationReceipts.some(
    (receipt) => receipt.outcome === "passed",
  );
  const recoveryNeedsAttention =
    input.quotaExhausted || input.compactionNeedsCheckpoint || input.threadError;
  const checks: ReviewGateCheck[] = [
    {
      id: "changes",
      status: hasChanges ? "passed" : "not-applicable",
      label: hasChanges
        ? `${input.packet.changed.length} checkpointed file${input.packet.changed.length === 1 ? "" : "s"} ready to inspect`
        : "No checkpointed file changes were observed",
    },
    {
      id: "verification",
      status: hasFailedVerification
        ? "needs-attention"
        : hasPassedVerification
          ? "passed"
          : hasChanges
            ? "not-run"
            : "not-applicable",
      label: hasFailedVerification
        ? "A recorded verification command failed"
        : hasPassedVerification
          ? "At least one command reported exit code 0"
          : hasChanges
            ? "No explicit verification receipt was observed"
            : "No verification receipt applies yet",
    },
    {
      id: "recovery",
      status: recoveryNeedsAttention ? "needs-attention" : "passed",
      label: input.quotaExhausted
        ? "The selected provider reported a rate limit"
        : input.compactionNeedsCheckpoint
          ? "Context compacted without a later checkpoint"
          : input.threadError
            ? "The latest provider turn ended with an error"
            : "No provider recovery issue was observed",
    },
    {
      id: "research",
      status: input.packet.research.length > 0 ? "needs-attention" : "not-applicable",
      label:
        input.packet.research.length > 0
          ? `${input.packet.research.length} provider research source${input.packet.research.length === 1 ? "" : "s"} to review`
          : "No provider research source was used",
    },
  ];
  const status: ReviewGateStatus =
    recoveryNeedsAttention || hasFailedVerification
      ? "needs-attention"
      : hasChanges && !hasPassedVerification
        ? "incomplete"
        : hasChanges
          ? "ready"
          : "not-applicable";
  const title =
    status === "ready"
      ? "Ready for review"
      : status === "needs-attention"
        ? "Review needs attention"
        : status === "incomplete"
          ? "Verification still needed"
          : "No review evidence yet";
  return { status, title, checks };
}
