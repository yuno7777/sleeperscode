import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { extractAgentArchive, isSafeArchiveRelativePath } from "./archiveExtraction.ts";

it.layer(NodeServices.layer)("agent archive extraction", (it) => {
  it("rejects traversal, absolute, drive-qualified, and NUL-containing paths", () => {
    assert.isTrue(isSafeArchiveRelativePath("bin/agent.exe"));
    assert.isTrue(isSafeArchiveRelativePath("./agent"));
    assert.isFalse(isSafeArchiveRelativePath("../agent.exe"));
    assert.isFalse(isSafeArchiveRelativePath("bin/../../agent.exe"));
    assert.isFalse(isSafeArchiveRelativePath("/tmp/agent"));
    assert.isFalse(isSafeArchiveRelativePath("C:\\agent.exe"));
    assert.isFalse(isSafeArchiveRelativePath("bin/agent\0.exe"));
  });

  it.effect("copies a raw executable only to the declared safe command path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "agent-archive-test-" });
      const archive = path.join(root, "download.exe");
      const destination = path.join(root, "payload");
      yield* fs.writeFile(archive, new Uint8Array([77, 90, 1, 2, 3]));

      yield* extractAgentArchive({
        format: "executable",
        archivePath: archive,
        destination,
        command: "bin/agent.exe",
      });

      assert.deepEqual(
        [...(yield* fs.readFile(path.join(destination, "bin", "agent.exe")))],
        [77, 90, 1, 2, 3],
      );
    }),
  );
});
