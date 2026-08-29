import type { ResourceTelemetrySnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeResourceTelemetryStatus,
  formatResourceBytes,
  formatResourceCpuPercent,
  summarizeResourceTelemetry,
} from "./resourceTelemetrySummary.ts";

const snapshot = {
  sampleIntervalMs: 2_000,
  health: { native: { status: "degraded" } },
  groups: {
    allT3: {
      processCount: 4,
      currentCpuPercent: 12.5,
      currentRssBytes: 25 * 1_024 * 1_024,
      peakRssBytes: 32 * 1_024 * 1_024,
      ioReadBytesPerSecond: 4_096,
      ioWriteBytesPerSecond: 8_192,
    },
    backend: {
      processCount: 1,
      currentCpuPercent: 2,
      currentRssBytes: 1,
      peakRssBytes: 1,
      ioReadBytesPerSecond: 1,
      ioWriteBytesPerSecond: 1,
    },
  },
} as Pick<ResourceTelemetrySnapshot, "groups" | "health" | "sampleIntervalMs">;

describe("resource telemetry usage summary", () => {
  it("uses the all-T3 aggregate without inventing task attribution", () => {
    expect(summarizeResourceTelemetry(snapshot)).toEqual({
      status: "degraded",
      processCount: 4,
      currentCpuPercent: 12.5,
      currentRssBytes: 25 * 1_024 * 1_024,
      peakRssBytes: 32 * 1_024 * 1_024,
      ioReadBytesPerSecond: 4_096,
      ioWriteBytesPerSecond: 8_192,
      sampleIntervalMs: 2_000,
    });
  });

  it("formats bounded display values and monitor states", () => {
    expect(formatResourceBytes(25 * 1_024 * 1_024)).toBe("25.0 MB");
    expect(formatResourceBytes(-1)).toBe("0 B");
    expect(formatResourceBytes(Number.NaN)).toBe("0 B");
    expect(formatResourceCpuPercent(12.5)).toBe("12.5%");
    expect(formatResourceCpuPercent(-0.5)).toBe("0.00%");
    expect(formatResourceCpuPercent(Number.POSITIVE_INFINITY)).toBe("0.00%");
    expect(describeResourceTelemetryStatus("unavailable")).toBe("Unavailable");
  });
});
