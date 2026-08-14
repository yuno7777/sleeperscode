import { describe, expect, it } from "vite-plus/test";

import { antigravityToolItemType, parseAntigravityStreamLine } from "./AntigravityAdapter.ts";

describe("Antigravity stream-JSON adapter", () => {
  it("decodes the documented init inventory including native web search", () => {
    const event = parseAntigravityStreamLine(
      JSON.stringify({
        event: "init",
        conversation_id: "conversation-1",
        init: { tools: ["search_web", "read_url_content", "run_command"] },
      }),
    );
    expect(event?.event).toBe("init");
    expect(event?.event === "init" ? event.init?.tools : []).toContain("search_web");
  });

  it("rejects terminal noise and classifies research tools canonically", () => {
    expect(parseAntigravityStreamLine("\u001b[32mloading\u001b[0m")).toBeUndefined();
    expect(antigravityToolItemType("search_web")).toBe("web_search");
    expect(antigravityToolItemType("read_url_content")).toBe("web_search");
    expect(antigravityToolItemType("invoke_subagent")).toBe("collab_agent_tool_call");
  });

  it("preserves result usage and resumable conversation identity", () => {
    const event = parseAntigravityStreamLine(
      JSON.stringify({
        event: "result",
        result: {
          conversation_id: "conversation-2",
          status: "SUCCESS",
          response: "done",
          usage: { total_tokens: 42 },
        },
      }),
    );
    expect(event?.event).toBe("result");
    expect(event?.event === "result" ? event.result?.usage?.total_tokens : undefined).toBe(42);
  });
});
