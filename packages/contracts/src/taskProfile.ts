import * as Schema from "effect/Schema";

/** Bounded score used by the deterministic task classifier. */
export const TaskProfileScore = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
export type TaskProfileScore = typeof TaskProfileScore.Type;

export const TaskKind = Schema.Literals([
  "general",
  "implementation",
  "debugging",
  "review",
  "research",
  "design",
  "operations",
]);
export type TaskKind = typeof TaskKind.Type;

export const TaskComplexityBand = Schema.Literals(["low", "medium", "high", "very-high"]);
export type TaskComplexityBand = typeof TaskComplexityBand.Type;

export const TaskRequirementLevel = Schema.Literals(["low", "medium", "high"]);
export type TaskRequirementLevel = typeof TaskRequirementLevel.Type;

export const TaskVisualRequirement = Schema.Literals(["none", "possible", "required"]);
export type TaskVisualRequirement = typeof TaskVisualRequirement.Type;

export const TaskTestingRequirement = Schema.Literals(["none", "focused", "broad"]);
export type TaskTestingRequirement = typeof TaskTestingRequirement.Type;

export const TaskSecuritySensitivity = Schema.Literals(["normal", "elevated", "high"]);
export type TaskSecuritySensitivity = typeof TaskSecuritySensitivity.Type;

export const TaskExpectedFileScope = Schema.Literals(["unknown", "one", "few", "many"]);
export type TaskExpectedFileScope = typeof TaskExpectedFileScope.Type;

export const TaskExpectedDuration = Schema.Literals(["small", "medium", "large"]);
export type TaskExpectedDuration = typeof TaskExpectedDuration.Type;

export const TaskCollaborationRecommendation = Schema.Literals([
  "single-worker",
  "decompose",
  "multi-specialist",
]);
export type TaskCollaborationRecommendation = typeof TaskCollaborationRecommendation.Type;

export const TaskToolRequirement = Schema.Literals([
  "filesystem",
  "shell",
  "git",
  "browser",
  "web-research",
  "computer",
  "image",
]);
export type TaskToolRequirement = typeof TaskToolRequirement.Type;

export const TaskRepositoryLanguage = Schema.Literals([
  "typescript",
  "javascript",
  "rust",
  "python",
  "go",
  "java",
  "kotlin",
  "swift",
  "dotnet",
  "cpp",
  "ruby",
  "php",
  "dart",
]);
export type TaskRepositoryLanguage = typeof TaskRepositoryLanguage.Type;

export const TaskRepositoryFramework = Schema.Literals([
  "react",
  "next",
  "vue",
  "svelte",
  "vite",
  "expo",
  "electron",
  "tauri",
  "effect",
  "express",
  "fastify",
]);
export type TaskRepositoryFramework = typeof TaskRepositoryFramework.Type;

export const TaskRepositoryTestRunner = Schema.Literals([
  "vitest",
  "jest",
  "playwright",
  "cypress",
  "cargo",
  "pytest",
  "go-test",
  "gradle",
  "swift-test",
  "dotnet-test",
]);
export type TaskRepositoryTestRunner = typeof TaskRepositoryTestRunner.Type;

export const TaskRepositoryMarker = Schema.Literals([
  "package-json",
  "tsconfig-json",
  "pnpm-workspace",
  "turbo-json",
  "cargo-toml",
  "pyproject-toml",
  "requirements-txt",
  "go-mod",
  "pom-xml",
  "gradle",
  "package-swift",
  "dotnet",
  "cmake",
  "pubspec-yaml",
  "gemfile",
  "composer-json",
]);
export type TaskRepositoryMarker = typeof TaskRepositoryMarker.Type;

/** Bounded server-owned evidence; no workspace paths or manifest contents. */
export const TaskRepositoryEvidence = Schema.Struct({
  version: Schema.Literal(1),
  source: Schema.Literal("root-markers"),
  markers: Schema.Array(TaskRepositoryMarker),
  languages: Schema.Array(TaskRepositoryLanguage),
  frameworks: Schema.Array(TaskRepositoryFramework),
  testRunners: Schema.Array(TaskRepositoryTestRunner),
  workspace: Schema.Literals(["single-package", "monorepo", "unknown"]),
  limited: Schema.Boolean,
});
export type TaskRepositoryEvidence = typeof TaskRepositoryEvidence.Type;

/** Stable, non-content-bearing explanations emitted by classifier version 1. */
export const TaskProfileSignal = Schema.Literals([
  "trivial-change",
  "implementation-request",
  "debugging-request",
  "review-request",
  "research-request",
  "design-request",
  "operations-request",
  "frontend-domain",
  "backend-domain",
  "systems-domain",
  "visual-requirement",
  "security-sensitive",
  "testing-request",
  "broad-scope",
  "explicit-file-reference",
  "explicit-collaboration",
  "image-attachment",
  "long-prompt",
  "repository-evidence",
  "test-capability-detected",
]);
export type TaskProfileSignal = typeof TaskProfileSignal.Type;

/**
 * Privacy-preserving task metadata for routing and orchestration decisions.
 *
 * It intentionally contains no prompt excerpts, filenames, repository paths,
 * credentials, or provider selection. Scores are deterministic hints, not
 * claims about which model will produce the best result.
 */
export const TaskProfile = Schema.Struct({
  version: Schema.Literal(1),
  kinds: Schema.Array(TaskKind),
  complexity: Schema.Struct({
    score: TaskProfileScore,
    band: TaskComplexityBand,
  }),
  domains: Schema.Struct({
    frontend: TaskProfileScore,
    backend: TaskProfileScore,
    systems: TaskProfileScore,
    research: TaskProfileScore,
  }),
  visualRequirement: TaskVisualRequirement,
  reasoningRequirement: TaskRequirementLevel,
  repoContextRequirement: TaskRequirementLevel,
  expectedFiles: TaskExpectedFileScope,
  expectedDuration: TaskExpectedDuration,
  parallelizable: Schema.Boolean,
  testingRequirement: TaskTestingRequirement,
  securitySensitivity: TaskSecuritySensitivity,
  toolRequirements: Schema.Array(TaskToolRequirement),
  collaboration: TaskCollaborationRecommendation,
  signals: Schema.Array(TaskProfileSignal),
  repositoryEvidence: Schema.optionalKey(TaskRepositoryEvidence),
});
export type TaskProfile = typeof TaskProfile.Type;
