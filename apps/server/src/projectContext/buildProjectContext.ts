import type {
  OrchestrationProject,
  OrchestrationThread,
  ProjectContextDocument,
  ProjectContextSnapshot,
  TaskRepositoryEvidence,
} from "@t3tools/contracts";

const IMPORTANT_DOCUMENT_NAMES = new Set([
  "readme.md",
  "contributing.md",
  "architecture.md",
  "overview.md",
  "getting-started.md",
]);
const RULE_DOCUMENT_NAMES = new Set([
  "agents.md",
  "claude.md",
  "codex.md",
  "cursor.md",
  "instructions.md",
]);

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function documentKind(path: string): ProjectContextDocument["kind"] | null {
  const normalized = normalizePath(path);
  const name = normalized.split("/").at(-1)?.toLowerCase() ?? "";
  if (RULE_DOCUMENT_NAMES.has(name) || normalized.startsWith(".github/instructions/")) {
    return "rule";
  }
  if (IMPORTANT_DOCUMENT_NAMES.has(name)) {
    return "guide";
  }
  if (normalized.startsWith("docs/")) {
    return "reference";
  }
  return null;
}

export function classifyProjectContextDocuments(
  paths: ReadonlyArray<string>,
): ReadonlyArray<ProjectContextDocument> {
  const seen = new Set<string>();
  const documents: ProjectContextDocument[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path).trim();
    const kind = documentKind(normalized);
    if (!kind || seen.has(normalized)) continue;
    seen.add(normalized);
    documents.push({ path: normalized as ProjectContextDocument["path"], kind });
  }
  return documents.toSorted((left, right) => {
    const leftPriority = left.kind === "rule" ? 0 : left.kind === "guide" ? 1 : 2;
    const rightPriority = right.kind === "rule" ? 0 : right.kind === "guide" ? 1 : 2;
    return leftPriority - rightPriority || left.path.localeCompare(right.path);
  });
}

export function buildProjectContextSnapshot(input: {
  readonly project: OrchestrationProject;
  readonly currentThread: OrchestrationThread | null;
  readonly threads: ReadonlyArray<OrchestrationThread>;
  readonly workspacePaths: ReadonlyArray<string>;
  readonly repositoryEvidence: TaskRepositoryEvidence | null;
  readonly generatedAt: string;
}): ProjectContextSnapshot {
  const documents = classifyProjectContextDocuments(input.workspacePaths);
  const relatedThreads = input.threads
    .filter(
      (thread) => thread.projectId === input.project.id && thread.id !== input.currentThread?.id,
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 24)
    .map((thread) => ({
      threadId: thread.id,
      title: thread.title,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      active: thread.archivedAt === null && thread.settledAt === null,
      sharesWorktreeWithCurrentThread:
        input.currentThread?.worktreePath !== null &&
        input.currentThread?.worktreePath !== undefined &&
        input.currentThread.worktreePath === thread.worktreePath,
      updatedAt: thread.updatedAt,
    }));
  const recentCheckpoints = input.threads
    .filter((thread) => thread.projectId === input.project.id)
    .flatMap((thread) =>
      thread.checkpoints.map((checkpoint) => ({
        threadId: thread.id,
        turnCount: checkpoint.checkpointTurnCount,
        fileCount: checkpoint.files.length,
        completedAt: checkpoint.completedAt,
      })),
    )
    .toSorted((left, right) => right.completedAt.localeCompare(left.completedAt))
    .slice(0, 12);

  return {
    projectId: input.project.id,
    workspaceRoot: input.project.workspaceRoot,
    currentBranch: input.currentThread?.branch ?? null,
    repositoryEvidence: input.repositoryEvidence,
    documents: documents.filter((document) => document.kind !== "rule").slice(0, 24),
    rules: documents.filter((document) => document.kind === "rule").slice(0, 24),
    recentCheckpoints,
    relatedThreads,
    handoffs: input.project.handoffs ?? [],
    knowledgeNotes: input.project.knowledgeNotes ?? [],
    generatedAt: input.generatedAt,
  };
}
