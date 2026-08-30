import { assert, describe, it } from "@effect/vitest";

import { serverDevArgs } from "./dev-server.ts";

describe("serverDevArgs", () => {
  it("keeps Node's watcher off on Windows", () => {
    assert.deepEqual(serverDevArgs("win32"), ["src/bin.ts"]);
  });

  it("keeps live reload on non-Windows hosts", () => {
    assert.deepEqual(serverDevArgs("linux"), ["--watch", "src/bin.ts"]);
  });
});
