import {
  acpPrerequisiteCommandsFor,
  deriveAgentStatusLevels,
  type AcpPrerequisiteStatus,
  type AgentCatalogEntry,
  type AgentInstallation,
  type AgentInstallProgressEvent,
  type ServerProvider,
} from "@t3tools/contracts";

export type AgentHubCatalogFilter = "all" | "compatible" | "verifiable" | "package";

export type ProviderHealthNoticeTone = "warning" | "error";

export interface ProviderHealthFacts {
  readonly authLabel: string;
  readonly checkedAt: string;
  readonly checkedLabel: string;
  readonly modelCount: number;
  readonly commandCount: number;
  readonly skillCount: number;
  readonly enabledSkillCount: number;
  readonly updateLabel: string | null;
  readonly notice: {
    readonly tone: ProviderHealthNoticeTone;
    readonly message: string;
  } | null;
}

const searchableText = (entry: AgentCatalogEntry): string =>
  [
    entry.agent.name,
    entry.agent.id,
    entry.agent.description,
    entry.agent.authors?.join(" "),
    entry.agent.license,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();

export function filterAgentCatalog(
  entries: ReadonlyArray<AgentCatalogEntry>,
  query: string,
  filter: AgentHubCatalogFilter,
): ReadonlyArray<AgentCatalogEntry> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (normalizedQuery.length > 0 && !searchableText(entry).includes(normalizedQuery)) {
      return false;
    }
    switch (filter) {
      case "all":
        return true;
      case "compatible":
        return entry.selectedDistribution.kind !== "unavailable";
      case "verifiable":
        return entry.installSafety.checksumVerifiable;
      case "package":
        return (
          entry.selectedDistribution.kind === "npx" || entry.selectedDistribution.kind === "uvx"
        );
    }
  });
}

export function agentHubSummary(
  providers: ReadonlyArray<ServerProvider>,
  catalog: ReadonlyArray<AgentCatalogEntry>,
) {
  const levels = providers.map(deriveAgentStatusLevels);
  return {
    integrated: levels.filter((level) => level.integrated).length,
    routable: levels.filter((level) => level.routable).length,
    catalog: catalog.length,
    checksumVerifiable: catalog.filter((entry) => entry.installSafety.checksumVerifiable).length,
  };
}

export function catalogDistributionLabel(entry: AgentCatalogEntry): string {
  switch (entry.selectedDistribution.kind) {
    case "binary":
      return entry.installSafety.checksumVerifiable
        ? "Checksum available"
        : "Binary not verifiable";
    case "npx":
      return "npm package";
    case "uvx":
      return "uv package";
    case "unavailable":
      return entry.selectedDistribution.reason === "unsupported_platform"
        ? "Platform unsupported"
        : "No compatible build";
  }
}

/** Normalizes snapshots from both status-aware and older servers. */
export function catalogPrerequisiteStatuses(
  entry: AgentCatalogEntry,
): ReadonlyArray<AcpPrerequisiteStatus> {
  return entry.prerequisites.map(
    (prerequisite) =>
      entry.prerequisiteStatus?.find((status) => status.prerequisite === prerequisite) ?? {
        prerequisite,
        availability: "unknown",
        commands: acpPrerequisiteCommandsFor(prerequisite),
      },
  );
}

export function catalogPrerequisiteLabel(status: AcpPrerequisiteStatus): string {
  const commands = status.prerequisite === "node" ? "Node + npx" : "uv + uvx";
  switch (status.availability) {
    case "available":
      return `${commands} ready`;
    case "missing":
      return `${commands} missing`;
    case "unknown":
      return `${commands} not checked`;
  }
}

export function catalogExternalUrl(entry: AgentCatalogEntry): string | null {
  for (const candidate of [entry.agent.website, entry.agent.repository]) {
    if (candidate === undefined) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.protocol === "http:") return candidate;
    } catch {
      // A malformed optional link must not hide the rest of an otherwise valid entry.
    }
  }
  return null;
}

export function providerReadinessLabel(provider: ServerProvider): string {
  const levels = deriveAgentStatusLevels(provider);
  if (levels.routable) return "Routable";
  if (levels.integrated) return "Integrated";
  if (!provider.installed) return "Not detected";
  if (provider.availability === "unavailable") return "Driver unavailable";
  return "Needs attention";
}

function providerAuthLabel(provider: ServerProvider): string {
  switch (provider.auth.status) {
    case "authenticated":
      return provider.auth.email ?? provider.auth.label ?? "Authenticated";
    case "unauthenticated":
      return "Sign-in required";
    case "unknown":
      return "Auth not confirmed";
  }
}

function checkedAtLabel(checkedAt: string, nowMs: number): string {
  const checkedAtMs = Date.parse(checkedAt);
  const elapsedMs = Math.max(0, nowMs - checkedAtMs);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "Checked just now";
  if (minutes < 60) return `Checked ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Checked ${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `Checked ${days}d ago`;
  return `Checked ${checkedAt.slice(0, 10)}`;
}

function providerUpdateLabel(provider: ServerProvider): string | null {
  switch (provider.updateState?.status) {
    case "queued":
      return "Update queued";
    case "running":
      return "Update in progress";
    case "failed":
      return "Update failed";
  }

  if (provider.versionAdvisory?.status !== "behind_latest") return null;
  return provider.versionAdvisory.latestVersion === null
    ? "Update available"
    : `Update ${provider.versionAdvisory.latestVersion} available`;
}

function providerHealthNotice(provider: ServerProvider): ProviderHealthFacts["notice"] {
  if (provider.availability === "unavailable") {
    return {
      tone: "error",
      message: provider.unavailableReason ?? "This provider driver is unavailable in this build.",
    };
  }
  if (provider.status === "error") {
    return {
      tone: "error",
      message: provider.message ?? "The latest provider health check failed.",
    };
  }
  if (provider.updateState?.status === "failed") {
    return {
      tone: "error",
      message: provider.updateState.message ?? "The last provider update failed.",
    };
  }
  if (provider.status === "warning") {
    return {
      tone: "warning",
      message: provider.message ?? "This provider needs attention.",
    };
  }
  return null;
}

/** Current, factual provider health for consistent web and mobile rendering. */
export function providerHealthFacts(provider: ServerProvider, nowMs: number): ProviderHealthFacts {
  return {
    authLabel: providerAuthLabel(provider),
    checkedAt: provider.checkedAt,
    checkedLabel: checkedAtLabel(provider.checkedAt, nowMs),
    modelCount: provider.models.length,
    commandCount: provider.slashCommands.length,
    skillCount: provider.skills.length,
    enabledSkillCount: provider.skills.filter((skill) => skill.enabled).length,
    updateLabel: providerUpdateLabel(provider),
    notice: providerHealthNotice(provider),
  };
}

export function findAgentInstallation(
  installations: ReadonlyArray<AgentInstallation>,
  agentId: string,
): AgentInstallation | undefined {
  return installations.find((installation) => installation.agentId === agentId);
}

export function agentInstallProgressLabel(event: AgentInstallProgressEvent): string {
  if (event.type === "complete") return "Installed";
  switch (event.stage) {
    case "revalidating":
      return "Revalidating registry";
    case "downloading":
      if (event.totalBytes && event.bytesDownloaded !== undefined) {
        return `Downloading ${Math.min(100, Math.round((event.bytesDownloaded / event.totalBytes) * 100))}%`;
      }
      return "Downloading";
    case "verifying":
      return "Verifying checksum";
    case "extracting":
      return "Extracting safely";
    case "activating":
      return "Activating provider";
  }
}
