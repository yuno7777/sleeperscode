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
});
export type TaskProfile = typeof TaskProfile.Type;
