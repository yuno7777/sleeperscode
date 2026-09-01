import { describe, expect, it } from "vite-plus/test";

import { classifyAttentionThread } from "./attention.ts";

const thread = {
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  latestTurn: { state: "completed" },
  session: { status: "error" },
} as Parameters<typeof classifyAttentionThread>[0];

describe("classifyAttentionThread", () => {
  it("keeps direct provider input ahead of stale recovery state", () => {
    expect(classifyAttentionThread({ ...thread, hasPendingApprovals: true }, false)?.kind).toBe(
      "approval",
    );
  });

  it("only flags an unverified completed thread when no newer attention applies", () => {
    expect(classifyAttentionThread({ ...thread, session: null }, false)?.kind).toBe("verification");
    expect(classifyAttentionThread({ ...thread, session: null }, true)).toBeNull();
  });
});
