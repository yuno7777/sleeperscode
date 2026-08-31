import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { deriveProviderQuotaStatus } from "./providerQuota.ts";

function activity(payload: Record<string, unknown>): OrchestrationThreadActivity {
  return {
    id: "rate-limit",
    tone: "info",
    kind: "provider.rate-limit.updated",
    summary: "Provider rate limit updated",
    payload,
    turnId: null,
    createdAt: "2026-08-31T10:00:00.000Z",
  } as OrchestrationThreadActivity;
}

describe("deriveProviderQuotaStatus", () => {
  it("only calls a provider exhausted when its telemetry says so", () => {
    expect(
      deriveProviderQuotaStatus([
        activity({ provider: "codex", rateLimits: { primary: { usedPercent: 100 } } }),
      ]),
    ).toEqual({ provider: "codex", exhausted: true });
    expect(
      deriveProviderQuotaStatus([
        activity({ provider: "claudeAgent", rateLimits: { primary: { usedPercent: 78 } } }),
      ]),
    ).toEqual({ provider: "claudeAgent", exhausted: false });
  });
});
