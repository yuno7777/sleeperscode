import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { TaskOutcomeObservation } from "./taskOutcome.ts";

const decode = Schema.decodeUnknownSync(TaskOutcomeObservation);

describe("task outcome contracts", () => {
  it("accepts content-free provider terminal evidence", () => {
    expect(
      decode({
        version: 1,
        terminalState: "completed",
        provider: { driver: "codex", instanceId: "codex-work" },
        observedAt: "2026-08-12T12:00:00.000Z",
      }),
    ).toEqual({
      version: 1,
      terminalState: "completed",
      provider: { driver: "codex", instanceId: "codex-work" },
      observedAt: "2026-08-12T12:00:00.000Z",
    });
  });

  it("does not admit free-form success, error, or prompt fields", () => {
    expect(
      decode({
        version: 1,
        terminalState: "failed",
        provider: { driver: "claudeAgent" },
        observedAt: "2026-08-12T12:00:00.000Z",
        success: true,
        error: "secret-bearing provider output",
        prompt: "private task",
      }),
    ).toEqual({
      version: 1,
      terminalState: "failed",
      provider: { driver: "claudeAgent" },
      observedAt: "2026-08-12T12:00:00.000Z",
    });
  });

  it("rejects invented quality labels", () => {
    expect(() =>
      decode({
        version: 1,
        terminalState: "successful",
        provider: { driver: "codex" },
        observedAt: "2026-08-12T12:00:00.000Z",
      }),
    ).toThrow();
  });
});
