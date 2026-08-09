import * as NodeServices from "@effect/platform-node/NodeServices";
import { TaskRepositoryEvidence } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as TaskRepositoryProfiler from "./TaskRepositoryProfiler.ts";

const encodeEvidenceJson = Schema.encodeSync(Schema.fromJsonString(TaskRepositoryEvidence));

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-task-profile-" });
});

const writeRootFile = Effect.fn("TaskRepositoryProfilerTest.writeRootFile")(function* (
  cwd: string,
  name: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(path.join(cwd, name), contents);
});

it.layer(NodeServices.layer)("TaskRepositoryProfiler", (it) => {
  it.effect("collects bounded root markers without exposing paths or contents", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir;
      yield* writeRootFile(
        cwd,
        "package.json",
        `{
          "private": true,
          "workspaces": ["apps/*"],
          "dependencies": { "react": "latest", "vite": "latest" },
          "devDependencies": { "vitest": "latest", "@playwright/test": "latest" }
        }`,
      );
      yield* writeRootFile(cwd, "tsconfig.json", "{}");
      yield* writeRootFile(cwd, "pnpm-workspace.yaml", "packages:\n  - apps/*\n");
      yield* writeRootFile(cwd, "Cargo.toml", "[workspace]\nmembers = []\n");

      const evidence = yield* TaskRepositoryProfiler.getTaskRepositoryEvidence(cwd);

      expect(evidence).toEqual({
        version: 1,
        source: "root-markers",
        markers: ["package-json", "tsconfig-json", "pnpm-workspace", "cargo-toml"],
        languages: ["javascript", "typescript", "rust"],
        frameworks: ["react", "vite"],
        testRunners: ["cargo", "vitest", "playwright"],
        workspace: "monorepo",
        limited: false,
      });
      const encoded = encodeEvidenceJson(evidence);
      expect(encoded).not.toContain(cwd);
      expect(encoded).not.toContain("apps/*");
    }),
  );

  it.effect("reports an oversized manifest as limited without reading its contents", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir;
      yield* writeRootFile(
        cwd,
        "package.json",
        `${" ".repeat(129 * 1_024)}\n{\"dependencies\":{\"react\":\"latest\"}}`,
      );

      const evidence = yield* TaskRepositoryProfiler.getTaskRepositoryEvidence(cwd);

      expect(evidence.markers).toEqual(["package-json"]);
      expect(evidence.frameworks).toEqual([]);
      expect(evidence.limited).toBe(true);
    }),
  );

  it.effect("returns limited empty evidence for a missing root", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir;

      expect(yield* TaskRepositoryProfiler.getTaskRepositoryEvidence(`${cwd}-missing`)).toEqual({
        version: 1,
        source: "root-markers",
        markers: [],
        languages: [],
        frameworks: [],
        testRunners: [],
        workspace: "unknown",
        limited: true,
      });
    }),
  );

  it.effect("reuses cached evidence until the five-minute ttl expires", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir;
      yield* writeRootFile(cwd, "package.json", '{"dependencies":{"react":"latest"}}');

      const first = yield* TaskRepositoryProfiler.getTaskRepositoryEvidence(cwd);
      yield* writeRootFile(cwd, "package.json", '{"dependencies":{"vue":"latest"}}');
      const cached = yield* TaskRepositoryProfiler.getTaskRepositoryEvidence(cwd);
      yield* TestClock.adjust("6 minutes");
      const refreshed = yield* TaskRepositoryProfiler.getTaskRepositoryEvidence(cwd);

      expect(first.frameworks).toEqual(["react"]);
      expect(cached).toEqual(first);
      expect(refreshed.frameworks).toEqual(["vue"]);
    }),
  );
});
