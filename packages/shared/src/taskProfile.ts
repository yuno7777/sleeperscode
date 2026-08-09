import type {
  TaskCollaborationRecommendation,
  TaskComplexityBand,
  TaskExpectedDuration,
  TaskExpectedFileScope,
  TaskKind,
  TaskProfile,
  TaskProfileSignal,
  TaskRequirementLevel,
  TaskSecuritySensitivity,
  TaskTestingRequirement,
  TaskToolRequirement,
  TaskVisualRequirement,
} from "@t3tools/contracts";

const CLASSIFIER_VERSION = 1 as const;
const CLASSIFIER_HEAD_CHARS = 16_000;
const CLASSIFIER_TAIL_CHARS = 8_000;
const LONG_PROMPT_CHARS = 3_000;

type TaskProfileInput = {
  readonly text: string;
  readonly attachmentTypes?: ReadonlyArray<"image">;
};

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const samplePrompt = (text: string): string => {
  if (text.length <= CLASSIFIER_HEAD_CHARS + CLASSIFIER_TAIL_CHARS) {
    return text.toLowerCase();
  }
  return `${text.slice(0, CLASSIFIER_HEAD_CHARS)}\n${text.slice(-CLASSIFIER_TAIL_CHARS)}`.toLowerCase();
};

const matches = (text: string, pattern: RegExp): boolean => pattern.test(text);

const domainScore = (text: string, patterns: ReadonlyArray<RegExp>): number =>
  clampScore(patterns.reduce((score, pattern) => score + (matches(text, pattern) ? 25 : 0), 0));

const unique = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(values)];

const complexityBand = (score: number): TaskComplexityBand => {
  if (score <= 25) return "low";
  if (score <= 50) return "medium";
  if (score <= 75) return "high";
  return "very-high";
};

const requirementLevel = (score: number): TaskRequirementLevel => {
  if (score <= 30) return "low";
  if (score <= 65) return "medium";
  return "high";
};

/**
 * Classifies a turn with bounded, deterministic string checks only.
 *
 * The result contains stable reason codes and coarse estimates, never prompt
 * excerpts or paths. It is deliberately provider-neutral: model quality,
 * price, and historical outcomes belong to later router stages.
 */
export function classifyTaskProfile(input: TaskProfileInput): TaskProfile {
  const text = samplePrompt(input.text);
  const hasImageAttachment = input.attachmentTypes?.includes("image") === true;
  const isLongPrompt = input.text.length >= LONG_PROMPT_CHARS;

  const implementation = matches(
    text,
    /\b(implement|build|create|add|change|update|refactor|migrate|wire|integrate)\b/,
  );
  const debugging = matches(text, /\b(debug|fix|bug|error|crash|broken|regression|diagnose)\b/);
  const review = matches(text, /\b(review|audit|inspect|critique|assess)\b/);
  const research = matches(
    text,
    /\b(research|search|browse|look up|latest|sources?|citations?|compare|recommend)\b/,
  );
  const design = matches(
    text,
    /\b(design|redesign|ui|ux|layout|aesthetic|polish|animation|responsive)\b/,
  );
  const operations = matches(
    text,
    /\b(deploy|release|ci|pipeline|packaging|installer|monitor|observability)\b/,
  );
  const testing = matches(
    text,
    /\b(test|tests|testing|typecheck|lint|build validation|e2e|end-to-end|benchmark|verify)\b/,
  );
  const broadScope = matches(
    text,
    /\b(full[- ]blown|entire|whole app|repo[- ]wide|all (?:files|providers|clients|surfaces)|cross[- ](?:platform|client|surface)|end[- ]to[- ]end|architecture|migration)\b/,
  );
  const explicitCollaboration = matches(
    text,
    /\b(multi-agent|subagents?|parallel agents?|delegate|specialist workers?|agent team)\b/,
  );
  const trivialChange =
    input.text.length <= 500 &&
    matches(
      text,
      /\b(change|update|set|make|fix)\b.{0,48}\b(color|radius|padding|margin|label|copy|typo|spacing)\b/,
    ) &&
    !broadScope;
  const highSecurity = matches(
    text,
    /\b(secret|credential|password|authentication|authorization|oauth|permission|vulnerability|exploit|encryption|private key)\b/,
  );
  const elevatedSecurity =
    highSecurity ||
    matches(
      text,
      /\b(download|install|dependency|remote access|network|shell command|executable)\b/,
    );
  const visualRequired =
    hasImageAttachment ||
    matches(
      text,
      /\b(screenshot|pixel[- ]perfect|visual qa|visually verify|aesthetic|responsive|ui design|browser test)\b/,
    );

  const frontend = domainScore(text, [
    /\b(frontend|react|vue|svelte|next\.js|expo|react native)\b/,
    /\b(css|tailwind|layout|responsive|animation|styling)\b/,
    /\b(component|button|modal|dialog|form|screen|page)\b/,
    /\b(browser|mobile ui|desktop ui|ui|ux|visual)\b/,
  ]);
  const backend = domainScore(text, [
    /\b(backend|server|api|endpoint|service)\b/,
    /\b(database|sql|sqlite|postgres|schema|migration)\b/,
    /\b(auth|session|websocket|rpc|http)\b/,
    /\b(queue|cache|worker|event store|reactor)\b/,
  ]);
  const systems = domainScore(text, [
    /\b(rust|native|wasm|c\+\+|systems?)\b/,
    /\b(process|runtime|memory|cpu|performance|concurrency|thread)\b/,
    /\b(filesystem|git|checkpoint|worktree)\b/,
    /\b(ipc|protocol|sidecar|electron|tauri)\b/,
  ]);
  const researchScore = domainScore(text, [
    /\b(research|search|browse|sources?|citations?)\b/,
    /\b(latest|current|verify online|look up)\b/,
    /\b(compare|recommend|evaluate|tradeoffs?)\b/,
    /\b(documentation|docs|paper|dataset)\b/,
  ]);

  const fileReferenceCount = Math.min(
    5,
    text.match(
      /\b[\w.-]+\.(?:c|cc|cpp|css|go|html|java|js|jsx|json|kt|md|mjs|py|rs|sql|swift|toml|ts|tsx|yaml|yml)\b/g,
    )?.length ?? 0,
  );
  const domainCount = [frontend, backend, systems, researchScore].filter(
    (score) => score > 0,
  ).length;

  let complexityScore = 10;
  if (implementation) complexityScore += 15;
  if (debugging) complexityScore += 20;
  if (review) complexityScore += 15;
  if (research) complexityScore += 10;
  if (design) complexityScore += 10;
  if (operations) complexityScore += 10;
  if (testing) complexityScore += 5;
  if (broadScope) complexityScore += 25;
  if (highSecurity) complexityScore += 15;
  if (explicitCollaboration) complexityScore += 5;
  if (hasImageAttachment) complexityScore += 5;
  if (isLongPrompt) complexityScore += 10;
  complexityScore += Math.min(10, fileReferenceCount * 2);
  complexityScore += Math.max(0, domainCount - 1) * 5;
  if (trivialChange) complexityScore -= 15;
  complexityScore = clampScore(complexityScore);
  const band = complexityBand(complexityScore);

  const kinds = unique<TaskKind>([
    ...(implementation ? (["implementation"] as const) : []),
    ...(debugging ? (["debugging"] as const) : []),
    ...(review ? (["review"] as const) : []),
    ...(research ? (["research"] as const) : []),
    ...(design ? (["design"] as const) : []),
    ...(operations ? (["operations"] as const) : []),
  ]);

  const visualRequirement: TaskVisualRequirement = visualRequired
    ? "required"
    : frontend > 0 || design
      ? "possible"
      : "none";
  const securitySensitivity: TaskSecuritySensitivity = highSecurity
    ? "high"
    : elevatedSecurity
      ? "elevated"
      : "normal";
  const expectedFiles: TaskExpectedFileScope = broadScope
    ? "many"
    : fileReferenceCount === 1
      ? "one"
      : fileReferenceCount > 1 || implementation || debugging || design
        ? "few"
        : "unknown";
  const expectedDuration: TaskExpectedDuration =
    complexityScore <= 30 ? "small" : complexityScore <= 65 ? "medium" : "large";
  const testingRequirement: TaskTestingRequirement =
    testing && (broadScope || matches(text, /\b(e2e|end-to-end|full suite|all tests)\b/))
      ? "broad"
      : testing || implementation || debugging
        ? "focused"
        : "none";
  const repoContextRequirement: TaskRequirementLevel =
    implementation || debugging || review
      ? broadScope || fileReferenceCount > 0
        ? "high"
        : "medium"
      : fileReferenceCount > 0 || systems > 0 || backend > 0
        ? "medium"
        : "low";
  const reasoningRequirement = requirementLevel(
    complexityScore + (debugging || review || highSecurity ? 10 : 0),
  );
  const parallelizable =
    complexityScore >= 65 &&
    !trivialChange &&
    (broadScope || domainCount >= 2 || expectedFiles === "many" || explicitCollaboration);
  const collaboration: TaskCollaborationRecommendation =
    parallelizable && complexityScore >= 80
      ? "multi-specialist"
      : parallelizable
        ? "decompose"
        : "single-worker";

  const toolRequirements = unique<TaskToolRequirement>([
    ...(implementation || debugging || review || fileReferenceCount > 0
      ? (["filesystem"] as const)
      : []),
    ...(implementation || debugging || testing || operations ? (["shell"] as const) : []),
    ...(matches(text, /\b(git|commit|branch|diff|pull request|merge|worktree)\b/)
      ? (["git"] as const)
      : []),
    ...(visualRequirement === "required" || (frontend > 0 && testing)
      ? (["browser"] as const)
      : []),
    ...(research ? (["web-research"] as const) : []),
    ...(matches(text, /\b(computer control|desktop control|click|type into|device qa)\b/)
      ? (["computer"] as const)
      : []),
    ...(hasImageAttachment ? (["image"] as const) : []),
  ]);

  const signals = unique<TaskProfileSignal>([
    ...(trivialChange ? (["trivial-change"] as const) : []),
    ...(implementation ? (["implementation-request"] as const) : []),
    ...(debugging ? (["debugging-request"] as const) : []),
    ...(review ? (["review-request"] as const) : []),
    ...(research ? (["research-request"] as const) : []),
    ...(design ? (["design-request"] as const) : []),
    ...(operations ? (["operations-request"] as const) : []),
    ...(frontend > 0 ? (["frontend-domain"] as const) : []),
    ...(backend > 0 ? (["backend-domain"] as const) : []),
    ...(systems > 0 ? (["systems-domain"] as const) : []),
    ...(visualRequirement === "required" ? (["visual-requirement"] as const) : []),
    ...(highSecurity ? (["security-sensitive"] as const) : []),
    ...(testing ? (["testing-request"] as const) : []),
    ...(broadScope ? (["broad-scope"] as const) : []),
    ...(fileReferenceCount > 0 ? (["explicit-file-reference"] as const) : []),
    ...(explicitCollaboration ? (["explicit-collaboration"] as const) : []),
    ...(hasImageAttachment ? (["image-attachment"] as const) : []),
    ...(isLongPrompt ? (["long-prompt"] as const) : []),
  ]);

  return {
    version: CLASSIFIER_VERSION,
    kinds: kinds.length > 0 ? kinds : ["general"],
    complexity: { score: complexityScore, band },
    domains: { frontend, backend, systems, research: researchScore },
    visualRequirement,
    reasoningRequirement,
    repoContextRequirement,
    expectedFiles,
    expectedDuration,
    parallelizable,
    testingRequirement,
    securitySensitivity,
    toolRequirements,
    collaboration,
    signals,
  };
}
