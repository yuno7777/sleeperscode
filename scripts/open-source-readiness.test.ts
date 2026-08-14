// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { auditOpenSourceReadiness, extractLocalMarkdownTargets } from "./open-source-readiness.ts";

const temporaryRoots: Array<string> = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

function makeFixture(): string {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sleepers-open-source-audit-"));
  temporaryRoots.push(root);
  const files: Record<string, string> = {
    "README.md": "[Contributing](./CONTRIBUTING.md)\n",
    LICENSE: "MIT License\nCopyright (c) 2026 T3 Tools Inc.\n",
    "NOTICE.md":
      "Derived from https://github.com/pingdotgg/t3code. Provider CLIs are not redistributed.\n",
    "CONTRIBUTING.md":
      "Read AGENTS.md. Run vp i then vp run dev. Use the smallest checks that prove the change.\n",
    "SECURITY.md":
      "Do not disclose vulnerability details in a public issue. Use security/advisories/new.\n",
    "AGENTS.md": "Repository instructions.\n",
    ".github/pull_request_template.md": "Problem, change, validation, and risk.\n",
    ".github/ISSUE_TEMPLATE/config.yml":
      "blank_issues_enabled: false\ncontact_links:\n  - url: https://example.com/security/policy\n",
    ".github/workflows/ci.yml": "steps:\n  - run: vp run audit:open-source\n",
    "docs/operations/source-build.md": "Source build.\n",
    "package.json": JSON.stringify({
      engines: { node: "^24.13.1" },
      packageManager: "pnpm@11.10.0",
      scripts: { "audit:open-source": "node scripts/open-source-readiness.ts" },
    }),
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = NodePath.resolve(root, relativePath);
    NodeFS.mkdirSync(NodePath.dirname(absolutePath), { recursive: true });
    NodeFS.writeFileSync(absolutePath, content);
  }
  return root;
}

describe("open-source readiness audit", () => {
  it("accepts the complete minimum community and build surface", () => {
    expect(auditOpenSourceReadiness(makeFixture())).toEqual([]);
  });

  it("reports missing required files and broken local links", () => {
    const root = makeFixture();
    NodeFS.rmSync(NodePath.resolve(root, "SECURITY.md"));
    NodeFS.writeFileSync(NodePath.resolve(root, "README.md"), "[Missing](./missing.md)\n");

    expect(auditOpenSourceReadiness(root)).toEqual(
      expect.arrayContaining([
        { file: "SECURITY.md", detail: "Required open-source file is missing." },
        { file: "README.md", detail: "Local link does not resolve: ./missing.md" },
      ]),
    );
  });

  it("extracts only repository-local Markdown destinations", () => {
    expect(
      extractLocalMarkdownTargets(
        "[local](./guide.md) [anchor](#setup) [web](https://example.com) [mail](mailto:x@y.z)",
      ),
    ).toEqual(["./guide.md"]);
  });
});
