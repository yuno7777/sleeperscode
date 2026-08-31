import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import {
  decodeOpenCodeUsageRows,
  openCodeUsageQuery,
  toOpenCodeUsageRecord,
} from "./opencodeUsage.ts";

describe("OpenCode usage aggregate", () => {
  it.effect("decodes only aggregate fields", () =>
    decodeOpenCodeUsageRows(
      '[{"messageId":"m1","sessionId":"s1","timestampMs":1725100000000,"providerId":"opencode","modelId":"free","inputTokens":1,"outputTokens":2,"cacheReadTokens":3,"cacheWriteTokens":4,"reasoningTokens":1,"costUsd":0}]',
    ).pipe(
      Effect.map((rows) => {
        expect(rows).toHaveLength(1);
        expect(rows[0]?.inputTokens).toBe(1);
        expect(toOpenCodeUsageRecord(rows[0]!)).toEqual({
          provider: "opencode",
          timestampMs: 1725100000000,
          model: "opencode/free",
          sessionId: "s1",
          totals: {
            uncachedInputTokens: 1,
            cachedInputTokens: 3,
            cacheCreationTokens: 4,
            outputTokens: 2,
            reasoningTokens: 1,
          },
          reportedCostUsd: 0,
          dedupeKey: "opencode-message:m1",
        });
      }),
    ),
  );

  it("limits the query to a numeric time window", () => {
    const query = openCodeUsageQuery(100.9, 200.2);
    expect(query).toContain("time_updated >= 100");
    expect(query).toContain("time_updated <= 200");
    expect(query).toContain("id AS messageId");
    expect(query).not.toContain("prompt");
    expect(query).not.toMatch(/[\r\n]/);
  });
});
