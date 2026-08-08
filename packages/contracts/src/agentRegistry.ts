/**
 * Agent Client Protocol registry.
 *
 * The ACP project publishes a machine-readable registry of agents that speak the
 * protocol, served from `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`
 * and refreshed continuously. Sleepers Code decodes it rather than hand-keeping a
 * catalog, because a hand-kept list of third-party CLIs goes stale silently.
 *
 * Two properties of that feed drive the shapes here.
 *
 * It is remote, third-party data describing things to download and execute, so
 * it is decoded defensively and never treated as pre-approved commands. Entries
 * the current build cannot decode are dropped rather than failing the payload,
 * matching how every other growing server-to-client array in these contracts
 * behaves.
 *
 * It mixes trust levels. Some entries are published by the agent's own vendor;
 * others are community wrappers living under personal repositories. The registry
 * does not label which is which, so nothing here infers vendor endorsement from
 * a registry entry.
 *
 * @module agentRegistry
 */
import * as Schema from "effect/Schema";

import { ForwardCompatibleArray, TrimmedNonEmptyString } from "./baseSchemas.ts";

const EnvironmentRecord = Schema.Record(Schema.String, Schema.String);
const CommandArguments = Schema.Array(Schema.String);

/** `npx`/`uvx` style distribution: a package name resolved by a package manager. */
export const AcpRegistryPackageDistribution = Schema.Struct({
  package: TrimmedNonEmptyString,
  args: Schema.optional(CommandArguments),
  env: Schema.optional(EnvironmentRecord),
});
export type AcpRegistryPackageDistribution = typeof AcpRegistryPackageDistribution.Type;

/** One downloadable archive for a specific platform triple. */
export const AcpRegistryBinaryArtifact = Schema.Struct({
  archive: TrimmedNonEmptyString,
  cmd: TrimmedNonEmptyString,
  args: Schema.optional(CommandArguments),
  /** Lowercase hex SHA-256 of the archive. Absent for some publishers. */
  sha256: Schema.optional(TrimmedNonEmptyString),
  env: Schema.optional(EnvironmentRecord),
});
export type AcpRegistryBinaryArtifact = typeof AcpRegistryBinaryArtifact.Type;

/** Platform triples are publisher-chosen (`windows-x86_64`, `darwin-aarch64`, …). */
export const AcpRegistryBinaryDistribution = Schema.Record(
  Schema.String,
  AcpRegistryBinaryArtifact,
);
export type AcpRegistryBinaryDistribution = typeof AcpRegistryBinaryDistribution.Type;

export const AcpRegistryDistribution = Schema.Struct({
  npx: Schema.optional(AcpRegistryPackageDistribution),
  uvx: Schema.optional(AcpRegistryPackageDistribution),
  binary: Schema.optional(AcpRegistryBinaryDistribution),
});
export type AcpRegistryDistribution = typeof AcpRegistryDistribution.Type;

export const AcpRegistryAgent = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  repository: Schema.optional(TrimmedNonEmptyString),
  website: Schema.optional(TrimmedNonEmptyString),
  authors: Schema.optional(Schema.Array(Schema.String)),
  license: Schema.optional(TrimmedNonEmptyString),
  icon: Schema.optional(TrimmedNonEmptyString),
  distribution: AcpRegistryDistribution,
});
export type AcpRegistryAgent = typeof AcpRegistryAgent.Type;

export const AcpRegistry = Schema.Struct({
  version: TrimmedNonEmptyString,
  agents: ForwardCompatibleArray(AcpRegistryAgent),
});
export type AcpRegistry = typeof AcpRegistry.Type;

/**
 * Why an entry may not be installed without the user driving it.
 *
 *  - `insecure_archive_url` — an archive is not served over HTTPS.
 *  - `unverified_checksum` — a downloadable archive publishes no SHA-256, so the
 *    bytes that arrive cannot be checked against what the publisher intended.
 *  - `package_manager_install` — delivery is an `npx`/`uvx` package name, which
 *    resolves at install time and carries no checksum to verify beforehand.
 *  - `no_distribution` — the entry describes no way to obtain the agent.
 */
export const AcpInstallRisk = Schema.Literals([
  "insecure_archive_url",
  "unverified_checksum",
  "package_manager_install",
  "no_distribution",
]);
export type AcpInstallRisk = typeof AcpInstallRisk.Type;

export const AcpInstallSafety = Schema.Struct({
  /**
   * True only when every artifact for this entry can be fetched over HTTPS and
   * checked against a published SHA-256 before anything executes.
   */
  checksumVerifiable: Schema.Boolean,
  risks: Schema.Array(AcpInstallRisk),
});
export type AcpInstallSafety = typeof AcpInstallSafety.Type;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Classifies how an entry may be installed.
 *
 * This answers "can these bytes be verified before they run", not "is this agent
 * trustworthy". A checksum proves the download matches what the publisher
 * uploaded; it says nothing about who the publisher is. Deciding whether a
 * publisher is the agent's vendor is a separate judgement this function
 * deliberately does not make.
 */
export const deriveAcpInstallSafety = (agent: AcpRegistryAgent): AcpInstallSafety => {
  const risks: Array<AcpInstallRisk> = [];
  const binaries = Object.values(agent.distribution.binary ?? {});
  const hasPackageDistribution =
    agent.distribution.npx !== undefined || agent.distribution.uvx !== undefined;

  if (binaries.length === 0 && !hasPackageDistribution) {
    return { checksumVerifiable: false, risks: ["no_distribution"] };
  }

  if (binaries.some((artifact) => !isHttpsUrl(artifact.archive))) {
    risks.push("insecure_archive_url");
  }
  if (binaries.some((artifact) => !SHA256_PATTERN.test(artifact.sha256 ?? ""))) {
    risks.push("unverified_checksum");
  }
  if (hasPackageDistribution) {
    risks.push("package_manager_install");
  }

  return {
    // A package-manager entry is never checksum-verifiable, even alongside
    // binaries, because the package path is what would actually run.
    checksumVerifiable: binaries.length > 0 && risks.length === 0,
    risks,
  };
};

/**
 * Platform triple used by registry `binary` keys, in the publisher's spelling.
 *
 * Takes `platform` and `architecture` as plain strings, in Node's spelling
 * (`win32`/`darwin`/`linux`, `x64`/`arm64`), because these contracts are shared
 * with the web and mobile clients and must not depend on Node's type
 * definitions.
 *
 * Returns `undefined` for platforms the registry has no vocabulary for, rather
 * than guessing a triple that would silently match nothing.
 */
export const acpPlatformTriple = (platform: string, architecture: string): string | undefined => {
  const cpu = architecture === "x64" ? "x86_64" : architecture === "arm64" ? "aarch64" : undefined;
  if (cpu === undefined) return undefined;
  switch (platform) {
    case "win32":
      return `windows-${cpu}`;
    case "darwin":
      return `darwin-${cpu}`;
    case "linux":
      return `linux-${cpu}`;
    default:
      return undefined;
  }
};

export type AcpDistributionChoice =
  | {
      readonly kind: "binary";
      readonly triple: string;
      readonly artifact: AcpRegistryBinaryArtifact;
    }
  | {
      readonly kind: "npx" | "uvx";
      readonly distribution: AcpRegistryPackageDistribution;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "unsupported_platform" | "no_distribution_for_platform";
    };

/**
 * Picks how to obtain an agent on one platform, following the Phase 22 ordering.
 *
 * That ordering prefers a verified standalone binary over a package manager, so
 * a platform-matched `binary` artifact wins when one exists: it is the only form
 * that can carry a checksum, which is what makes a download verifiable before it
 * runs. `npx` is preferred over `uvx` only because Node is already a hard
 * requirement of this application while Python tooling is not, so it is the
 * option less likely to need a prerequisite installed first.
 *
 * Selection is deliberately independent of whether the chosen artifact passes
 * `deriveAcpInstallSafety`. Choosing and permitting are separate steps: an
 * installer still has to consult the safety gate before acting on this.
 */
export const selectAcpDistribution = (
  agent: AcpRegistryAgent,
  triple: string | undefined,
): AcpDistributionChoice => {
  if (triple === undefined) return { kind: "unavailable", reason: "unsupported_platform" };

  const artifact = agent.distribution.binary?.[triple];
  if (artifact !== undefined) return { kind: "binary", triple, artifact };
  if (agent.distribution.npx !== undefined) {
    return { kind: "npx", distribution: agent.distribution.npx };
  }
  if (agent.distribution.uvx !== undefined) {
    return { kind: "uvx", distribution: agent.distribution.uvx };
  }
  return { kind: "unavailable", reason: "no_distribution_for_platform" };
};

/**
 * Third-party tooling a distribution needs before it can run.
 *
 * `node` is listed even though this application already requires Node, because
 * an agent launched through `npx` needs Node reachable on the user's PATH, which
 * is a different question from the runtime this server happens to be running on.
 */
export const AcpPrerequisite = Schema.Literals(["node", "uv"]);
export type AcpPrerequisite = typeof AcpPrerequisite.Type;

/**
 * Prerequisites implied by how an agent is obtained.
 *
 * A downloaded binary is self-contained and needs nothing installed first, which
 * is the second reason Phase 22's ordering prefers it: fewer things to ask the
 * user to install before they can try an agent.
 *
 * This states what a distribution *requires*. Whether the machine has it is a
 * runtime probe, not something a contract can answer.
 */
export const acpPrerequisitesFor = (
  choice: AcpDistributionChoice,
): ReadonlyArray<AcpPrerequisite> => {
  switch (choice.kind) {
    case "npx":
      return ["node"];
    case "uvx":
      return ["uv"];
    case "binary":
    case "unavailable":
      return [];
  }
};
