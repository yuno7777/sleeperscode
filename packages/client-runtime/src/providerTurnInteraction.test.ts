import { describe, expect, it } from "vitest";

import { canSubmitProviderFollowUp, providerTurnInteraction } from "./providerTurnInteraction.ts";

describe("providerTurnInteraction", () => {
  it("does not overstate an unknown driver", () => {
    expect(providerTurnInteraction("community-agent").kind).toBe("unknown");
  });

  it("keeps Antigravity follow-ups unavailable while a turn runs", () => {
    expect(providerTurnInteraction("antigravity").kind).toBe("unsupported");
  });

  it.each(["claudeAgent", "cursor", "grok", "opencode"])(
    "marks %s as steering",
    (driver: string) => {
      expect(providerTurnInteraction(driver).kind).toBe("steer");
    },
  );

  it("marks Codex follow-ups as queued", () => {
    expect(providerTurnInteraction("codex").kind).toBe("queue");
  });

  it("blocks an unsupported active-provider submission, including keyboard submission", () => {
    expect(
      canSubmitProviderFollowUp({
        hasContent: true,
        isTurnActive: true,
        interaction: providerTurnInteraction("antigravity"),
      }),
    ).toBe(false);
    expect(
      canSubmitProviderFollowUp({
        hasContent: true,
        isTurnActive: false,
        interaction: providerTurnInteraction("antigravity"),
      }),
    ).toBe(true);
  });
});
