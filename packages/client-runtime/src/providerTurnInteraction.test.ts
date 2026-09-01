import { describe, expect, it } from "vitest";

import { providerTurnInteraction } from "./providerTurnInteraction.ts";

describe("providerTurnInteraction", () => {
  it("does not overstate an unknown driver", () => {
    expect(providerTurnInteraction("community-agent").kind).toBe("unknown");
  });

  it("keeps Antigravity follow-ups unavailable while a turn runs", () => {
    expect(providerTurnInteraction("antigravity").kind).toBe("unsupported");
  });

  it.each(["claudeAgent", "cursor", "grok", "opencode"])("marks %s as steering", (driver) => {
    expect(providerTurnInteraction(driver).kind).toBe("steer");
  });

  it("marks Codex follow-ups as queued", () => {
    expect(providerTurnInteraction("codex").kind).toBe("queue");
  });
});
