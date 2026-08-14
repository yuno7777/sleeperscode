// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

export interface OpenSourceReadinessIssue {
  readonly file: string;
  readonly detail: string;
}

const requiredFiles = [
  "README.md",
  "LICENSE",
  "NOTICE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "AGENTS.md",
  ".github/pull_request_template.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/workflows/ci.yml",
  "docs/operations/source-build.md",
] as const;

const markdownRoots = [
  "README.md",
  "NOTICE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ".github",
  "docs",
] as const;

function localTarget(rawTarget: string): string | undefined {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  } else {
    const titledTarget = /^(\S+)\s+["'][^"']*["']$/u.exec(target);
    if (titledTarget) target = titledTarget[1]!;
  }
  if (
    target.length === 0 ||
    target.startsWith("#") ||
    target.startsWith("/") ||
    target.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(target)
  ) {
    return undefined;
  }
  const withoutFragment = target.split(/[?#]/u, 1)[0];
  if (!withoutFragment) return undefined;
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}

export function extractLocalMarkdownTargets(markdown: string): ReadonlyArray<string> {
  const targets: Array<string> = [];
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = localTarget(match[1]!);
    if (target !== undefined) targets.push(target);
  }
  return targets;
}

function markdownFilesAt(root: string): ReadonlyArray<string> {
  const files: Array<string> = [];
  for (const relativeRoot of markdownRoots) {
    const absoluteRoot = NodePath.resolve(root, relativeRoot);
    if (!NodeFS.existsSync(absoluteRoot)) continue;
    const stat = NodeFS.statSync(absoluteRoot);
    if (stat.isFile()) {
      files.push(absoluteRoot);
      continue;
    }
    const queue = [absoluteRoot];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const entry of NodeFS.readdirSync(current, { withFileTypes: true })) {
        const child = NodePath.resolve(current, entry.name);
        if (entry.isDirectory()) queue.push(child);
        else if (entry.isFile() && entry.name.endsWith(".md")) files.push(child);
      }
    }
  }
  return files;
}

function requireText(
  root: string,
  relativePath: string,
  patterns: ReadonlyArray<{ readonly pattern: RegExp; readonly detail: string }>,
  issues: Array<OpenSourceReadinessIssue>,
): void {
  const absolutePath = NodePath.resolve(root, relativePath);
  if (!NodeFS.existsSync(absolutePath)) return;
  const text = NodeFS.readFileSync(absolutePath, "utf8");
  for (const requirement of patterns) {
    if (!requirement.pattern.test(text)) {
      issues.push({ file: relativePath, detail: requirement.detail });
    }
  }
}

export function auditOpenSourceReadiness(root: string): ReadonlyArray<OpenSourceReadinessIssue> {
  const issues: Array<OpenSourceReadinessIssue> = [];

  for (const relativePath of requiredFiles) {
    const absolutePath = NodePath.resolve(root, relativePath);
    if (!NodeFS.existsSync(absolutePath)) {
      issues.push({ file: relativePath, detail: "Required open-source file is missing." });
      continue;
    }
    if (NodeFS.statSync(absolutePath).size === 0) {
      issues.push({ file: relativePath, detail: "Required open-source file is empty." });
    }
  }

  for (const absolutePath of markdownFilesAt(root)) {
    const relativePath = NodePath.relative(root, absolutePath).replaceAll("\\", "/");
    const markdown = NodeFS.readFileSync(absolutePath, "utf8");
    for (const target of extractLocalMarkdownTargets(markdown)) {
      const resolved = NodePath.resolve(NodePath.dirname(absolutePath), target);
      if (!NodeFS.existsSync(resolved)) {
        issues.push({ file: relativePath, detail: `Local link does not resolve: ${target}` });
      }
    }
  }

  requireText(
    root,
    "LICENSE",
    [
      { pattern: /MIT License/u, detail: "The root license must identify the MIT License." },
      {
        pattern: /Copyright \(c\) 2026 T3 Tools Inc\./u,
        detail: "The upstream copyright notice must remain intact.",
      },
    ],
    issues,
  );
  requireText(
    root,
    "NOTICE.md",
    [
      {
        pattern: /github\.com\/pingdotgg\/t3code/u,
        detail: "The notice must identify the upstream repository.",
      },
      {
        pattern: /Provider CLIs are not\s+redistributed/iu,
        detail: "The notice must state the provider CLI redistribution boundary.",
      },
    ],
    issues,
  );
  requireText(
    root,
    "SECURITY.md",
    [
      {
        pattern: /security\/advisories\/new/u,
        detail: "The security policy must provide a private reporting route.",
      },
      {
        pattern: /Do not disclose vulnerability details in a public issue/iu,
        detail: "The security policy must prohibit public vulnerability disclosure.",
      },
    ],
    issues,
  );
  requireText(
    root,
    "CONTRIBUTING.md",
    [
      { pattern: /AGENTS\.md/u, detail: "Contributor guidance must route readers to AGENTS.md." },
      { pattern: /vp i/u, detail: "Contributor guidance must include dependency installation." },
      {
        pattern: /vp run dev/u,
        detail: "Contributor guidance must include the development command.",
      },
      {
        pattern: /smallest checks that prove/iu,
        detail: "Contributor guidance must require focused verification.",
      },
    ],
    issues,
  );
  requireText(
    root,
    ".github/ISSUE_TEMPLATE/config.yml",
    [
      {
        pattern: /blank_issues_enabled:\s*false/u,
        detail: "Issue routing must prevent unstructured public reports.",
      },
      {
        pattern: /security\/policy/u,
        detail: "Issue routing must link to the security policy.",
      },
    ],
    issues,
  );
  requireText(
    root,
    ".github/workflows/ci.yml",
    [
      {
        pattern: /vp run audit:open-source/u,
        detail: "CI must enforce the open-source readiness audit.",
      },
    ],
    issues,
  );

  const packagePath = NodePath.resolve(root, "package.json");
  if (NodeFS.existsSync(packagePath)) {
    const packageJson = JSON.parse(NodeFS.readFileSync(packagePath, "utf8")) as {
      readonly engines?: { readonly node?: string };
      readonly packageManager?: string;
      readonly scripts?: Record<string, string>;
    };
    if (!packageJson.engines?.node?.includes("24")) {
      issues.push({
        file: "package.json",
        detail: "The supported Node 24 engine is not declared.",
      });
    }
    if (!packageJson.packageManager?.startsWith("pnpm@11.")) {
      issues.push({
        file: "package.json",
        detail: "The pinned pnpm 11 package manager is missing.",
      });
    }
    if (packageJson.scripts?.["audit:open-source"] === undefined) {
      issues.push({
        file: "package.json",
        detail: "The open-source audit script is not registered.",
      });
    }
  }

  return issues;
}

function runCli(): void {
  const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
  const issues = auditOpenSourceReadiness(root);
  if (issues.length > 0) {
    Effect.runSync(
      Console.error(`Open-source readiness audit failed with ${issues.length} issue(s):`),
    );
    for (const issue of issues) {
      Effect.runSync(Console.error(`- ${issue.file}: ${issue.detail}`));
    }
    process.exitCode = 1;
    return;
  }
  Effect.runSync(Console.log("Open-source readiness audit passed."));
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  runCli();
}
