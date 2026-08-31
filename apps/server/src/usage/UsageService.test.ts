import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type UsageBucket,
  type UsageDay,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeUsageProviderCoverage } from "./UsageService.ts";

function provider(driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-15T00:00:00.000Z" as ServerProvider["checkedAt"],
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("makeUsageProviderCoverage", () => {
  it("reports every installed provider without inventing unsupported totals", () => {
    const codexBucket = {
      day: "2026-08-15" as UsageDay,
      provider: "codex",
    } as UsageBucket;
    const coverage = makeUsageProviderCoverage(
      "workstation",
      [
        provider("codex"),
        provider("antigravity", { auth: { status: "unknown" } }),
        provider("opencode"),
        provider("cursor", { installed: false }),
      ],
      [codexBucket],
    );

    expect(coverage.map((entry) => entry.provider)).toEqual(["codex", "antigravity"]);
    expect(coverage[0]).toMatchObject({
      displayName: "Codex",
      reporting: "transcript",
      observed: true,
      routable: true,
    });
    expect(coverage[1]).toMatchObject({
      displayName: "Antigravity",
      reporting: "runtimeEvents",
      observed: false,
      routable: false,
    });
    expect(coverage[2]).toMatchObject({
      displayName: "OpenCode",
      reporting: "database",
      observed: false,
      routable: true,
      message: null,
    });
  });

  it("preserves custom installed drivers in host coverage", () => {
    const coverage = makeUsageProviderCoverage("workstation", [provider("localAgent")], []);
    expect(coverage[0]).toMatchObject({
      provider: "localAgent",
      displayName: "localAgent",
      reporting: "notReported",
    });
  });
});
