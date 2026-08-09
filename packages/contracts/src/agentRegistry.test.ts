import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AcpRegistry,
  AcpRegistryAgent,
  acpPlatformTriple,
  acpPrerequisitesFor,
  deriveAcpInstallSafety,
  selectAcpDistribution,
} from "./agentRegistry.ts";

const decodeRegistry = Schema.decodeUnknownSync(AcpRegistry);
const decodeAgent = Schema.decodeUnknownSync(AcpRegistryAgent);

/**
 * Copied verbatim from the published registry so the schema is checked against
 * the real payload shape rather than one invented to match the schema.
 */
const ampAcpEntry = {
  id: "amp-acp",
  name: "Amp",
  version: "0.9.0",
  description: "ACP wrapper for Amp - the frontier coding agent",
  repository: "https://github.com/tao12345666333/amp-acp",
  authors: ["tao12345666333"],
  license: "Apache-2.0",
  icon: "https://cdn.agentclientprotocol.com/registry/v1/latest/amp-acp.svg",
  distribution: {
    binary: {
      "windows-x86_64": {
        archive:
          "https://github.com/tao12345666333/amp-acp/releases/download/v0.9.0/amp-acp-windows-x86_64.zip",
        cmd: "amp-acp.exe",
        sha256: "3b2c3d14d703fcf9572da9733e4941703a7744bd37ec4aaa75421d6002c0157b",
      },
      "linux-x86_64": {
        archive:
          "https://github.com/tao12345666333/amp-acp/releases/download/v0.9.0/amp-acp-linux-x86_64.tar.gz",
        cmd: "./amp-acp",
        sha256: "afaa50a152eb86a8ff21e354ded63fe2d21b730859692e3a60b2c4c9ef23df31",
      },
    },
  },
};

const npxEntry = {
  id: "claude-acp",
  name: "Claude Agent",
  version: "0.66.0",
  description: "ACP wrapper for Anthropic's Claude",
  repository: "https://github.com/agentclientprotocol/claude-agent-acp",
  authors: ["Anthropic", "Zed Industries", "JetBrains"],
  license: "proprietary",
  distribution: { npx: { package: "@zed-industries/claude-code-acp" } },
};

describe("AcpRegistry decoding", () => {
  it("decodes a published binary entry without loss", () => {
    const agent = decodeAgent(ampAcpEntry);
    expect(agent.id).toBe("amp-acp");
    expect(agent.distribution.binary?.["windows-x86_64"]?.cmd).toBe("amp-acp.exe");
    expect(agent.distribution.binary?.["windows-x86_64"]?.sha256).toBe(
      "3b2c3d14d703fcf9572da9733e4941703a7744bd37ec4aaa75421d6002c0157b",
    );
  });

  it("decodes an entry that only ships a package distribution", () => {
    const agent = decodeAgent(npxEntry);
    expect(agent.distribution.npx?.package).toBe("@zed-industries/claude-code-acp");
    expect(agent.distribution.binary).toBeUndefined();
  });

  it("drops entries this build cannot decode instead of failing the payload", () => {
    const registry = decodeRegistry({
      version: "1.0.0",
      agents: [ampAcpEntry, { id: "broken", name: "Broken" }, npxEntry],
    });
    expect(registry.agents.map((agent) => agent.id)).toEqual(["amp-acp", "claude-acp"]);
  });

  it("ignores registry keys this build does not model", () => {
    const registry = decodeRegistry({
      version: "1.0.0",
      agents: [npxEntry],
      extensions: [{ id: "future-thing" }],
    });
    expect(registry.agents).toHaveLength(1);
  });
});

describe("acpPlatformTriple", () => {
  it("maps the platforms the registry publishes for", () => {
    expect(acpPlatformTriple("win32", "x64")).toBe("windows-x86_64");
    expect(acpPlatformTriple("win32", "arm64")).toBe("windows-aarch64");
    expect(acpPlatformTriple("darwin", "arm64")).toBe("darwin-aarch64");
    expect(acpPlatformTriple("linux", "x64")).toBe("linux-x86_64");
  });

  it("returns undefined rather than guessing an unmatchable triple", () => {
    expect(acpPlatformTriple("linux", "ppc64")).toBeUndefined();
    expect(acpPlatformTriple("aix", "x64")).toBeUndefined();
  });
});

describe("selectAcpDistribution", () => {
  it("prefers a platform-matched binary over a package manager", () => {
    const agent = decodeAgent({
      ...ampAcpEntry,
      distribution: { ...ampAcpEntry.distribution, npx: { package: "@example/agent" } },
    });
    const choice = selectAcpDistribution(agent, "windows-x86_64");
    expect(choice.kind).toBe("binary");
    expect(choice.kind === "binary" && choice.artifact.cmd).toBe("amp-acp.exe");
  });

  it("falls back to npx when no binary matches this platform", () => {
    const agent = decodeAgent({
      ...ampAcpEntry,
      distribution: { ...ampAcpEntry.distribution, npx: { package: "@example/agent" } },
    });
    const choice = selectAcpDistribution(agent, "darwin-aarch64");
    expect(choice.kind).toBe("npx");
  });

  it("prefers npx over uvx, since Node is already required and Python is not", () => {
    const agent = decodeAgent({
      ...npxEntry,
      distribution: { npx: { package: "@example/agent" }, uvx: { package: "example-agent" } },
    });
    expect(selectAcpDistribution(agent, "windows-x86_64").kind).toBe("npx");
  });

  it("uses uvx when it is the only package distribution", () => {
    const agent = decodeAgent({
      ...npxEntry,
      distribution: { uvx: { package: "example-agent" } },
    });
    expect(selectAcpDistribution(agent, "windows-x86_64").kind).toBe("uvx");
  });

  it("reports an unsupported platform distinctly from a missing distribution", () => {
    const agent = decodeAgent(ampAcpEntry);
    expect(selectAcpDistribution(agent, undefined)).toEqual({
      kind: "unavailable",
      reason: "unsupported_platform",
    });
    expect(selectAcpDistribution(agent, "darwin-aarch64")).toEqual({
      kind: "unavailable",
      reason: "no_distribution_for_platform",
    });
  });

  it("selects without regard to install safety, which is a separate gate", () => {
    const agent = decodeAgent({
      ...ampAcpEntry,
      distribution: {
        binary: {
          "windows-x86_64": { archive: "http://example.invalid/a.zip", cmd: "a.exe" },
        },
      },
    });
    expect(selectAcpDistribution(agent, "windows-x86_64").kind).toBe("binary");
    expect(deriveAcpInstallSafety(selectAcpDistribution(agent, "windows-x86_64"))).toEqual({
      checksumVerifiable: false,
      risks: ["insecure_archive_url", "unverified_checksum"],
    });
  });
});

describe("acpPrerequisitesFor", () => {
  it("needs nothing for a self-contained binary", () => {
    const choice = selectAcpDistribution(decodeAgent(ampAcpEntry), "windows-x86_64");
    expect(acpPrerequisitesFor(choice)).toEqual([]);
  });

  it("needs Node on PATH for an npx distribution", () => {
    const choice = selectAcpDistribution(decodeAgent(npxEntry), "windows-x86_64");
    expect(acpPrerequisitesFor(choice)).toEqual(["node"]);
  });

  it("needs uv for a uvx distribution", () => {
    const agent = decodeAgent({ ...npxEntry, distribution: { uvx: { package: "example" } } });
    expect(acpPrerequisitesFor(selectAcpDistribution(agent, "linux-x86_64"))).toEqual(["uv"]);
  });

  it("asks for nothing when there is nothing to install", () => {
    const agent = decodeAgent({ ...ampAcpEntry, distribution: {} });
    expect(acpPrerequisitesFor(selectAcpDistribution(agent, "linux-x86_64"))).toEqual([]);
  });
});

describe("deriveAcpInstallSafety", () => {
  it("treats fully checksummed HTTPS binaries as verifiable", () => {
    const choice = selectAcpDistribution(decodeAgent(ampAcpEntry), "windows-x86_64");
    expect(deriveAcpInstallSafety(choice)).toEqual({
      checksumVerifiable: true,
      risks: [],
    });
  });

  it("flags a package-manager entry as unverifiable before install", () => {
    const choice = selectAcpDistribution(decodeAgent(npxEntry), "windows-x86_64");
    expect(deriveAcpInstallSafety(choice)).toEqual({
      checksumVerifiable: false,
      risks: ["package_manager_install"],
    });
  });

  it("flags a binary published without a checksum", () => {
    const agent = decodeAgent({
      ...ampAcpEntry,
      distribution: {
        binary: {
          "linux-x86_64": {
            archive: "https://example.invalid/agent.tar.gz",
            cmd: "./agent",
          },
        },
      },
    });
    expect(deriveAcpInstallSafety(selectAcpDistribution(agent, "linux-x86_64"))).toEqual({
      checksumVerifiable: false,
      risks: ["unverified_checksum"],
    });
  });

  it("rejects a malformed checksum as if it were absent", () => {
    const agent = decodeAgent({
      ...ampAcpEntry,
      distribution: {
        binary: {
          "linux-x86_64": {
            archive: "https://example.invalid/agent.tar.gz",
            cmd: "./agent",
            sha256: "not-a-real-digest",
          },
        },
      },
    });
    expect(deriveAcpInstallSafety(selectAcpDistribution(agent, "linux-x86_64")).risks).toEqual([
      "unverified_checksum",
    ]);
  });

  it("flags a plain HTTP archive", () => {
    const agent = decodeAgent({
      ...ampAcpEntry,
      distribution: {
        binary: {
          "linux-x86_64": {
            archive: "http://example.invalid/agent.tar.gz",
            cmd: "./agent",
            sha256: "afaa50a152eb86a8ff21e354ded63fe2d21b730859692e3a60b2c4c9ef23df31",
          },
        },
      },
    });
    expect(deriveAcpInstallSafety(selectAcpDistribution(agent, "linux-x86_64")).risks).toEqual([
      "insecure_archive_url",
    ]);
  });

  it("ignores an npx fallback when a verified binary is selected", () => {
    const agent = decodeAgent({
      ...ampAcpEntry,
      distribution: {
        ...ampAcpEntry.distribution,
        npx: { package: "@example/agent" },
      },
    });
    const safety = deriveAcpInstallSafety(selectAcpDistribution(agent, "windows-x86_64"));
    expect(safety).toEqual({ checksumVerifiable: true, risks: [] });
  });

  it("does not borrow safety from a binary for a different platform", () => {
    const agent = decodeAgent({
      ...ampAcpEntry,
      distribution: {
        ...ampAcpEntry.distribution,
        npx: { package: "@example/agent" },
      },
    });
    const safety = deriveAcpInstallSafety(selectAcpDistribution(agent, "darwin-aarch64"));
    expect(safety).toEqual({
      checksumVerifiable: false,
      risks: ["package_manager_install"],
    });
  });

  it("reports an entry with no distribution at all", () => {
    const agent = decodeAgent({ ...ampAcpEntry, distribution: {} });
    expect(deriveAcpInstallSafety(selectAcpDistribution(agent, "linux-x86_64"))).toEqual({
      checksumVerifiable: false,
      risks: ["no_distribution"],
    });
  });
});
