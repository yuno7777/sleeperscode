import type { ResourceTelemetrySnapshot, ResourceTelemetrySourceStatus } from "@t3tools/contracts";

/**
 * A compact, host-scoped view of resource telemetry for product surfaces.
 *
 * This deliberately keeps the monitor's aggregate boundaries intact. It is
 * not task, provider, or whole-machine attribution.
 */
export interface ResourceTelemetryUsageSummary {
  readonly status: ResourceTelemetrySourceStatus;
  readonly processCount: number;
  readonly currentCpuPercent: number;
  readonly currentRssBytes: number;
  readonly peakRssBytes: number;
  readonly ioReadBytesPerSecond: number;
  readonly ioWriteBytesPerSecond: number;
  readonly sampleIntervalMs: number;
}

export function summarizeResourceTelemetry(
  snapshot: Pick<ResourceTelemetrySnapshot, "groups" | "health" | "sampleIntervalMs">,
): ResourceTelemetryUsageSummary {
  const aggregate = snapshot.groups.allT3;
  return {
    status: snapshot.health.native.status,
    processCount: aggregate.processCount,
    currentCpuPercent: aggregate.currentCpuPercent,
    currentRssBytes: aggregate.currentRssBytes,
    peakRssBytes: aggregate.peakRssBytes,
    ioReadBytesPerSecond: aggregate.ioReadBytesPerSecond,
    ioWriteBytesPerSecond: aggregate.ioWriteBytesPerSecond,
    sampleIntervalMs: snapshot.sampleIntervalMs,
  };
}

export function formatResourceBytes(value: number): string {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let next = bytes;
  let unitIndex = -1;
  do {
    next /= 1_024;
    unitIndex += 1;
  } while (next >= 1_024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 100 ? 0 : next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatResourceCpuPercent(value: number): string {
  const percent = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${percent.toFixed(percent >= 100 ? 0 : percent >= 10 ? 1 : 2)}%`;
}

export function describeResourceTelemetryStatus(status: ResourceTelemetrySourceStatus): string {
  switch (status) {
    case "healthy":
      return "Live";
    case "starting":
      return "Starting";
    case "degraded":
      return "Degraded";
    case "unavailable":
      return "Unavailable";
    case "stopped":
      return "Stopped";
  }
}
