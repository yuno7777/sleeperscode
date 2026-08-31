import { describe, expect, it } from "vite-plus/test";
import type {
  OrchestrationThreadActivity,
  ProjectSharedProviderConfiguration,
} from "@t3tools/contracts";
import { deriveMcpDiagnostics } from "./mcpDiagnostics.ts";

const configuration: ProjectSharedProviderConfiguration = {
  rulePaths: [],
  mcpServerNames: ["github"],
  mcpProfileName: "Review tools",
  mcpToolCallBudget: 1,
  scopeGuardrail: null,
  recommendedRuntimeMode: null,
  recommendedInteractionMode: null,
};

function activity(id: string, payload: Record<string, unknown>): OrchestrationThreadActivity {
  return {
    id,
    tone: "tool",
    kind: "tool.completed",
    summary: "MCP tool call",
    payload,
    turnId: null,
    createdAt: "2026-08-31T10:00:00.000Z",
  } as OrchestrationThreadActivity;
}

describe("deriveMcpDiagnostics", () => {
  it("deduplicates lifecycle rows and highlights unconfigured servers", () => {
    const diagnostics = deriveMcpDiagnostics(
      [
        activity("started", {
          itemType: "mcp_tool_call",
          data: { item: { id: "call-1", server: "github", tool: "get_issue" } },
        }),
        activity("completed", {
          itemType: "mcp_tool_call",
          data: { item: { id: "call-1", server: "github", tool: "get_issue" } },
        }),
        activity("linear", {
          itemType: "mcp_tool_call",
          data: { toolName: "mcp__linear__search_issues", toolCallId: "call-2" },
        }),
      ],
      configuration,
    );
    expect(diagnostics?.callCount).toBe(2);
    expect(diagnostics?.observedServers).toEqual([
      { name: "github", tools: ["get_issue"] },
      { name: "linear", tools: ["search_issues"] },
    ]);
    expect(diagnostics?.unexpectedServerNames).toEqual(["linear"]);
    expect(diagnostics?.budgetExceeded).toBe(true);
  });
});
