import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type TaskAnalyticsRecord,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { MergedTaskAnalyticsRecord } from "./taskAnalyticsMerge.ts";
import { projectTaskTimeline } from "./taskTimeline.ts";

function record(overrides: Partial<TaskAnalyticsRecord> = {}): MergedTaskAnalyticsRecord {
  return {
    environmentId: EnvironmentId.make("environment-a"),
    environmentLabel: "Laptop",
    threadId: ThreadId.make("thread-a"),
    requestedAt: "2026-08-30T10:00:00.000Z",
    profile: null,
    route: {
      mode: "shadow",
      applied: false,
      selectedInstanceId: ProviderInstanceId.make("codex"),
      selectedDriver: ProviderDriverKind.make("codex"),
      model: "gpt-5.6-sol",
      selectionSource: "thread",
      selectedEligibility: "eligible",
      recommendation: "retain-current",
      candidateCount: 1,
      eligibleCandidateCount: 1,
      contextLimited: false,
      reasons: ["shadow-mode-no-override"],
    },
    outcome: {
      version: 1,
      terminalState: "completed",
      provider: { driver: ProviderDriverKind.make("codex") },
      observedAt: "2026-08-30T10:01:00.000Z",
    },
    feedback: { version: 1, value: "accepted", observedAt: "2026-08-30T10:02:00.000Z" },
    ...overrides,
  };
}

describe("projectTaskTimeline", () => {
  it("orders the content-free lifecycle newest first and preserves same-time causality", () => {
    const events = projectTaskTimeline([record()]);
    expect(events.map((event) => event.kind)).toEqual([
      "feedback-recorded",
      "terminal-observed",
      "routing-recorded",
      "requested",
    ]);
    expect(events[1]).toMatchObject({ terminalState: "completed", providerDriver: "codex" });
  });

  it("does not fabricate optional observations and respects the caller limit", () => {
    const pendingRecord: MergedTaskAnalyticsRecord = {
      environmentId: EnvironmentId.make("environment-a"),
      environmentLabel: "Laptop",
      threadId: ThreadId.make("thread-a"),
      requestedAt: "2026-08-30T10:00:00.000Z",
      profile: null,
      route: null,
      outcome: null,
    };
    const events = projectTaskTimeline([pendingRecord], 1);
    expect(events).toEqual([
      expect.objectContaining({ kind: "requested", timestamp: "2026-08-30T10:00:00.000Z" }),
    ]);
  });
});
