import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveAgentStatusLevels,
  selectRoutableAgents,
  ServerConfig,
  ServerProvider,
  ServerProviders,
  ServerUpsertKeybindingResult,
  summariseAgentHealth,
} from "./server.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);
const decodeServerProviders = Schema.decodeUnknownSync(ServerProviders);
const decodeUpsertKeybindingResult = Schema.decodeUnknownSync(ServerUpsertKeybindingResult);
const decodeAvailableEditors = Schema.decodeUnknownSync(ServerConfig.fields.availableEditors);

const baseProviderSnapshot = {
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [],
};

describe("deriveAgentStatusLevels", () => {
  const levelsFor = (overrides: Record<string, unknown>) =>
    deriveAgentStatusLevels(decodeServerProvider({ ...baseProviderSnapshot, ...overrides }));

  it("routes an installed, enabled, authenticated provider", () => {
    expect(levelsFor({})).toEqual({
      integrated: true,
      routable: true,
      routingBlockers: [],
    });
  });

  it("keeps a disabled provider integrated but not routable", () => {
    expect(levelsFor({ enabled: false })).toEqual({
      integrated: true,
      routable: false,
      routingBlockers: ["disabled"],
    });
  });

  it("treats unknown authentication as a routing blocker", () => {
    expect(levelsFor({ auth: { status: "unknown" } })).toEqual({
      integrated: true,
      routable: false,
      routingBlockers: ["unauthenticated"],
    });
  });

  it("is neither integrated nor routable when the provider reports an error", () => {
    expect(levelsFor({ status: "error" })).toEqual({
      integrated: false,
      routable: false,
      routingBlockers: ["provider_error"],
    });
  });

  it("reports every blocker at once for an unavailable driver", () => {
    expect(
      levelsFor({
        availability: "unavailable",
        installed: false,
        enabled: false,
        auth: { status: "unknown" },
      }),
    ).toEqual({
      integrated: false,
      routable: false,
      routingBlockers: ["driver_unavailable", "not_installed", "disabled", "unauthenticated"],
    });
  });

  it("treats an absent availability field as available", () => {
    expect(levelsFor({ availability: undefined }).integrated).toBe(true);
  });
});

describe("agent health", () => {
  const snapshot = (overrides: Record<string, unknown>) =>
    decodeServerProvider({ ...baseProviderSnapshot, ...overrides });

  it("summarises one agent into router-facing health", () => {
    expect(summariseAgentHealth(snapshot({}))).toEqual({
      instanceId: "codex",
      driver: "codex",
      integrated: true,
      routable: true,
      routingBlockers: [],
      version: "1.0.0",
      updateAvailable: false,
      checkedAt: "2026-04-10T00:00:00.000Z",
    });
  });

  it("reports an update when the provider says it is behind", () => {
    const health = summariseAgentHealth(
      snapshot({
        versionAdvisory: {
          status: "behind_latest",
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          updateCommand: null,
          checkedAt: null,
          message: null,
        },
      }),
    );
    expect(health.updateAvailable).toBe(true);
  });

  it("does not report an update when the advisory status is unknown", () => {
    const health = summariseAgentHealth(
      snapshot({
        versionAdvisory: {
          status: "unknown",
          currentVersion: null,
          latestVersion: null,
          updateCommand: null,
          checkedAt: null,
          message: null,
        },
      }),
    );
    expect(health.updateAvailable).toBe(false);
  });

  it("splits eligible agents from excluded ones with reasons", () => {
    const result = selectRoutableAgents([
      snapshot({ instanceId: "codex", driver: "codex" }),
      snapshot({ instanceId: "claude", driver: "claude", enabled: false }),
      snapshot({ instanceId: "cursor", driver: "cursor", installed: false }),
    ]);

    expect(result.eligible.map((agent) => agent.instanceId)).toEqual(["codex"]);
    expect(result.excluded.map((agent) => [agent.instanceId, agent.routingBlockers])).toEqual([
      ["claude", ["disabled"]],
      ["cursor", ["not_installed"]],
    ]);
  });

  it("preserves input order rather than ranking healthy agents", () => {
    const result = selectRoutableAgents([
      snapshot({ instanceId: "cursor", driver: "cursor" }),
      snapshot({ instanceId: "codex", driver: "codex" }),
      snapshot({ instanceId: "claude", driver: "claude" }),
    ]);
    expect(result.eligible.map((agent) => agent.instanceId)).toEqual(["cursor", "codex", "claude"]);
  });

  it("returns no eligible agents when every candidate is blocked", () => {
    const result = selectRoutableAgents([
      snapshot({ instanceId: "codex", status: "error" }),
      snapshot({ instanceId: "claude", auth: { status: "unknown" } }),
    ]);
    expect(result.eligible).toEqual([]);
    expect(result.excluded).toHaveLength(2);
  });

  it("handles an empty configuration", () => {
    expect(selectRoutableAgents([])).toEqual({ eligible: [], excluded: [] });
  });
});

describe("ServerProvider", () => {
  it("defaults capability arrays when decoding provider snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.slashCommands).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.versionAdvisory).toBeUndefined();
    expect(parsed.updateState).toBeUndefined();
  });

  it("defaults one-click update support when decoding older advisory snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        updateCommand: "npm install -g @openai/codex@latest",
        checkedAt: "2026-04-10T00:00:00.000Z",
        message: "Update available.",
      },
    });

    expect(parsed.versionAdvisory?.canUpdate).toBe(false);
  });

  it("decodes continuation group metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex_personal",
      driver: "codex",
      continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.continuation?.groupKey).toBe("codex:home:/Users/julius/.codex");
  });

  it("decodes optional legacy model metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          isLegacy: true,
          capabilities: null,
        },
      ],
    });

    expect(parsed.models[0]?.isLegacy).toBe(true);
  });
});

describe("server config forward compatibility", () => {
  it("drops config issues with kinds this build does not know", () => {
    const parsed = decodeUpsertKeybindingResult({
      keybindings: [],
      issues: [
        { kind: "keybindings.invalid-entry", message: "Bad entry", index: 2 },
        { kind: "keybindings.future-issue", message: "From a newer server" },
      ],
    });

    expect(parsed.issues).toEqual([
      { kind: "keybindings.invalid-entry", message: "Bad entry", index: 2 },
    ]);
  });

  it("drops editor ids this build does not know", () => {
    const parsed = decodeAvailableEditors(["zed", "some-future-editor", "vscode"]);

    expect(parsed).toEqual(["zed", "vscode"]);
  });

  // A provider status this build has never seen (a new ServerProviderState,
  // ServerProviderAuthStatus, etc. member) previously failed the whole
  // `providers` array, taking every other provider down with it and, since
  // `providers` sits inside `ServerConfig`, failing the whole config decode —
  // an older client would drop its connection over one provider it can't
  // render. Dropping just that element keeps every other provider working.
  it("drops providers this build cannot decode instead of failing the whole array", () => {
    const decodedBase = decodeServerProvider(baseProviderSnapshot);

    const parsed = decodeServerProviders([
      baseProviderSnapshot,
      { ...baseProviderSnapshot, instanceId: "future", status: "some-future-status" },
    ]);

    expect(parsed).toEqual([decodedBase]);
  });
});
