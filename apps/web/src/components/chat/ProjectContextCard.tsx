import type {
  OrchestrationThreadActivity,
  ProjectContextSnapshot,
  ProjectHandoff,
  ProjectHandoffSummary,
  ProjectKnowledgeNote,
  ProjectSharedProviderConfiguration,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { deriveMcpDiagnostics } from "../../mcpDiagnostics";

function StackSummary({ context }: { readonly context: ProjectContextSnapshot }) {
  const evidence = context.repositoryEvidence;
  if (evidence === null) return <span>Stack detection is unavailable.</span>;
  const parts = [...evidence.languages, ...evidence.frameworks, ...evidence.testRunners];
  return <span>{parts.length > 0 ? parts.join(" · ") : "No recognised stack markers"}</span>;
}

function SourceList({
  label,
  paths,
}: {
  readonly label: string;
  readonly paths: ReadonlyArray<{ readonly path: string }>;
}) {
  if (paths.length === 0) return null;
  return (
    <div className="min-w-0">
      <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {paths.map((entry) => (
          <code
            key={entry.path}
            className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
            title={entry.path}
          >
            {entry.path}
          </code>
        ))}
      </div>
    </div>
  );
}

export function ProjectContextCard({
  context,
  isPending,
  error,
  handoffThreadId = null,
  handoffs,
  knowledgeNotes,
  sharedProviderConfiguration,
  threadActivities,
  onSaveHandoff,
  onPromoteHandoff,
  onContinueFromHandoff,
}: {
  readonly context: ProjectContextSnapshot | null;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly handoffThreadId?: string | null;
  readonly handoffs?: ReadonlyArray<ProjectHandoff> | undefined;
  readonly knowledgeNotes?: ReadonlyArray<ProjectKnowledgeNote> | undefined;
  readonly sharedProviderConfiguration?: ProjectSharedProviderConfiguration | undefined;
  readonly threadActivities?: ReadonlyArray<OrchestrationThreadActivity> | undefined;
  readonly onSaveHandoff?: (summary: ProjectHandoffSummary) => void;
  readonly onPromoteHandoff?: () => void;
  readonly onContinueFromHandoff?: () => void;
}) {
  const handoff =
    (handoffs ?? context?.handoffs ?? []).find((entry) => entry.threadId === handoffThreadId) ??
    null;
  const [draft, setDraft] = useState<ProjectHandoffSummary | null>(handoff?.summary ?? null);
  const mcpDiagnostics = deriveMcpDiagnostics(threadActivities ?? [], sharedProviderConfiguration);
  useEffect(() => setDraft(handoff?.summary ?? null), [handoff]);
  if (context === null && !isPending && error === null) return null;
  return (
    <section className="mx-auto mb-2 w-full max-w-3xl rounded-xl border border-border/70 bg-background/85 px-3 py-2.5 shadow-sm backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-xs text-foreground">Project context</p>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {context?.currentBranch ?? "No branch selected"}
        </span>
      </div>
      {isPending ? (
        <p className="mt-1 text-xs text-muted-foreground">Reading local project context…</p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      {context ? (
        <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              Detected stack
            </p>
            <p className="text-foreground">
              <StackSummary context={context} />
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              Recent checkpoints
            </p>
            <p className="text-foreground">
              {context.recentCheckpoints.length === 0
                ? "No checkpoints yet"
                : context.recentCheckpoints
                    .slice(0, 3)
                    .map(
                      (checkpoint) => `Turn ${checkpoint.turnCount}, ${checkpoint.fileCount} files`,
                    )
                    .join(" · ")}
            </p>
          </div>
          <SourceList label="Important docs" paths={context.documents.slice(0, 6)} />
          <SourceList label="Rules" paths={context.rules.slice(0, 6)} />
          {sharedProviderConfiguration &&
          (sharedProviderConfiguration.rulePaths.length > 0 ||
            sharedProviderConfiguration.mcpServerNames.length > 0 ||
            sharedProviderConfiguration.mcpProfileName !== null ||
            sharedProviderConfiguration.mcpToolCallBudget !== null ||
            sharedProviderConfiguration.recommendedRuntimeMode !== null ||
            sharedProviderConfiguration.recommendedInteractionMode !== null) ? (
            <div className="min-w-0">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Shared setup
              </p>
              <p className="text-foreground">
                {[
                  ...sharedProviderConfiguration.rulePaths,
                  ...sharedProviderConfiguration.mcpServerNames.map((name) => `MCP: ${name}`),
                  sharedProviderConfiguration.mcpProfileName
                    ? `Profile: ${sharedProviderConfiguration.mcpProfileName}`
                    : null,
                  sharedProviderConfiguration.mcpToolCallBudget !== null
                    ? `Budget: ${sharedProviderConfiguration.mcpToolCallBudget} calls/turn`
                    : null,
                  sharedProviderConfiguration.recommendedRuntimeMode,
                  sharedProviderConfiguration.recommendedInteractionMode,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ) : null}
          {mcpDiagnostics &&
          (mcpDiagnostics.callCount > 0 || sharedProviderConfiguration?.mcpServerNames.length) ? (
            <div className="min-w-0">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                MCP diagnostics
              </p>
              <p className="text-foreground">
                {mcpDiagnostics.callCount === 0
                  ? "No MCP calls observed in this thread"
                  : `${mcpDiagnostics.callCount} observed call${mcpDiagnostics.callCount === 1 ? "" : "s"}: ${mcpDiagnostics.observedServers
                      .map((server) => `${server.name} (${server.tools.join(", ")})`)
                      .join(" · ")}`}
              </p>
              {mcpDiagnostics.budgetExceeded ? (
                <p className="mt-1 text-amber-600 dark:text-amber-400">
                  Advisory call budget exceeded. The provider controls enforcement.
                </p>
              ) : null}
              {mcpDiagnostics.unexpectedServerNames.length > 0 ? (
                <p className="mt-1 text-amber-600 dark:text-amber-400">
                  Not in the shared profile: {mcpDiagnostics.unexpectedServerNames.join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
          {context.relatedThreads.length > 0 ? (
            <div className="min-w-0 sm:col-span-2">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Related work
              </p>
              <div className="space-y-1">
                {context.relatedThreads.slice(0, 4).map((thread) => (
                  <p key={thread.threadId} className="truncate text-foreground">
                    {thread.sharesWorktreeWithCurrentThread ? "Conflict: " : ""}
                    {thread.title}
                    {thread.branch ? ` · ${thread.branch}` : ""}
                    {thread.worktreePath ? ` · ${thread.worktreePath}` : ""}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          {(knowledgeNotes ?? context.knowledgeNotes).length > 0 ? (
            <div className="min-w-0 sm:col-span-2">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Project notes
              </p>
              <div className="space-y-1">
                {(knowledgeNotes ?? context.knowledgeNotes)
                  .slice(-3)
                  .reverse()
                  .map((note) => (
                    <p key={note.id} className="truncate text-foreground" title={note.title}>
                      {note.title}
                    </p>
                  ))}
              </div>
            </div>
          ) : null}
          {handoff && draft && onSaveHandoff ? (
            <div className="space-y-2 sm:col-span-2">
              <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Handoff draft
              </p>
              {(["changed", "decisions", "verification", "remaining"] as const).map((field) => (
                <label key={field} className="block text-[11px] text-muted-foreground">
                  {field}
                  <textarea
                    className="mt-1 min-h-14 w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                    value={draft[field].join("\n")}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        [field]: event.target.value
                          .split("\n")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              ))}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-input px-2 py-1 text-xs text-foreground hover:bg-muted"
                  onClick={() => onSaveHandoff(draft)}
                >
                  Save handoff
                </button>
                {onPromoteHandoff ? (
                  <button
                    type="button"
                    className="rounded border border-input px-2 py-1 text-xs text-foreground hover:bg-muted"
                    onClick={onPromoteHandoff}
                  >
                    Review and add to project notes
                  </button>
                ) : null}
                {onContinueFromHandoff ? (
                  <button
                    type="button"
                    className="rounded border border-input px-2 py-1 text-xs text-foreground hover:bg-muted"
                    onClick={onContinueFromHandoff}
                  >
                    Continue with selected provider
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
