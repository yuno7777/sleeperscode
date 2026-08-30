import * as NodeServices from "@effect/platform-node/NodeServices";
import { AntigravitySettings } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
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

  it.effect("does not mark an installed but failing launcher as ready", () =>
    Effect.gen(function* () {
      const secretStderr = "broken agy install: secret-token-value";
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-antigravity-version-" });
          const isWindows = (yield* HostProcessPlatform) === "win32";
          const agyPath = path.join(dir, isWindows ? "agy.cmd" : "agy");
          yield* fs.writeFileString(
            agyPath,
            isWindows
              ? ["@echo off", `echo ${secretStderr} 1>&2`, "exit /b 2", ""].join("\r\n")
              : ["#!/bin/sh", `printf '%s\\n' '${secretStderr}' >&2`, "exit 2", ""].join("\n"),
          );
          if (!isWindows) yield* fs.chmod(agyPath, 0o755);
          return yield* checkAntigravityProviderStatus(
            decodeSettings({ enabled: true, binaryPath: agyPath }),
          );
        }),
      );

      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toBe("Antigravity CLI is installed but failed to run.");
      expect(snapshot.message).not.toContain(secretStderr);
    }),
  );
});
