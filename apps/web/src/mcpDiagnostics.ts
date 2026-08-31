import type {
  OrchestrationThreadActivity,
  ProjectSharedProviderConfiguration,
} from "@t3tools/contracts";

type RecordValue = Record<string, unknown>;

export type McpDiagnostics = {
  readonly callCount: number;
  readonly observedServers: ReadonlyArray<{
    readonly name: string;
    readonly tools: ReadonlyArray<string>;
  }>;
  readonly unexpectedServerNames: ReadonlyArray<string>;
  readonly budgetExceeded: boolean;
};

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseClaudeToolName(toolName: string): { readonly server: string; readonly tool: string } {
  const match = /^mcp__([^_]+)__(.+)$/u.exec(toolName);
  return match ? { server: match[1]!, tool: match[2]! } : { server: "unknown", tool: toolName };
}

function extractMcpCall(activity: OrchestrationThreadActivity): {
  readonly key: string;
  readonly server: string;
  readonly tool: string;
} | null {
  const payload = asRecord(activity.payload);
  if (payload?.itemType !== "mcp_tool_call") return null;
  const data = asRecord(payload.data);
  const item = asRecord(data?.item);
  const itemId = nonEmpty(item?.id);
  const server = nonEmpty(item?.server);
  const tool = nonEmpty(item?.tool);
  if (server && tool) return { key: itemId ?? activity.id, server, tool };

  const toolName = nonEmpty(data?.toolName);
  if (toolName) {
    const parsed = parseClaudeToolName(toolName);
    return { key: nonEmpty(data?.toolCallId) ?? activity.id, ...parsed };
  }
  return { key: activity.id, server: "unknown", tool: "unknown" };
}

/**
 * Summarizes only provider activity the current client has actually observed.
 * The project budget is advisory because provider CLIs do not expose one shared
 * mechanism for T3 to stop an MCP call before it happens.
 */
export function deriveMcpDiagnostics(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  configuration: ProjectSharedProviderConfiguration | undefined,
): McpDiagnostics | null {
  if (!configuration || (configuration.mcpServerNames.length === 0 && activities.length === 0)) {
    return null;
  }

  const calls = new Map<string, { readonly server: string; readonly tool: string }>();
  for (const activity of activities) {
    const call = extractMcpCall(activity);
    if (call) calls.set(call.key, call);
  }
  const byServer = new Map<string, Set<string>>();
  for (const call of calls.values()) {
    const tools = byServer.get(call.server) ?? new Set<string>();
    tools.add(call.tool);
    byServer.set(call.server, tools);
  }
  const configured = new Set(configuration.mcpServerNames.map((name) => name.toLocaleLowerCase()));
  const observedServers = [...byServer.entries()]
    .map(([name, tools]) => ({ name, tools: [...tools].toSorted() }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return {
    callCount: calls.size,
    observedServers,
    unexpectedServerNames: observedServers
      .map((server) => server.name)
      .filter((name) => name !== "unknown" && !configured.has(name.toLocaleLowerCase())),
    budgetExceeded:
      configuration.mcpToolCallBudget !== null && calls.size > configuration.mcpToolCallBudget,
  };
}
