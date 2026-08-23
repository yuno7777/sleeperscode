import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  UsageDay,
  type TaskAnalyticsSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { mergeTaskAnalytics, type EnvironmentTaskAnalytics } from "./taskAnalyticsMerge.ts";

function environment(
  id: string,
  sourceFingerprint: string,
  overrides: Partial<TaskAnalyticsSummary> = {},
): EnvironmentTaskAnalytics {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    summary: {
      contractVersion: 1,
      readAt: "2026-08-12T12:00:00.000Z",
      sourceFingerprint,
      timeZone: "UTC",
      sinceDay: UsageDay.make("2026-08-01"),
      untilDay: UsageDay.make("2026-08-12"),
      records: [
        {
          threadId: ThreadId.make(`thread-${id}`),
          requestedAt: `2026-08-12T1${id === "alpha" ? "1" : "0"}:00:00.000Z`,
          elapsedMs: 3_600_000,
          feedback: {
            version: 1,
            value: "accepted",
            observedAt: "2026-08-12T12:01:00.000Z",
          },
          profile: {
            kinds: ["implementation"],
            complexity: "medium",
            primaryDomain: "backend",
            testingRequirement: "focused",
            securitySensitivity: "normal",
          },
          route: {
            mode: "shadow",
            applied: false,
            selectedInstanceId: ProviderInstanceId.make("codex"),
            selectedDriver: ProviderDriverKind.make("codex"),
            model: "gpt-5.6-sol",
            selectionSource: "thread",
            selectedEligibility: "eligible",
            recommendation: "retain-current",
            candidateCount: 2,
            eligibleCandidateCount: 2,
            contextLimited: false,
            reasons: ["shadow-mode-no-override"],
          },
          outcome: {
            version: 1,
            terminalState: "completed",
            provider: { driver: ProviderDriverKind.make("codex") },
            observedAt: "2026-08-12T12:00:00.000Z",
          },
        },
      ],
      truncated: false,
      ...overrides,
    },
  };
}

describe("mergeTaskAnalytics", () => {
  it("merges factual counts and sorts recent tasks", () => {
    const merged = mergeTaskAnalytics([
      environment("beta", "source-beta", {
        records: [
          {
            threadId: ThreadId.make("thread-beta"),
            requestedAt: "2026-08-12T10:00:00.000Z",
            elapsedMs: 60_000,
            feedback: {
              version: 1,
              value: "needs-repair",
              observedAt: "2026-08-12T10:02:00.000Z",
            },
            profile: null,
            route: null,
            outcome: {
              version: 1,
              terminalState: "failed",
              provider: { driver: ProviderDriverKind.make("claude") },
              observedAt: "2026-08-12T10:01:00.000Z",
            },
          },
        ],
      }),
      environment("alpha", "source-alpha"),
    ]);

    expect(merged.totalTasks).toBe(2);
    expect(merged.profiledTasks).toBe(1);
    expect(merged.routedTasks).toBe(1);
    expect(merged.terminalTasks).toBe(2);
    expect(merged.timedTasks).toBe(2);
    expect(merged.totalElapsedMs).toBe(3_660_000);
    expect(merged.averageElapsedMs).toBe(1_830_000);
    expect(merged.feedbackTasks).toBe(2);
    expect(merged.feedback).toEqual([
      { value: "accepted", count: 1 },
      { value: "needs-repair", count: 1 },
    ]);
    expect(merged.terminalStates).toEqual([
      { state: "completed", count: 1 },
      { state: "failed", count: 1 },
    ]);
    expect(merged.records.map((record) => record.environmentLabel)).toEqual(["alpha", "beta"]);
  });

  it("keeps timing coverage explicit when an older server omits elapsed time", () => {
    const withoutTiming = environment("alpha", "source-alpha");
    const merged = mergeTaskAnalytics([
      {
        ...withoutTiming,
        summary: {
          ...withoutTiming.summary,
          records: withoutTiming.summary.records.map(
            ({ elapsedMs: _elapsedMs, ...record }) => record,
          ),
        },
      },
    ]);

    expect(merged.timedTasks).toBe(0);
    expect(merged.totalElapsedMs).toBe(0);
    expect(merged.averageElapsedMs).toBeNull();
  });

  it("deduplicates shared stores and excludes incompatible contracts", () => {
    const merged = mergeTaskAnalytics([
      environment("alpha", "shared"),
      environment("duplicate", "shared"),
      environment("stale", "stale", { contractVersion: 0 }),
    ]);

    expect(merged.totalTasks).toBe(1);
    expect(merged.duplicateSources).toEqual(["duplicate (same store as alpha)"]);
    expect(merged.staleEnvironments).toEqual([EnvironmentId.make("stale")]);
  });
});
