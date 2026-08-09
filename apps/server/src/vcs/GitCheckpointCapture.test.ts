/**
 * Differential tests for checkpoint capture.
 *
 * Capture reuses a cached index to keep `git add -A` incremental. The cache must
 * never change what is captured, so every scenario asserts the resulting tree oid
 * equals the one produced by the uncached sequence (`read-tree HEAD` into a fresh
 * index, then `add -A`). A wrong tree here is silent data loss at restore time.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import { CheckpointRef } from "@t3tools/contracts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsDriver from "./VcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";

const TestLayer = Layer.mergeAll(GitVcsDriver.vcsLayer, GitVcsDriver.layer).pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-git-checkpoint-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const git = (cwd: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    return yield* driver.execute({
      operation: "GitCheckpointCapture.test.git",
      cwd,
      args,
      timeoutMs: 30_000,
      ...(env ? { env } : {}),
    });
  });

const write = (cwd: string, relativePath: string, contents: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolute = path.join(cwd, relativePath);
    yield* fileSystem.makeDirectory(path.dirname(absolute), { recursive: true });
    yield* fileSystem.writeFileString(absolute, contents);
  });

const remove = (cwd: string, relativePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(cwd, relativePath), { force: true });
  });

const makeRepository = (cwd: string) =>
  Effect.gen(function* () {
    yield* git(cwd, ["init", "--quiet"]);
    yield* git(cwd, ["config", "user.email", "test@test.invalid"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* git(cwd, ["config", "core.autocrlf", "false"]);
  });

const checkpointCacheIndexName = (cwd: string) => {
  const cacheScope = NodeCrypto.createHash("sha256")
    .update(globalThis.process.platform === "win32" ? cwd.toLowerCase() : cwd)
    .digest("hex")
    .slice(0, 16);
  return `t3-checkpoint-index-cache-${cacheScope}`;
};

let referenceIndexCounter = 0;

/** The tree the current uncached sequence would produce, computed in isolation. */
const referenceTreeOid = (cwd: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    referenceIndexCounter += 1;
    const commonDirResult = yield* git(cwd, ["rev-parse", "--git-common-dir"]);
    const rawCommonDir = commonDirResult.stdout.trim();
    const commonDir = path.isAbsolute(rawCommonDir)
      ? rawCommonDir
      : path.resolve(cwd, rawCommonDir);
    const indexPath = path.join(commonDir, `reference-index-${referenceIndexCounter}`);
    const env = { ...process.env, GIT_INDEX_FILE: indexPath };
    const head = yield* git(cwd, ["rev-parse", "--verify", "HEAD"], env).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.orElseSucceed(() => ""),
    );
    if (head.length > 0) {
      yield* git(cwd, ["read-tree", "HEAD"], env);
    }
    yield* git(cwd, ["add", "-A", "--", "."], env);
    const tree = yield* git(cwd, ["write-tree"], env);
    yield* fileSystem.remove(indexPath, { force: true }).pipe(Effect.ignore);
    return tree.stdout.trim();
  });

const capturedTreeOid = (cwd: string, ref: string) =>
  git(cwd, ["rev-parse", `${ref}^{tree}`]).pipe(Effect.map((result) => result.stdout.trim()));

/** Captures through the driver, then compares against the uncached reference. */
const assertCaptureMatchesReference = (cwd: string, label: string) =>
  Effect.gen(function* () {
    const driver = yield* VcsDriver.VcsDriver;
    if (!driver.checkpoints) throw new Error("Git driver must expose checkpoint operations.");
    const ref = `refs/t3-test/${label}`;
    const expected = yield* referenceTreeOid(cwd);
    yield* driver.checkpoints.captureCheckpoint({
      cwd,
      checkpointRef: CheckpointRef.make(ref),
    });
    const actual = yield* capturedTreeOid(cwd, ref);
    assert.strictEqual(actual, expected, `${label}: captured tree must match the uncached tree`);
  });

const withRepository = <A, E, R>(
  body: (cwd: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-checkpoint-diff-" });
    return yield* body(directory);
  }).pipe(Effect.scoped) as Effect.Effect<A, E | Error, R | FileSystem.FileSystem | Path.Path>;

describe("checkpoint capture stays equivalent when the index cache is reused", () => {
  it.effect("captures repeatedly across edits, additions, and deletions", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        yield* makeRepository(cwd);
        yield* write(cwd, "src/a.ts", "export const a = 1;\n");
        yield* write(cwd, "src/b.ts", "export const b = 1;\n");
        yield* git(cwd, ["add", "-A"]);
        yield* git(cwd, ["commit", "--quiet", "-m", "base"]);

        // First capture seeds the cache; the rest must reuse it and still match.
        yield* assertCaptureMatchesReference(cwd, "clean");

        yield* write(cwd, "src/a.ts", "export const a = 2;\n");
        yield* assertCaptureMatchesReference(cwd, "modified");

        yield* write(cwd, "src/c.ts", "export const c = 3;\n");
        yield* assertCaptureMatchesReference(cwd, "added");

        yield* remove(cwd, "src/b.ts");
        yield* assertCaptureMatchesReference(cwd, "deleted");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("re-seeds when HEAD moves between captures", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        yield* makeRepository(cwd);
        yield* write(cwd, "src/a.ts", "export const a = 1;\n");
        yield* git(cwd, ["add", "-A"]);
        yield* git(cwd, ["commit", "--quiet", "-m", "base"]);
        yield* assertCaptureMatchesReference(cwd, "before-head-move");

        // A new commit invalidates the cached index's recorded HEAD.
        yield* write(cwd, "src/d.ts", "export const d = 4;\n");
        yield* git(cwd, ["add", "-A"]);
        yield* git(cwd, ["commit", "--quiet", "-m", "second"]);
        yield* assertCaptureMatchesReference(cwd, "after-head-move");

        // A branch switch moves HEAD backwards.
        yield* git(cwd, ["checkout", "--quiet", "-b", "side", "HEAD~1"]);
        yield* assertCaptureMatchesReference(cwd, "after-branch-switch");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps ignored files out of the tree across cached captures", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        yield* makeRepository(cwd);
        yield* write(cwd, ".gitignore", "ignored/\n");
        yield* write(cwd, "src/a.ts", "export const a = 1;\n");
        yield* git(cwd, ["add", "-A"]);
        yield* git(cwd, ["commit", "--quiet", "-m", "base"]);
        yield* assertCaptureMatchesReference(cwd, "ignored-first");

        yield* write(cwd, "ignored/secret.txt", "should not be captured\n");
        yield* write(cwd, "src/a.ts", "export const a = 2;\n");
        yield* assertCaptureMatchesReference(cwd, "ignored-second");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("does not share cached indexes between nested project roots", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        yield* makeRepository(cwd);
        yield* write(cwd, "root.ts", "export const root = 1;\n");
        yield* write(cwd, "nested/file.ts", "export const nested = 1;\n");
        yield* git(cwd, ["add", "-A"]);
        yield* git(cwd, ["commit", "--quiet", "-m", "base"]);

        // Seed the repository-root cache with a root-only modification.
        yield* write(cwd, "root.ts", "export const root = 2;\n");
        yield* assertCaptureMatchesReference(cwd, "root-project");

        // A nested project stages only its own path. Reusing the root cache would
        // silently carry the unrelated root.ts modification into this checkpoint.
        const nestedCwd = path.join(cwd, "nested");
        yield* write(cwd, "nested/file.ts", "export const nested = 2;\n");
        yield* assertCaptureMatchesReference(nestedCwd, "nested-project");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("captures in a repository with no commits", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        yield* makeRepository(cwd);
        yield* write(cwd, "src/a.ts", "export const a = 1;\n");
        yield* assertCaptureMatchesReference(cwd, "no-head");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("falls back to re-seeding when the cached index is corrupt", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* makeRepository(cwd);
        yield* write(cwd, "src/a.ts", "export const a = 1;\n");
        yield* git(cwd, ["add", "-A"]);
        yield* git(cwd, ["commit", "--quiet", "-m", "base"]);
        yield* assertCaptureMatchesReference(cwd, "before-corruption");

        const commonDirResult = yield* git(cwd, ["rev-parse", "--git-common-dir"]);
        const rawCommonDir = commonDirResult.stdout.trim();
        const commonDir = path.isAbsolute(rawCommonDir)
          ? rawCommonDir
          : path.resolve(cwd, rawCommonDir);
        yield* fileSystem.writeFileString(
          path.join(commonDir, checkpointCacheIndexName(path.resolve(cwd))),
          "not an index file",
        );
        yield* write(cwd, "src/a.ts", "export const a = 5;\n");
        yield* assertCaptureMatchesReference(cwd, "after-corruption");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
