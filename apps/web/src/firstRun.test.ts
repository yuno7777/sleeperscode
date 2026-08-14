import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  orderFirstRunProviders,
  shouldPresentFirstRun,
  summarizeFirstRunProviders,
} from "./firstRun";

const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  displayName: "Codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-14T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

describe("first-run onboarding logic", () => {
  it("waits for an authenticated primary server and never reopens after completion", () => {
    expect(shouldPresentFirstRun({ enabled: true, serverReady: true, completed: false })).toBe(
      true,
    );
    expect(shouldPresentFirstRun({ enabled: false, serverReady: true, completed: false })).toBe(
      false,
    );
    expect(shouldPresentFirstRun({ enabled: true, serverReady: false, completed: false })).toBe(
      false,
    );
    expect(shouldPresentFirstRun({ enabled: true, serverReady: true, completed: true })).toBe(
      false,
    );
  });

  it("keeps installation, authentication, and routing evidence separate", () => {
    expect(
      summarizeFirstRunProviders([
        provider(),
        provider({
          instanceId: ProviderInstanceId.make("claude"),
          driver: ProviderDriverKind.make("claudeAgent"),
          displayName: "Claude Code",
          auth: { status: "unauthenticated" },
        }),
        provider({
          instanceId: ProviderInstanceId.make("opencode"),
          driver: ProviderDriverKind.make("opencode"),
          displayName: "OpenCode",
          installed: false,
          enabled: false,
          status: "warning",
          auth: { status: "unknown" },
        }),
      ]),
    ).toEqual({ total: 3, installed: 2, authenticated: 1, routable: 1 });
  });

  it("puts routable and installed agents before unavailable ones", () => {
    const ordered = orderFirstRunProviders([
      provider({
        instanceId: ProviderInstanceId.make("opencode"),
        driver: ProviderDriverKind.make("opencode"),
        displayName: "OpenCode",
        installed: false,
        enabled: false,
        status: "warning",
        auth: { status: "unknown" },
      }),
      provider(),
      provider({
        instanceId: ProviderInstanceId.make("claude"),
        driver: ProviderDriverKind.make("claudeAgent"),
        displayName: "Claude Code",
        auth: { status: "unauthenticated" },
      }),
    ]);

    expect(ordered.map((entry) => entry.displayName)).toEqual(["Codex", "Claude Code", "OpenCode"]);
  });
});
