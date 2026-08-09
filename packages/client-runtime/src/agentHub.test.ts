import type { AgentCatalogEntry, ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agentHubSummary,
  agentInstallProgressLabel,
  catalogDistributionLabel,
  catalogExternalUrl,
  catalogPrerequisiteLabel,
  catalogPrerequisiteStatuses,
  filterAgentCatalog,
  findAgentInstallation,
  providerReadinessLabel,
} from "./agentHub.js";

const entry = (
  name: string,
  selectedDistribution: AgentCatalogEntry["selectedDistribution"],
  checksumVerifiable = false,
): AgentCatalogEntry => ({
  agent: {
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    version: "1.0.0",
    description: `${name} coding agent`,
    authors: ["Example Vendor"],
    license: "MIT",
    distribution: {},
  },
  selectedDistribution,
  installSafety: {
    checksumVerifiable,
    risks: checksumVerifiable ? [] : ["package_manager_install"],
  },
  prerequisites: selectedDistribution.kind === "npx" ? ["node"] : [],
  trust: "registry-unverified",
});

const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: "codex" as ServerProvider["instanceId"],
  driver: "codex" as ServerProvider["driver"],
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-09T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

const entries = [
  entry(
    "Native Binary",
    {
      kind: "binary",
      triple: "windows-x86_64",
      artifact: {
        archive: "https://example.com/agent.zip",
        cmd: "agent.exe",
        sha256: "a".repeat(64),
      },
    },
    true,
  ),
  entry("Node Package", { kind: "npx", distribution: { package: "node-agent" } }),
  entry("Other Platform", { kind: "unavailable", reason: "no_distribution_for_platform" }),
];

describe("Agent Hub logic", () => {
  it("searches metadata without changing registry order", () => {
    expect(
      filterAgentCatalog(entries, "example vendor", "all").map((item) => item.agent.name),
    ).toEqual(["Native Binary", "Node Package", "Other Platform"]);
    expect(filterAgentCatalog(entries, "node", "all").map((item) => item.agent.name)).toEqual([
      "Node Package",
    ]);
  });

  it("filters compatible, verifiable, and package distributions independently", () => {
    expect(filterAgentCatalog(entries, "", "compatible").map((item) => item.agent.name)).toEqual([
      "Native Binary",
      "Node Package",
    ]);
    expect(filterAgentCatalog(entries, "", "verifiable").map((item) => item.agent.name)).toEqual([
      "Native Binary",
    ]);
    expect(filterAgentCatalog(entries, "", "package").map((item) => item.agent.name)).toEqual([
      "Node Package",
    ]);
  });

  it("keeps integrated and routable counts distinct", () => {
    expect(
      agentHubSummary(
        [
          provider(),
          provider({ instanceId: "work" as ServerProvider["instanceId"], enabled: false }),
        ],
        entries,
      ),
    ).toEqual({ integrated: 2, routable: 1, catalog: 3, checksumVerifiable: 1 });
  });

  it("does not claim that an available checksum was already verified", () => {
    expect(catalogDistributionLabel(entries[0]!)).toBe("Checksum available");
    expect(catalogDistributionLabel(entries[1]!)).toBe("npm package");
    expect(catalogDistributionLabel(entries[2]!)).toBe("No compatible build");
  });

  it("presents live prerequisite evidence and degrades older snapshots to unknown", () => {
    expect(catalogPrerequisiteStatuses(entries[1]!)).toEqual([
      {
        prerequisite: "node",
        availability: "unknown",
        commands: ["node", "npx"],
      },
    ]);

    const [status] = catalogPrerequisiteStatuses({
      ...entries[1]!,
      prerequisiteStatus: [
        {
          prerequisite: "node",
          availability: "available",
          commands: ["node", "npx"],
        },
      ],
    });
    expect(status && catalogPrerequisiteLabel(status)).toBe("Node + npx ready");
    expect(
      catalogPrerequisiteLabel({
        prerequisite: "node",
        availability: "missing",
        commands: ["node", "npx"],
      }),
    ).toBe("Node + npx missing");
    expect(
      catalogPrerequisiteLabel({
        prerequisite: "uv",
        availability: "unknown",
        commands: ["uv", "uvx"],
      }),
    ).toBe("uv + uvx not checked");
  });

  it("exposes only HTTP links from registry metadata", () => {
    expect(
      catalogExternalUrl({
        ...entries[0]!,
        agent: {
          ...entries[0]!.agent,
          website: "javascript:alert(1)",
          repository: "https://github.com/example/agent",
        },
      }),
    ).toBe("https://github.com/example/agent");
    expect(
      catalogExternalUrl({
        ...entries[0]!,
        agent: {
          ...entries[0]!.agent,
          website: "file:///tmp/agent",
          repository: "not a url",
        },
      }),
    ).toBeNull();
  });

  it("reports built-in readiness without conflating integration and routing", () => {
    expect(providerReadinessLabel(provider())).toBe("Routable");
    expect(providerReadinessLabel(provider({ enabled: false }))).toBe("Integrated");
    expect(providerReadinessLabel(provider({ installed: false }))).toBe("Not detected");
  });

  it("presents secure installation progress without overstating completion", () => {
    expect(agentInstallProgressLabel({ type: "progress", stage: "verifying" })).toBe(
      "Verifying checksum",
    );
    expect(
      agentInstallProgressLabel({
        type: "progress",
        stage: "downloading",
        bytesDownloaded: 25,
        totalBytes: 100,
      }),
    ).toBe("Downloading 25%");
  });

  it("matches installations by registry identity", () => {
    const installation = {
      agentId: "native-binary",
      displayName: "Native Binary",
      version: "1.0.0",
      platformTriple: "windows-x86_64",
      installedAt: "2026-08-09T00:00:00.000Z",
      trust: "registry-unverified" as const,
      sourceUrl: "https://example.com/agent.zip",
      sha256: "a".repeat(64),
      command: "agent.exe",
      args: [],
    };
    expect(findAgentInstallation([installation], "native-binary")).toBe(installation);
    expect(findAgentInstallation([installation], "missing")).toBeUndefined();
  });
});
