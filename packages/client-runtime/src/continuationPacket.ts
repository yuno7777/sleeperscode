import type {
  OrchestrationCheckpointSummary,
  OrchestrationThread,
  OrchestrationThreadActivity,
  ProjectHandoffSummary,
} from "@t3tools/contracts";

type RecordValue = Record<string, unknown>;

export type VerificationReceipt = {
  readonly label: string;
  readonly outcome: "passed" | "failed";
  readonly occurredAt: string;
};

export type ResearchEvidence = {
  readonly query: string | null;
  readonly url: string | null;
  readonly occurredAt: string;
};

export type ContinuationPacket = {
  readonly changed: ReadonlyArray<string>;
  readonly verification: ReadonlyArray<string>;
  readonly nextActions: ReadonlyArray<string>;
  readonly verificationReceipts: ReadonlyArray<VerificationReceipt>;
  readonly research: ReadonlyArray<ResearchEvidence>;
};

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function activityData(activity: OrchestrationThreadActivity): RecordValue | null {
  return asRecord(asRecord(activity.payload)?.data);
}

function activityItem(activity: OrchestrationThreadActivity): RecordValue | null {
  return asRecord(activityData(activity)?.item);
}

function itemType(activity: OrchestrationThreadActivity): string | null {
  return text(asRecord(activity.payload)?.itemType);
}

function unique(values: ReadonlyArray<string>, limit = 24): ReadonlyArray<string> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length === limit) break;
  }
  return result;
}

function extractExitCode(activity: OrchestrationThreadActivity): number | null {
  const data = activityData(activity);
  const item = activityItem(activity);
  const result = asRecord(data?.result) ?? asRecord(item?.result);
  return number(item?.exitCode) ?? number(data?.exitCode) ?? number(result?.exitCode);
}

function extractCommandLabel(activity: OrchestrationThreadActivity): string {
  const data = activityData(activity);
  const item = activityItem(activity);
  return (
    text(item?.command) ??
    text(data?.command) ??
    text(item?.name) ??
    text(data?.toolName) ??
    "Provider command"
  );
}

function extractResearch(activity: OrchestrationThreadActivity): ResearchEvidence | null {
  if (itemType(activity) !== "web_search") return null;
  const data = activityData(activity);
  const item = activityItem(activity);
  const action = asRecord(data?.action) ?? asRecord(item?.action);
  return {
    query: text(item?.query) ?? text(data?.query) ?? text(action?.query),
    url: text(item?.url) ?? text(data?.url) ?? text(action?.url),
    occurredAt: activity.createdAt,
  };
}

/**
 * Builds a reviewable packet from provider-reported evidence only. A completed
 * turn or prose mentioning tests can never create a passing receipt.
 */
export function deriveContinuationPacket(input: {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly checkpoints: ReadonlyArray<Pick<OrchestrationCheckpointSummary, "files">>;
  readonly thread: Pick<OrchestrationThread, "session" | "latestTurn">;
  readonly quotaExhausted: boolean;
  readonly compactionNeedsCheckpoint: boolean;
}): ContinuationPacket {
  const verificationReceipts = input.activities
    .filter((activity) => itemType(activity) === "command_execution")
    .flatMap((activity) => {
      const exitCode = extractExitCode(activity);
      return exitCode === null
        ? []
        : [
            {
              label: `${extractCommandLabel(activity)} · exit ${exitCode}`,
              outcome: exitCode === 0 ? ("passed" as const) : ("failed" as const),
              occurredAt: activity.createdAt,
            },
          ];
    })
    .slice(-12)
    .reverse();
  const research = input.activities
    .flatMap((activity) => {
      const evidence = extractResearch(activity);
      return evidence ? [evidence] : [];
    })
    .slice(-12)
    .reverse();
  const changed = unique(input.checkpoints.at(-1)?.files.map((file) => file.path) ?? []);
  const verification = unique(
    verificationReceipts
      .filter((receipt) => receipt.outcome === "passed")
      .map((receipt) => receipt.label),
  );
  const nextActions: string[] = [];
  if (input.quotaExhausted)
    nextActions.push("Choose another provider before continuing this work.");
  if (input.compactionNeedsCheckpoint) {
    nextActions.push("Capture a checkpoint before relying on a resumed context.");
  }
  if (input.thread.session?.status === "error" || input.thread.latestTurn?.state === "error") {
    nextActions.push("Resolve the provider failure before continuing.");
  }
  if (nextActions.length === 0) {
    nextActions.push("Review the changed files and verification before continuing.");
  }
  return { changed, verification, nextActions, verificationReceipts, research };
}

export function continuationPacketHandoff(packet: ContinuationPacket): ProjectHandoffSummary {
  return {
    changed: packet.changed,
    decisions: [],
    verification: packet.verification,
    remaining: packet.nextActions,
  };
}
