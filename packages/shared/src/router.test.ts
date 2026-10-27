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
  buildStructuredHandoffPacket,
  explainRouterDecisionReason,
  inspectThreadContext,
  planAgentArenaRun,
  planRouterDecision,
  resolveAdaptiveRoute,
  ROUTER_DECISION_REASON_EXPLANATIONS,
  scoreRouterCandidates,
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

describe("scoreRouterCandidates and resolveAdaptiveRoute", () => {
  it("ranks deep reasoning drivers first in deep mode and applies auto routing when enabled", () => {
    const taskProfile = classifyTaskProfile({
      text: "Debug the authentication regression and review security boundaries across all files.",
    });
    const context = buildRouterContext([
      provider({ instanceId: "opencode", driver: "opencode" }),
      provider({ instanceId: "claudeAgent", driver: "claudeAgent" }),
      provider({ instanceId: "codex", driver: "codex", enabled: false }),
    ]);

    const scored = scoreRouterCandidates({
      taskProfile,
      context,
      mode: "deep",
    });

    expect(scored[0]?.instanceId).toBe("claudeAgent");
    expect(scored[0]?.score).toBeGreaterThan(scored[1]?.score ?? 0);
    expect(scored.find((entry) => entry.instanceId === "codex")?.score).toBe(0);

    const route = resolveAdaptiveRoute({
      mode: "auto",
      taskProfile,
      context,
      effectiveSelection: selection("opencode"),
    });

    expect(route.applied).toBe(true);
    expect(route.selectedInstanceId).toBe("claudeAgent");
  });

  it("favors lean drivers in lean mode and never overrides in shadow mode", () => {
    const taskProfile = classifyTaskProfile({ text: "Change the button padding to 8px." });
    const context = buildRouterContext([
      provider({ instanceId: "claudeAgent", driver: "claudeAgent" }),
      provider({ instanceId: "opencode", driver: "opencode" }),
    ]);

    const leanRoute = resolveAdaptiveRoute({
      mode: "lean",
      taskProfile,
      context,
      effectiveSelection: selection("claudeAgent"),
    });
    expect(leanRoute.executionStyle).toBe("lean");
    expect(leanRoute.selectedInstanceId).toBe("opencode");
    expect(leanRoute.applied).toBe(true);

    const shadowRoute = resolveAdaptiveRoute({
      mode: "shadow",
      taskProfile,
      context,
      effectiveSelection: selection("claudeAgent"),
    });
    expect(shadowRoute.applied).toBe(false);
    expect(shadowRoute.selectedInstanceId).toBe("claudeAgent");
  });
});

describe("inspectThreadContext, buildStructuredHandoffPacket, and planAgentArenaRun", () => {
  it("computes context token distribution, referenced files, and window health", () => {
    const inspection = inspectThreadContext({
      messages: [
        { role: "user", text: "Update apps/web/src/App.tsx and packages/shared/src/router.ts" },
        { role: "assistant", text: "Updated App.tsx and verified tests." },
      ],
      activityCount: 4,
      checkpointFiles: ["apps/web/src/App.tsx"],
      draftText: "Also check vitest.config.ts",
      windowLimitTokens: 4_000,
    });

    expect(inspection.userTokens).toBeGreaterThan(0);
    expect(inspection.assistantTokens).toBeGreaterThan(0);
    expect(inspection.activityTokens).toBe(180);
    expect(inspection.referencedFiles).toEqual([
      "apps/web/src/App.tsx",
      "packages/shared/src/router.ts",
      "App.tsx",
      "vitest.config.ts",
    ]);
    expect(inspection.checkpointFiles).toEqual(["apps/web/src/App.tsx"]);
    expect(inspection.health).toBe("healthy");
  });

  it("compiles a structured cross-provider handoff packet and 2-provider Arena plan", () => {
    const packet = buildStructuredHandoffPacket({
      threadTitle: "Refactor auth middleware",
      branch: "feat/auth",
      targetInstanceId: ProviderInstanceId.make("codex"),
      targetDriver: ProviderDriverKind.make("codex"),
      messages: [{ role: "user", text: "Fix token refresh race." }],
      changedFiles: ["apps/server/src/auth.ts"],
      verificationSummary: ["vp test run auth.test.ts · exit 0"],
    });

    expect(packet.title).toBe("Handoff (codex): Refactor auth middleware");
    expect(packet.prompt).toContain("apps/server/src/auth.ts");
    expect(packet.prompt).toContain("vp test run auth.test.ts · exit 0");

    const arena = planAgentArenaRun({
      prompt: "Implement rate limiter middleware and unit tests.",
      baseTitle: "Rate limiter",
      context: buildRouterContext([
        provider({ instanceId: "claudeAgent", driver: "claudeAgent" }),
        provider({ instanceId: "codex", driver: "codex" }),
        provider({ instanceId: "opencode", driver: "opencode" }),
      ]),
      mode: "deep",
    });

    expect(arena).toHaveLength(2);
    expect(arena[0]?.slot).toBe("A");
    expect(arena[1]?.slot).toBe("B");
    expect(arena[0]?.driver).not.toBe(arena[1]?.driver);
  });
});
