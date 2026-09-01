import type { OrchestrationThreadActivity } from "@t3tools/contracts";

type RecordValue = Record<string, unknown>;

export type ProviderQuotaStatus = {
  readonly provider: string;
  readonly exhausted: boolean;
};

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function usedPercentAtLimit(value: unknown): boolean {
  const record = asRecord(value);
  return typeof record?.usedPercent === "number" && record.usedPercent >= 100;
}

/** Reads only explicit provider telemetry, never token or cost estimates. */
export function deriveProviderQuotaStatus(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ProviderQuotaStatus | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== "provider.rate-limit.updated") continue;
    const payload = asRecord(activity.payload);
    const provider = typeof payload?.provider === "string" ? payload.provider : "This provider";
    const limits = asRecord(payload?.rateLimits);
    const exhausted =
      typeof limits?.rateLimitReachedType === "string" ||
      limits?.spendControlReached === true ||
      usedPercentAtLimit(limits?.primary) ||
      usedPercentAtLimit(limits?.secondary);
    return { provider, exhausted };
  }
  return null;
}
