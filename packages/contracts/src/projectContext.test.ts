import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ProjectContextPath, ProjectHandoffSummary } from "./projectContext.ts";

const decodePath = Schema.decodeUnknownSync(ProjectContextPath);

describe("ProjectContextPath", () => {
  it("accepts workspace-relative paths", () => {
    assert.equal(decodePath("docs/architecture.md"), "docs/architecture.md");
    assert.equal(decodePath("AGENTS.md"), "AGENTS.md");
  });

  it("rejects absolute and escaping paths", () => {
    assert.throws(() => decodePath("/etc/passwd"));
    assert.throws(() => decodePath("C:\\workspace\\README.md"));
    assert.throws(() => decodePath("docs/../../secrets.txt"));
  });
});

describe("ProjectHandoffSummary", () => {
  it("keeps handoff content structured and bounded", () => {
    const decoded = Schema.decodeUnknownSync(ProjectHandoffSummary)({
      changed: ["Added a context card"],
      decisions: ["Notes need explicit promotion"],
      verification: ["Focused tests passed"],
      remaining: ["Review the handoff before publishing it"],
    });
    assert.equal(decoded.changed.length, 1);
    assert.equal(decoded.remaining[0], "Review the handoff before publishing it");
  });
});
