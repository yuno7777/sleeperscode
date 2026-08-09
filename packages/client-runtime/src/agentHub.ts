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
