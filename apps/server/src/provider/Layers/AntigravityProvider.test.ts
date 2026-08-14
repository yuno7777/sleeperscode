import * as NodeServices from "@effect/platform-node/NodeServices";
import { AntigravitySettings } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  checkAntigravityProviderStatus,
  makePendingAntigravityProvider,
  parseAntigravityModels,
} from "./AntigravityProvider.ts";

const decodeSettings = Schema.decodeSync(AntigravitySettings);

describe("AntigravityProvider", () => {
  it("parses the documented model listing without duplicates or headings", () => {
    expect(
      parseAntigravityModels(
        [
          "gemini-3.6-flash-high",
          "claude-sonnet-4-6",
          "gemini-3.6-flash-high",
          "Available models:",
        ].join("\n"),
      ).map((model) => model.slug),
    ).toEqual(["gemini-3.6-flash-high", "claude-sonnet-4-6"]);
  });

  it("does not advertise a separate effort option for effort-qualified model slugs", () => {
    const [model] = parseAntigravityModels("gemini-3.7-flash-high");
    expect(model?.capabilities?.optionDescriptors).toEqual([]);
  });

  it.effect("keeps disabled Antigravity installed state separate from integration", () =>
    Effect.gen(function* () {
      const snapshot = yield* makePendingAntigravityProvider(decodeSettings({ enabled: false }));
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
    }),
  );
});

it.layer(NodeServices.layer)("checkAntigravityProviderStatus", (it) => {
  it.effect("reports a missing agy executable without crashing the provider registry", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkAntigravityProviderStatus(
        decodeSettings({ binaryPath: "/definitely/not/installed/agy" }),
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("not installed");
    }),
  );
});
