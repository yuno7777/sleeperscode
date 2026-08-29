import {
  ProviderDriverKind,
  ProviderInstanceId,
  RouterDecision,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildRouterContext,
  explainRouterDecisionReason,
  planRouterDecision,
  ROUTER_DECISION_REASON_EXPLANATIONS,
} from "./router.ts";
import { classifyTaskProfile } from "./taskProfile.ts";

const NOW = "2026-08-09T00:00:00.000Z";
const encodeDecisionJson = Schema.encodeSync(Schema.fromJsonString(RouterDecision));

const provider = (input: {
  readonly instanceId: string;
  readonly driver?: string;
  readonly enabled?: boolean;
  readonly installed?: boolean;
  readonly status?: ServerProvider["status"];
  readonly auth?: ServerProvider["auth"]["status"];
}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(input.instanceId),
  driver: ProviderDriverKind.make(input.driver ?? input.instanceId),
  enabled: input.enabled ?? true,
  installed: input.installed ?? true,
  version: null,
  status: input.status ?? "ready",
  auth: { status: input.auth ?? "authenticated" },
  checkedAt: NOW,
  models: [],
  slashCommands: [],
  skills: [],
});

const selection = (instanceId: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model: "test-model",
  options: [],
});

describe("buildRouterContext", () => {
  it("sorts candidates deterministically and retains every eligibility blocker", () => {
    const context = buildRouterContext([
      provider({ instanceId: "zeta", installed: false, enabled: false, auth: "unknown" }),
      provider({ instanceId: "alpha" }),
    ]);

    expect(context).toEqual({
      version: 1,
      limited: false,
      candidates: [
        { instanceId: "alpha", driver: "alpha", eligible: true, blockers: [] },
        {
          instanceId: "zeta",
          driver: "zeta",
          eligible: false,
          blockers: ["not_installed", "disabled", "unauthenticated"],
        },
      ],
    });
  });

  it("bounds persisted candidate context", () => {
    const context = buildRouterContext(
      Array.from({ length: 65 }, (_, index) =>
        provider({ instanceId: `provider${String(index).padStart(2, "0")}` }),
      ),
    );

    expect(context.candidates).toHaveLength(64);
    expect(context.limited).toBe(true);
  });
});

describe("router decision explanations", () => {
  it("provides concise copy for every reason without exposing raw reason codes", () => {
    for (const [reason, explanation] of Object.entries(ROUTER_DECISION_REASON_EXPLANATIONS)) {
      expect(explanation.label).not.toBe(reason);
      expect(explanation.label.length).toBeGreaterThan(3);
      expect(explanation.detail.endsWith(".")).toBe(true);
    }
    expect(explainRouterDecisionReason("shadow-mode-no-override")).toEqual({
      label: "Shadow mode only",
      detail: "The router recorded evidence but did not change the user's selection.",
    });
  });
});

describe("planRouterDecision", () => {
  it("retains an eligible explicit turn selection without applying routing", () => {
    const taskProfile = classifyTaskProfile({ text: "Implement and test the API." });
    const context = buildRouterContext([
      provider({ instanceId: "claudeAgent" }),
      provider({ instanceId: "codex" }),
    ]);

    const decision = planRouterDecision({
      taskProfile,
      context,
      effectiveSelection: selection("codex"),
      selectionSource: "turn-override",
    });

    expect(decision.applied).toBe(false);
    expect(decision.execution.style).toBe("standard");
    expect(decision.recommendation).toEqual({ outcome: "retain-current", instanceId: "codex" });
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "turn-override-authoritative",
        "selected-provider-eligible",
        "shadow-mode-no-override",
      ]),
    );
  });

  it("identifies one eligible alternative but leaves the thread selection authoritative", () => {
    const taskProfile = classifyTaskProfile({ text: "Review the authentication migration." });
    const context = buildRouterContext([
      provider({ instanceId: "claudeAgent" }),
      provider({ instanceId: "codex", auth: "unknown" }),
    ]);

    const decision = planRouterDecision({
      taskProfile,
      context,
      effectiveSelection: selection("codex"),
      selectionSource: "thread",
    });

    expect(decision.selectedEligibility).toBe("excluded");
    expect(decision.recommendation).toEqual({
      outcome: "single-eligible-alternative",
      instanceId: "claudeAgent",
    });
    expect(decision.execution.review).toBe("required");
    expect(decision.applied).toBe(false);
  });

  it("refuses to rank multiple eligible providers without outcome evidence", () => {
    const taskProfile = classifyTaskProfile({
      text: "Research the latest official API documentation and compare it.",
    });
    const context = buildRouterContext([
      provider({ instanceId: "claudeAgent" }),
      provider({ instanceId: "codex" }),
    ]);

    const decision = planRouterDecision({
      taskProfile,
      context,
      effectiveSelection: selection("missing"),
      selectionSource: "thread",
    });

    expect(decision.recommendation).toEqual({ outcome: "insufficient-evidence" });
    expect(decision.execution.research).toBe(true);
    expect(decision.reasons).toContain("multiple-eligible-candidates");
  });

  it("does not claim no candidates exist when provider context is limited", () => {
    const decision = planRouterDecision({
      taskProfile: classifyTaskProfile({ text: "Implement the API." }),
      context: { version: 1, candidates: [], limited: true },
      effectiveSelection: selection("codex"),
      selectionSource: "thread",
    });

    expect(decision.recommendation).toEqual({ outcome: "insufficient-evidence" });
    expect(decision.reasons).toContain("context-limited");
    expect(decision.reasons).not.toContain("no-eligible-candidates");
  });

  it("recommends lean execution only for a bounded low-risk trivial change", () => {
    const decision = planRouterDecision({
      taskProfile: classifyTaskProfile({ text: "Change the button radius to 12px." }),
      context: buildRouterContext([provider({ instanceId: "codex" })]),
      effectiveSelection: selection("codex"),
      selectionSource: "thread",
    });

    expect(decision.execution.style).toBe("lean");
    expect(decision.reasons).toContain("lean-execution-recommended");
  });

  it("never copies prompt content into a decision", () => {
    const privateMarker = "PRIVATE_ROUTER_MARKER_8e03f9";
    const taskProfile = classifyTaskProfile({ text: `Implement the API. ${privateMarker}` });
    const decision = planRouterDecision({
      taskProfile,
      context: buildRouterContext([provider({ instanceId: "codex" })]),
      effectiveSelection: selection("codex"),
      selectionSource: "thread",
    });

    expect(encodeDecisionJson(decision)).not.toContain(privateMarker);
  });
});
