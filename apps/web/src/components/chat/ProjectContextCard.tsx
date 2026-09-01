import type {
  OrchestrationThreadActivity,
  OrchestrationThread,
  ProjectContextSnapshot,
  ProjectHandoff,
  ProjectHandoffSummary,
  ProjectKnowledgeNote,
  ProjectSharedProviderConfiguration,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { deriveMcpDiagnostics } from "../../mcpDiagnostics";
import { deriveProviderQuotaStatus } from "../../providerQuota";
import { deriveContextCompactionRecovery } from "../../contextCompaction";
import { continuationPacketHandoff, deriveContinuationPacket } from "../../projectEvidence";
import { deriveReviewGate } from "@t3tools/client-runtime/review-gate";

const EMPTY_HANDOFF: ProjectHandoffSummary = {
  changed: [],
  decisions: [],
  verification: [],
  remaining: [],
};

function mergeHandoff(
  current: ProjectHandoffSummary,
  observed: ProjectHandoffSummary,
): ProjectHandoffSummary {
  const unique = (values: ReadonlyArray<string>) => [...new Set(values)].slice(0, 24);
  return {
    changed: unique([...current.changed, ...observed.changed]),
    decisions: current.decisions,
    verification: unique([...current.verification, ...observed.verification]),
    remaining: unique([...current.remaining, ...observed.remaining]),
  };
}

function safeExternalUrl(value: string | null): string | null {
  return value && /^https?:\/\//iu.test(value) ? value : null;
}

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
  thread,
  onSaveHandoff,
  onPromoteHandoff,
  onContinueFromHandoff,
  onOpenReview,
}: {
  readonly context: ProjectContextSnapshot | null;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly handoffThreadId?: string | null;
  readonly handoffs?: ReadonlyArray<ProjectHandoff> | undefined;
  readonly knowledgeNotes?: ReadonlyArray<ProjectKnowledgeNote> | undefined;
  readonly sharedProviderConfiguration?: ProjectSharedProviderConfiguration | undefined;
  readonly threadActivities?: ReadonlyArray<OrchestrationThreadActivity> | undefined;
  readonly thread?: Pick<OrchestrationThread, "session" | "latestTurn" | "checkpoints"> | null;
  readonly onSaveHandoff?: (summary: ProjectHandoffSummary) => void;
  readonly onPromoteHandoff?: () => void;
  readonly onContinueFromHandoff?: () => void;
  readonly onOpenReview?: () => void;
}) {
  const handoff =
    (handoffs ?? context?.handoffs ?? []).find((entry) => entry.threadId === handoffThreadId) ??
    null;
  const [draft, setDraft] = useState<ProjectHandoffSummary>(handoff?.summary ?? EMPTY_HANDOFF);
  const mcpDiagnostics = deriveMcpDiagnostics(threadActivities ?? [], sharedProviderConfiguration);
  const providerQuotaStatus = deriveProviderQuotaStatus(threadActivities ?? []);
  const compactionRecovery = deriveContextCompactionRecovery({
    activities: threadActivities ?? [],
    checkpoints: context?.recentCheckpoints ?? [],
    threadId: handoffThreadId,
  });
  const packet = thread
    ? deriveContinuationPacket({
        activities: threadActivities ?? [],
        checkpoints: thread.checkpoints,
        thread,
        quotaExhausted: providerQuotaStatus?.exhausted ?? false,
        compactionNeedsCheckpoint:
          compactionRecovery !== null && !compactionRecovery.checkpointedAfterCompaction,
      })
    : null;
  const reviewGate = packet
    ? deriveReviewGate({
        packet,
        quotaExhausted: providerQuotaStatus?.exhausted ?? false,
        compactionNeedsCheckpoint:
          compactionRecovery !== null && !compactionRecovery.checkpointedAfterCompaction,
        threadError: thread?.session?.status === "error" || thread?.latestTurn?.state === "error",
      })
    : null;
  useEffect(() => setDraft(handoff?.summary ?? EMPTY_HANDOFF), [handoff]);
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
            sharedProviderConfiguration.scopeGuardrail !== null ||
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
          {sharedProviderConfiguration?.scopeGuardrail ? (
            <div className="min-w-0 sm:col-span-2">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Scope guardrail
              </p>
              <p className="text-foreground">{sharedProviderConfiguration.scopeGuardrail}</p>
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
          {providerQuotaStatus?.exhausted ? (
            <div className="min-w-0 sm:col-span-2">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Continuation available
              </p>
              <p className="text-foreground">
                {providerQuotaStatus.provider} reported a rate limit. Save the handoff, choose a
                different provider in the composer, then continue from that reviewed summary.
              </p>
            </div>
          ) : null}
          {compactionRecovery ? (
            <div className="min-w-0 sm:col-span-2">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Context recovery
              </p>
              <p className="text-foreground">
                {compactionRecovery.checkpointedAfterCompaction
                  ? "Context was compacted and a later checkpoint was captured for this thread."
                  : "Context was compacted, but no later checkpoint is recorded yet. Let the turn settle before relying on a handoff or continuation."}
              </p>
            </div>
          ) : null}
          {packet ? (
            <div className="min-w-0 sm:col-span-2">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Continuation packet
              </p>
              <p className="text-foreground">
                {packet.changed.length > 0
                  ? `${packet.changed.length} checkpointed file${packet.changed.length === 1 ? "" : "s"}`
                  : "No checkpointed files"}
                {packet.verificationReceipts.length > 0
                  ? ` · ${packet.verificationReceipts.length} explicit command receipt${packet.verificationReceipts.length === 1 ? "" : "s"}`
                  : ""}
              </p>
              <p className="mt-1 text-muted-foreground">{packet.nextActions.join(" ")}</p>
            </div>
          ) : null}
          {reviewGate ? (
            <div className="min-w-0 sm:col-span-2">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Review gate
              </p>
              <p className="font-medium text-foreground">{reviewGate.title}</p>
              <div className="mt-1 space-y-1 text-muted-foreground">
                {reviewGate.checks
                  .filter((check) => check.status !== "not-applicable")
                  .map((check) => (
                    <p key={check.id}>
                      {check.status === "passed"
                        ? "Passed: "
                        : check.status === "not-run"
                          ? "Not run: "
                          : "Review: "}
                      {check.label}
                    </p>
                  ))}
              </div>
              {onOpenReview && packet.changed.length > 0 ? (
                <button
                  type="button"
                  className="mt-2 rounded border border-input px-2 py-1 text-xs text-foreground hover:bg-muted"
                  onClick={onOpenReview}
                >
                  Open changes for review
                </button>
              ) : null}
            </div>
          ) : null}
          {packet && packet.verificationReceipts.length > 0 ? (
            <div className="min-w-0 sm:col-span-2">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Verification receipts
              </p>
              <div className="space-y-1">
                {packet.verificationReceipts.slice(0, 6).map((receipt) => (
                  <p key={`${receipt.occurredAt}:${receipt.label}`} className="text-foreground">
                    {receipt.outcome === "passed" ? "Passed: " : "Failed: "}
                    {receipt.label}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          {packet && packet.research.length > 0 ? (
            <div className="min-w-0 sm:col-span-2">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Research evidence
              </p>
              <div className="space-y-1">
                {packet.research.slice(0, 6).map((evidence, index) => {
                  const url = safeExternalUrl(evidence.url);
                  return (
                    <p key={`${evidence.occurredAt}:${index}`} className="truncate text-foreground">
                      {evidence.query ?? "Provider web research"}
                      {url ? (
                        <>
                          {" · "}
                          <a
                            className="underline underline-offset-2"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {url}
                          </a>
                        </>
                      ) : null}
                    </p>
                  );
                })}
              </div>
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
                    {thread.mergeRisk === "shared-worktree"
                      ? "Shared worktree: "
                      : thread.mergeRisk === "declared-overlap"
                        ? "Declared overlap: "
                        : ""}
                    {thread.title}
                    {thread.branch ? ` · ${thread.branch}` : ""}
                    {thread.worktreePath ? ` · ${thread.worktreePath}` : ""}
                    {thread.overlappingChangedFiles.length > 0
                      ? ` · ${thread.overlappingChangedFiles.join(", ")}`
                      : ""}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          {handoff?.summary.changed.length ? (
            <div className="min-w-0 sm:col-span-2">
              <p className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                Declared file claims
              </p>
              <p className="text-foreground">{handoff.summary.changed.slice(0, 12).join(" · ")}</p>
              <p className="mt-1 text-muted-foreground">
                These are reviewed coordination signals, not file locks. Check related work before
                editing the same path.
              </p>
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
          {handoffThreadId && onSaveHandoff ? (
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
                {packet ? (
                  <button
                    type="button"
                    className="rounded border border-input px-2 py-1 text-xs text-foreground hover:bg-muted"
                    onClick={() =>
                      setDraft((current) =>
                        mergeHandoff(current, continuationPacketHandoff(packet)),
                      )
                    }
                  >
                    Apply observed evidence
                  </button>
                ) : null}
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
