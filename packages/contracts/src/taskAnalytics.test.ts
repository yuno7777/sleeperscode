import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  TASK_ANALYTICS_MAX_RECORDS,
  TaskAnalyticsClearResult,
  TaskAnalyticsSummary,
  TaskAnalyticsSummaryInput,
} from "./taskAnalytics.ts";
import { ThreadId } from "./baseSchemas.ts";

const decodeSummary = Schema.decodeUnknownSync(TaskAnalyticsSummary);

describe("TaskAnalyticsSummary", () => {
  it("accepts compact content-free shadow routing evidence", () => {
    const summary = decodeSummary({
      contractVersion: 1,
      readAt: "2026-08-12T12:00:00.000Z",
      sourceFingerprint: "source-4ec8",
      timeZone: "Asia/Calcutta",
      sinceDay: "2026-08-01",
      untilDay: "2026-08-12",
      records: [
        {
          threadId: ThreadId.make("thread-analytics"),
          requestedAt: "2026-08-12T11:58:00.000Z",
          elapsedMs: 120_000,
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
            reasons: ["thread-selection-authoritative", "shadow-mode-no-override"],
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
      prompt: "must be dropped",
      providerError: "must be dropped",
      quality: 1,
      success: true,
    });

    expect(summary.records).toHaveLength(1);
    expect(summary.records[0]?.elapsedMs).toBe(120_000);
    expect(summary).not.toHaveProperty("prompt");
    expect(summary).not.toHaveProperty("providerError");
    expect(summary).not.toHaveProperty("quality");
    expect(summary).not.toHaveProperty("success");
  });

  it("rejects oversized record payloads", () => {
    const record = {
      threadId: ThreadId.make("thread-analytics"),
      requestedAt: "2026-08-12T11:58:00.000Z",
      profile: null,
      route: null,
      outcome: null,
    };

    expect(() =>
      decodeSummary({
        contractVersion: 1,
        readAt: "2026-08-12T12:00:00.000Z",
        sourceFingerprint: "source-4ec8",
        timeZone: "UTC",
        sinceDay: "2026-08-01",
        untilDay: "2026-08-12",
        records: Array.from({ length: TASK_ANALYTICS_MAX_RECORDS + 1 }, () => record),
        truncated: true,
      }),
    ).toThrow();
  });

  it("rejects a negative elapsed time but accepts older records without one", () => {
    const base = {
      contractVersion: 1,
      readAt: "2026-08-12T12:00:00.000Z",
      sourceFingerprint: "source-4ec8",
      timeZone: "UTC",
      sinceDay: "2026-08-01",
      untilDay: "2026-08-12",
      truncated: false,
    };
    const legacyRecord = {
      threadId: ThreadId.make("thread-analytics"),
      requestedAt: "2026-08-12T11:58:00.000Z",
      profile: null,
      route: null,
      outcome: null,
    };

    expect(
      decodeSummary({ ...base, records: [legacyRecord] }).records[0]?.elapsedMs,
    ).toBeUndefined();
    expect(() =>
      decodeSummary({ ...base, records: [{ ...legacyRecord, elapsedMs: -1 }] }),
    ).toThrow();
  });
});

describe("TaskAnalyticsSummaryInput", () => {
  it("bounds time-zone input", () => {
    const decode = Schema.decodeUnknownSync(TaskAnalyticsSummaryInput);
    expect(() =>
      decode({ sinceDay: "2026-08-01", untilDay: "2026-08-12", timeZone: "x".repeat(129) }),
    ).toThrow();
  });
});

describe("TaskAnalyticsClearResult", () => {
  it("accepts only a non-negative deletion count", () => {
    const decode = Schema.decodeUnknownSync(TaskAnalyticsClearResult);
    expect(decode({ deletedRecords: 3 })).toEqual({ deletedRecords: 3 });
    expect(() => decode({ deletedRecords: -1 })).toThrow();
  });
});
