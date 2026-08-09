import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { RouterContext, RouterDecision } from "./router.ts";

const decodeContext = Schema.decodeUnknownSync(RouterContext);
const decodeDecision = Schema.decodeUnknownSync(RouterDecision);

const validDecision = {
  version: 1,
  mode: "shadow",
  applied: false,
  effectiveSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
  selectionSource: "thread",
  selectedEligibility: "eligible",
  recommendation: { outcome: "retain-current", instanceId: "codex" },
  candidates: [{ instanceId: "codex", driver: "codex", eligible: true, blockers: [] }],
  execution: {
    tools: ["filesystem", "shell"],
    collaboration: "single-worker",
    review: "none",
    research: false,
  },
  reasons: [
    "thread-selection-authoritative",
    "selected-provider-eligible",
    "shadow-mode-no-override",
  ],
} as const;

describe("router contracts", () => {
  it("decodes bounded candidate context and a shadow decision", () => {
    expect(
      decodeContext({
        version: 1,
        candidates: validDecision.candidates,
        limited: false,
      }),
    ).toEqual({ version: 1, candidates: validDecision.candidates, limited: false });
    expect(decodeDecision(validDecision)).toEqual(validDecision);
  });

  it("does not permit version 1 decisions to claim they were applied", () => {
    expect(() => decodeDecision({ ...validDecision, applied: true })).toThrow();
  });

  it("rejects free-form reasons that could carry prompt content", () => {
    expect(() =>
      decodeDecision({ ...validDecision, reasons: ["because-user-said-secret"] }),
    ).toThrow();
  });
});
