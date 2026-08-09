// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId, type VcsError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import { describe, expect } from "vite-plus/test";

import { checkpointRefForThreadTurn } from "./Utils.ts";
import * as CheckpointStore from "./CheckpointStore.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ServerConfig from "../config.ts";

const ServerConfigLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-checkpoint-store-test-",
});
const VcsProcessTestLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const VcsDriverTestLayer = VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcessTestLayer));
const CheckpointStoreTestLayer = CheckpointStore.layer.pipe(
  Layer.provideMerge(VcsDriverTestLayer),
  Layer.provideMerge(NodeServices.layer),
);
const TestLayer = CheckpointStoreTestLayer.pipe(
  Layer.provideMerge(VcsProcessTestLayer),
  Layer.provideMerge(VcsDriverTestLayer),
  Layer.provideMerge(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

function makeTmpDir(
  prefix = "checkpoint-store-test-",
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });
}

function writeTextFile(
  filePath: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(filePath, contents);
  });
}

function git(
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, VcsError, VcsProcess.VcsProcess> {
  return Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    const result = yield* process.run({
      operation: "CheckpointStore.test.git",
      command: "git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });
}

function initRepoWithCommit(
  cwd: string,
): Effect.Effect<
  void,
  VcsError | PlatformError.PlatformError,
  VcsProcess.VcsProcess | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    yield* git(cwd, ["init"]);
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* git(cwd, ["config", "core.autocrlf", "false"]);
    yield* writeTextFile(NodePath.join(cwd, "README.md"), "# test\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "initial commit"]);
  });
}

function buildLargeText(lineCount = 5_000): string {
  return Array.from({ length: lineCount }, (_, index) => `line ${String(index).padStart(5, "0")}`)
    .join("\n")
    .concat("\n");
}

it.layer(TestLayer)("CheckpointStore.layer", (it) => {
  describe("isGitRepository", () => {
    it.effect("returns false when no Git repository is detected", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        const checkpointStore = yield* CheckpointStore.CheckpointStore;

        expect(yield* checkpointStore.isGitRepository(tmp)).toBe(false);
      }),
    );

    it.effect("returns true when a Git repository is detected", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;

        expect(yield* checkpointStore.isGitRepository(tmp)).toBe(true);
      }),
    );
  });

  describe("restoreCheckpoint", () => {
    it.effect("restores modified, deleted, and new files without deleting ignored files", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = checkpointRefForThreadTurn(
          ThreadId.make("thread-checkpoint-restore"),
          1,
        );
        const readmePath = NodePath.join(tmp, "README.md");
        const trackedPath = NodePath.join(tmp, "tracked.txt");
        const newPath = NodePath.join(tmp, "new.txt");
        const ignoredPath = NodePath.join(tmp, "ignored.txt");
        const throwawayPath = NodePath.join(tmp, "throwaway.txt");

        yield* writeTextFile(NodePath.join(tmp, ".gitignore"), "ignored.txt\n");
        yield* writeTextFile(trackedPath, "tracked at HEAD\n");
        yield* git(tmp, ["add", ".gitignore", "tracked.txt"]);
        yield* git(tmp, ["commit", "-m", "checkpoint fixture"]);

        yield* writeTextFile(readmePath, "# checkpoint\n");
        yield* fileSystem.remove(trackedPath);
        yield* writeTextFile(newPath, "new at checkpoint\n");
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef });

        yield* writeTextFile(readmePath, "# later\n");
        yield* writeTextFile(trackedPath, "recreated later\n");
        yield* writeTextFile(newPath, "changed later\n");
        yield* writeTextFile(ignoredPath, "keep ignored data\n");
        yield* writeTextFile(throwawayPath, "remove untracked data\n");
        yield* git(tmp, ["add", "README.md"]);

        expect(yield* checkpointStore.restoreCheckpoint({ cwd: tmp, checkpointRef })).toBe(true);
        expect(yield* fileSystem.readFileString(readmePath)).toBe("# checkpoint\n");
        expect(yield* fileSystem.exists(trackedPath)).toBe(false);
        expect(yield* fileSystem.readFileString(newPath)).toBe("new at checkpoint\n");
        expect(yield* fileSystem.readFileString(ignoredPath)).toBe("keep ignored data\n");
        expect(yield* fileSystem.exists(throwawayPath)).toBe(false);
        expect(yield* git(tmp, ["diff", "--cached", "--name-only"])).toBe("");
        expect(
          (yield* git(tmp, ["status", "--porcelain=v1", "--untracked-files=all"])).split("\n"),
        ).toEqual(["M README.md", " D tracked.txt", "?? new.txt"]);
      }),
    );

    it.effect("keeps restore operations inside a nested project root", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const nested = NodePath.join(tmp, "nested");
        const rootPath = NodePath.join(tmp, "root.txt");
        const nestedPath = NodePath.join(nested, "file.txt");
        const nestedThrowawayPath = NodePath.join(nested, "throwaway.txt");
        const checkpointRef = checkpointRefForThreadTurn(
          ThreadId.make("thread-nested-checkpoint-restore"),
          1,
        );

        yield* fileSystem.makeDirectory(nested, { recursive: true });
        yield* writeTextFile(rootPath, "root at HEAD\n");
        yield* writeTextFile(nestedPath, "nested at HEAD\n");
        yield* git(tmp, ["add", "root.txt", "nested/file.txt"]);
        yield* git(tmp, ["commit", "-m", "nested fixture"]);

        yield* writeTextFile(nestedPath, "nested checkpoint\n");
        yield* checkpointStore.captureCheckpoint({ cwd: nested, checkpointRef });
        yield* writeTextFile(rootPath, "root later\n");
        yield* writeTextFile(nestedPath, "nested later\n");
        yield* writeTextFile(nestedThrowawayPath, "remove me\n");

        expect(yield* checkpointStore.restoreCheckpoint({ cwd: nested, checkpointRef })).toBe(true);
        expect(yield* fileSystem.readFileString(rootPath)).toBe("root later\n");
        expect(yield* fileSystem.readFileString(nestedPath)).toBe("nested checkpoint\n");
        expect(yield* fileSystem.exists(nestedThrowawayPath)).toBe(false);
      }),
    );

    it.effect("returns false for a missing ref and restores HEAD only when requested", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const missingRef = checkpointRefForThreadTurn(
          ThreadId.make("thread-missing-checkpoint-restore"),
          99,
        );
        const readmePath = NodePath.join(tmp, "README.md");

        yield* writeTextFile(readmePath, "# keep when missing\n");
        expect(
          yield* checkpointStore.restoreCheckpoint({ cwd: tmp, checkpointRef: missingRef }),
        ).toBe(false);
        expect(yield* fileSystem.readFileString(readmePath)).toBe("# keep when missing\n");

        expect(
          yield* checkpointStore.restoreCheckpoint({
            cwd: tmp,
            checkpointRef: missingRef,
            fallbackToHead: true,
          }),
        ).toBe(true);
        expect(yield* fileSystem.readFileString(readmePath)).toBe("# test\n");
      }),
    );
  });

  describe("diffCheckpoints", () => {
    it.effect("returns full oversized checkpoint diffs without truncation", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(NodePath.join(tmp, "README.md"), buildLargeText());
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        });

        expect(diff).toContain("diff --git");
        expect(diff).not.toContain("[truncated]");
        expect(diff).toContain("+line 04999");
      }),
    );

    it.effect("can hide indentation churn when changes wrap existing lines", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-whitespace");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        const componentPath = NodePath.join(tmp, "Component.tsx");
        yield* writeTextFile(
          componentPath,
          [
            "export function View() {",
            "  return (",
            "    <section>",
            "      <h1>Title</h1>",
            "      <p>Body</p>",
            "    </section>",
            "  );",
            "}",
            "",
          ].join("\n"),
        );
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(
          componentPath,
          [
            "export function View() {",
            "  return (",
            "    <section>",
            "      {isReady ? (",
            "        <div>",
            "          <h1>Title</h1>",
            "          <p>Body</p>",
            "        </div>",
            "      ) : null}",
            "    </section>",
            "  );",
            "}",
            "",
          ].join("\n"),
        );
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const normalDiff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
        });
        const whitespaceIgnoredDiff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        });

        expect(normalDiff).toContain("diff --git");
        expect(normalDiff).toContain("-      <h1>Title</h1>");
        expect(normalDiff).toContain("+          <h1>Title</h1>");
        expect(whitespaceIgnoredDiff).toContain("diff --git");
        expect(whitespaceIgnoredDiff).toContain("+      {isReady ? (");
        expect(whitespaceIgnoredDiff).toContain("+        <div>");
        expect(whitespaceIgnoredDiff).not.toContain("-      <h1>Title</h1>");
        expect(whitespaceIgnoredDiff).not.toContain("+          <h1>Title</h1>");
      }),
    );
  });
});
