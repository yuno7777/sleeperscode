import type { EnvironmentThreadShell } from "./state/models.ts";

export type AttentionKind = "approval" | "input" | "failed" | "plan" | "verification" | "working";

export type AttentionClassification = {
  readonly kind: AttentionKind;
  readonly title: string;
  readonly detail: string;
};

/**
 * One stable priority order for every client. A thread belongs in only one
 * attention state, so a provider's direct request always wins over a stale
 * completion check.
 */
export function classifyAttentionThread(
  thread: EnvironmentThreadShell,
  verified: boolean,
): AttentionClassification | null {
  if (thread.hasPendingApprovals) {
    return { kind: "approval", title: "Approval needed", detail: "Review the provider request." };
  }
  if (thread.hasPendingUserInput) {
    return {
      kind: "input",
      title: "Input needed",
      detail: "The agent is waiting for your answer.",
    };
  }
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") {
    return { kind: "failed", title: "Needs recovery", detail: "The last run ended with an error." };
  }
  if (thread.hasActionableProposedPlan) {
    return {
      kind: "plan",
      title: "Plan ready",
      detail: "Review the plan before implementation starts.",
    };
  }
  if (thread.session?.status === "running" || thread.session?.status === "starting") {
    return {
      kind: "working",
      title: "Working",
      detail: "The provider is still running this task.",
    };
  }
  if (thread.latestTurn?.state === "completed" && !verified) {
    return {
      kind: "verification",
      title: "Verification not recorded",
      detail: "The agent finished, but no test, check, or build result was saved in its handoff.",
    };
  }
  return null;
}
