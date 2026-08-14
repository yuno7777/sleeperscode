import { describe, expect, it } from "vite-plus/test";

import { openCodeInlineConfigContent } from "./opencodeRuntime.ts";

describe("openCodeInlineConfigContent", () => {
  it("uses an inline provider config supplied to the managed OpenCode process", () => {
    const content = '{"provider":{"sleepers-ollama":{"models":{}}}}';
    expect(openCodeInlineConfigContent({ OPENCODE_CONFIG_CONTENT: content })).toBe(content);
  });

  it("keeps the managed runtime deterministic when no inline config is supplied", () => {
    expect(openCodeInlineConfigContent(undefined)).toBe("{}");
    expect(openCodeInlineConfigContent({ PATH: "C:\\Tools" })).toBe("{}");
  });
});
