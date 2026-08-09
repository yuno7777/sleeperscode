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

export const ACP_REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

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
   * True only when the selected artifact can be fetched over HTTPS and checked
   * against a published SHA-256 before anything executes.
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
 * Classifies how the selected distribution may be installed.
 *
 * This answers "can these bytes be verified before they run", not "is this agent
 * trustworthy". A checksum proves the download matches what the publisher
 * uploaded; it says nothing about who the publisher is. Deciding whether a
 * publisher is the agent's vendor is a separate judgement this function
 * deliberately does not make.
 */
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

export const AcpDistributionChoice = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("binary"),
    triple: TrimmedNonEmptyString,
    artifact: AcpRegistryBinaryArtifact,
  }),
  Schema.Struct({
    kind: Schema.Literals(["npx", "uvx"]),
    distribution: AcpRegistryPackageDistribution,
  }),
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    reason: Schema.Literals(["unsupported_platform", "no_distribution_for_platform"]),
  }),
]);
export type AcpDistributionChoice = typeof AcpDistributionChoice.Type;

/**
 * Picks how to obtain an agent on one platform, following the Phase 22 ordering.
 *
 * That ordering prefers a platform-matched standalone binary over a package manager, so
 * a platform-matched `binary` artifact wins when one exists: it is the only form
 * that can carry a checksum, which is what makes a download verifiable before it
 * runs. `npx` is preferred over `uvx` only because Node is already a hard
 * requirement of this application while Python tooling is not, so it is the
 * option less likely to need a prerequisite installed first.
 *
 * Selection is deliberately independent of whether the chosen artifact passes
 * `deriveAcpInstallSafety`. Choosing and permitting are separate steps: an
 * installer still has to classify the returned choice before acting on it.
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
 * Evaluates only the distribution selected for the current platform.
 *
 * Alternate platforms and lower-priority package-manager fallbacks must not make
 * a selected, checksummed binary look unsafe. Conversely, a safe artifact for a
 * different platform cannot make the package path that will actually run look
 * verifiable.
 */
export const deriveAcpInstallSafety = (choice: AcpDistributionChoice): AcpInstallSafety => {
  if (choice.kind === "unavailable") {
    return { checksumVerifiable: false, risks: ["no_distribution"] };
  }
  if (choice.kind !== "binary") {
    return { checksumVerifiable: false, risks: ["package_manager_install"] };
  }

  const risks: Array<AcpInstallRisk> = [];
  if (!isHttpsUrl(choice.artifact.archive)) risks.push("insecure_archive_url");
  if (!SHA256_PATTERN.test(choice.artifact.sha256 ?? "")) risks.push("unverified_checksum");
  return { checksumVerifiable: risks.length === 0, risks };
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

/** Executables whose PATH resolution proves one prerequisite is usable. */
export const acpPrerequisiteCommandsFor = (prerequisite: AcpPrerequisite): ReadonlyArray<string> =>
  prerequisite === "node" ? ["node", "npx"] : ["uv", "uvx"];

export const AcpPrerequisiteAvailability = Schema.Literals(["available", "missing", "unknown"]);
export type AcpPrerequisiteAvailability = typeof AcpPrerequisiteAvailability.Type;

/** Live PATH evidence collected by the server that owns the agent process. */
export const AcpPrerequisiteStatus = Schema.Struct({
  prerequisite: AcpPrerequisite,
  availability: AcpPrerequisiteAvailability,
  /** Every executable that must resolve for this package distribution to work. */
  commands: Schema.Array(TrimmedNonEmptyString),
});
export type AcpPrerequisiteStatus = typeof AcpPrerequisiteStatus.Type;

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

/** One registry entry prepared for display on the server's current platform. */
export const AgentCatalogEntry = Schema.Struct({
  agent: AcpRegistryAgent,
  selectedDistribution: AcpDistributionChoice,
  installSafety: AcpInstallSafety,
  prerequisites: Schema.Array(AcpPrerequisite),
  /** Optional so a newer client can still consume snapshots from an older server. */
  prerequisiteStatus: Schema.optionalKey(Schema.Array(AcpPrerequisiteStatus)),
  /** Registry membership proves ACP compatibility, not vendor endorsement. */
  trust: Schema.Literal("registry-unverified"),
});
export type AgentCatalogEntry = typeof AgentCatalogEntry.Type;

/**
 * Trust is deliberately independent from checksum verifiability. The public ACP
 * registry does not currently publish an endorsement signal, so remote entries
 * remain `registry-unverified` until a separately reviewed Sleepers Code trust
 * policy says otherwise.
 */
export const AgentRegistryTrust = Schema.Literals([
  "official-built-in",
  "verified-community",
  "community",
  "registry-unverified",
  "custom",
]);
export type AgentRegistryTrust = typeof AgentRegistryTrust.Type;

export const AgentInstallArchiveFormat = Schema.Literals([
  "zip",
  "tar-gz",
  "executable",
  "unsupported",
]);
export type AgentInstallArchiveFormat = typeof AgentInstallArchiveFormat.Type;

/** Formats the first secure installer slice can unpack without invoking a shell. */
export const resolveAgentInstallArchiveFormat = (archiveUrl: string): AgentInstallArchiveFormat => {
  let pathname: string;
  try {
    pathname = new URL(archiveUrl).pathname.toLowerCase();
  } catch {
    return "unsupported";
  }
  if (pathname.endsWith(".tar.gz") || pathname.endsWith(".tgz")) return "tar-gz";
  if (pathname.endsWith(".zip")) return "zip";
  if (pathname.endsWith(".exe")) return "executable";
  return "unsupported";
};

export const AgentInstallBlocker = Schema.Literals([
  "distribution_not_binary",
  "archive_not_https",
  "checksum_unavailable",
  "archive_format_unsupported",
  "command_path_unsafe",
]);
export type AgentInstallBlocker = typeof AgentInstallBlocker.Type;

export const AgentInstallPlanRequest = Schema.Struct({
  agentId: TrimmedNonEmptyString,
});
export type AgentInstallPlanRequest = typeof AgentInstallPlanRequest.Type;

/**
 * Immutable preview of the exact bytes and command an install request will use.
 * `planId` fingerprints every security-relevant field; the server recomputes it
 * from a forced registry refresh before downloading anything.
 */
export const AgentInstallPlan = Schema.Struct({
  planId: TrimmedNonEmptyString,
  agentId: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  publisher: TrimmedNonEmptyString,
  repository: Schema.optional(TrimmedNonEmptyString),
  trust: AgentRegistryTrust,
  registryVersion: TrimmedNonEmptyString,
  platformTriple: TrimmedNonEmptyString,
  archiveUrl: TrimmedNonEmptyString,
  archiveHost: TrimmedNonEmptyString,
  archiveFormat: AgentInstallArchiveFormat,
  sha256: Schema.optional(TrimmedNonEmptyString),
  command: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String),
  environmentVariables: Schema.Array(TrimmedNonEmptyString),
  prerequisites: Schema.Array(AcpPrerequisite),
  blockers: Schema.Array(AgentInstallBlocker),
  canInstall: Schema.Boolean,
  requiresPublisherAcknowledgement: Schema.Boolean,
});
export type AgentInstallPlan = typeof AgentInstallPlan.Type;

export const AgentInstallRequest = Schema.Struct({
  agentId: TrimmedNonEmptyString,
  planId: TrimmedNonEmptyString,
  /** Required for every registry entry until a reviewed trust policy promotes it. */
  acknowledgeUnverifiedPublisher: Schema.Boolean,
});
export type AgentInstallRequest = typeof AgentInstallRequest.Type;

export const AgentInstallation = Schema.Struct({
  agentId: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  platformTriple: TrimmedNonEmptyString,
  installedAt: TrimmedNonEmptyString,
  trust: AgentRegistryTrust,
  sourceUrl: TrimmedNonEmptyString,
  sha256: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String),
});
export type AgentInstallation = typeof AgentInstallation.Type;

export const AgentInstallProgressStage = Schema.Literals([
  "revalidating",
  "downloading",
  "verifying",
  "extracting",
  "activating",
]);
export type AgentInstallProgressStage = typeof AgentInstallProgressStage.Type;

export const AgentInstallProgressEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("progress"),
    stage: AgentInstallProgressStage,
    bytesDownloaded: Schema.optional(Schema.Number),
    totalBytes: Schema.optional(Schema.Number),
  }),
  Schema.Struct({
    type: Schema.Literal("complete"),
    installation: AgentInstallation,
  }),
]);
export type AgentInstallProgressEvent = typeof AgentInstallProgressEvent.Type;

export const AgentInstallationsSnapshot = Schema.Struct({
  installations: Schema.Array(AgentInstallation),
});
export type AgentInstallationsSnapshot = typeof AgentInstallationsSnapshot.Type;

export const AgentUninstallRequest = Schema.Struct({
  agentId: TrimmedNonEmptyString,
  confirm: Schema.Boolean,
});
export type AgentUninstallRequest = typeof AgentUninstallRequest.Type;

export const AgentUninstallResult = Schema.Struct({
  agentId: TrimmedNonEmptyString,
  removed: Schema.Boolean,
});
export type AgentUninstallResult = typeof AgentUninstallResult.Type;

export const AgentInstallerErrorReason = Schema.Literals([
  "catalog_unavailable",
  "agent_not_found",
  "distribution_unsupported",
  "unsafe_distribution",
  "unsupported_archive",
  "stale_plan",
  "consent_required",
  "download_failed",
  "download_too_large",
  "checksum_mismatch",
  "archive_invalid",
  "command_invalid",
  "activation_failed",
  "install_in_progress",
  "not_installed",
  "uninstall_failed",
]);
export type AgentInstallerErrorReason = typeof AgentInstallerErrorReason.Type;

export class AgentInstallerError extends Schema.TaggedErrorClass<AgentInstallerError>()(
  "AgentInstallerError",
  {
    reason: AgentInstallerErrorReason,
    detail: TrimmedNonEmptyString,
  },
) {}

export const AgentCatalogUnavailableReason = Schema.Literals([
  "request_failed",
  "bad_status",
  "invalid_payload",
]);
export type AgentCatalogUnavailableReason = typeof AgentCatalogUnavailableReason.Type;

const AgentCatalogPlatform = {
  platform: TrimmedNonEmptyString,
  architecture: TrimmedNonEmptyString,
  platformTriple: Schema.optional(TrimmedNonEmptyString),
} as const;

export const AgentCatalogAvailable = Schema.Struct({
  status: Schema.Literals(["ready", "stale"]),
  sourceUrl: Schema.Literal(ACP_REGISTRY_URL),
  registryVersion: TrimmedNonEmptyString,
  fetchedAt: TrimmedNonEmptyString,
  agents: Schema.Array(AgentCatalogEntry),
  ...AgentCatalogPlatform,
  /** Present only when a refresh failed and cached data is being served. */
  reason: Schema.optional(AgentCatalogUnavailableReason),
});
export type AgentCatalogAvailable = typeof AgentCatalogAvailable.Type;

export const AgentCatalogUnavailable = Schema.Struct({
  status: Schema.Literal("unavailable"),
  sourceUrl: Schema.Literal(ACP_REGISTRY_URL),
  agents: Schema.Array(AgentCatalogEntry),
  reason: AgentCatalogUnavailableReason,
  ...AgentCatalogPlatform,
});
export type AgentCatalogUnavailable = typeof AgentCatalogUnavailable.Type;

/** Read-only Agent Hub catalog. Installation is a separate, explicit RPC. */
export const AgentCatalogSnapshot = Schema.Union([AgentCatalogAvailable, AgentCatalogUnavailable]);
export type AgentCatalogSnapshot = typeof AgentCatalogSnapshot.Type;

export const AgentCatalogRequest = Schema.Struct({
  /** Bypasses the server TTL while preserving the last-good fallback. */
  refresh: Schema.optional(Schema.Boolean),
});
export type AgentCatalogRequest = typeof AgentCatalogRequest.Type;
