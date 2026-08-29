import type { RouterDecisionReason, TaskFeedbackValue } from "@t3tools/contracts";
import { explainRouterDecisionReason } from "@t3tools/shared/router";
import type {
  MergedTaskAnalytics,
  MergedTaskAnalyticsRecord,
} from "@t3tools/shared/taskAnalyticsMerge";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { describeTaskTimelineEvent, projectTaskTimeline } from "@t3tools/shared/taskTimeline";
import { useState } from "react";

import { cn } from "../../lib/utils";

export type UsageAnalyticsView = "tasks" | "router" | "timeline";

const humanize = (value: string) => value.replaceAll("-", " ");

function terminalTone(state: string): string {
  if (state === "completed") return "text-emerald-700 dark:text-emerald-300";
  if (state === "failed" || state === "aborted") return "text-destructive";
  return "text-amber-700 dark:text-amber-300";
}

export function TaskAnalyticsPanel({
  view,
  analytics,
  notices,
  onSetFeedback,
}: {
  readonly view: UsageAnalyticsView;
  readonly analytics: MergedTaskAnalytics;
  readonly notices: readonly string[];
  readonly onSetFeedback: (
    record: MergedTaskAnalyticsRecord,
    feedback: TaskFeedbackValue | null,
  ) => Promise<void>;
}) {
  const [pendingFeedbackKey, setPendingFeedbackKey] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const setFeedback = async (
    record: MergedTaskAnalyticsRecord,
    feedback: TaskFeedbackValue | null,
  ) => {
    const key = `${record.environmentId}:${record.threadId}:${record.requestedAt}`;
    setPendingFeedbackKey(key);
    setFeedbackError(null);
    try {
      await onSetFeedback(record, feedback);
    } catch {
      setFeedbackError("Task feedback could not be saved. Refresh and try again.");
    } finally {
      setPendingFeedbackKey(null);
    }
  };

  if (analytics.totalTasks === 0) {
    return (
      <section className="border border-border px-5 py-16 text-center">
        <p className="text-sm font-medium text-foreground">
          No local task evidence in this window.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          New normal turns will appear here after their server records a task profile.
        </p>
      </section>
    );
  }

  if (view === "timeline") {
    return <TaskTimeline analytics={analytics} notices={notices} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 border-l-2 border-foreground/70 pl-4">
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Local evidence only
        </p>
        <p className="max-w-3xl text-sm text-foreground">
          {view === "tasks"
            ? "Terminal states describe provider lifecycle, not correctness, acceptance, or quality."
            : "The router remains shadow-only. Expand a recent decision to see why it retained or questioned the user's existing selection."}
        </p>
      </div>

      {notices.length > 0 || analytics.truncated ? (
        <div className="border border-border px-3 py-2 text-xs text-muted-foreground">
          {notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
          {analytics.truncated ? <p>Showing the newest bounded records for this window.</p> : null}
        </div>
      ) : null}

      {view === "tasks" ? (
        <>
          <section className="grid grid-cols-2 gap-px border-y border-border bg-border md:grid-cols-4 xl:grid-cols-7">
            <EvidenceMetric label="Recorded tasks" value={analytics.totalTasks} />
            <EvidenceMetric label="Profiled" value={analytics.profiledTasks} />
            <EvidenceMetric label="Terminal observations" value={analytics.terminalTasks} />
            <EvidenceMetric label="Timed tasks" value={analytics.timedTasks} />
            <EvidenceMetric label="User feedback" value={analytics.feedbackTasks} />
            <EvidenceMetric
              label="Average elapsed"
              value={
                analytics.averageElapsedMs === null
                  ? "N/A"
                  : formatDuration(analytics.averageElapsedMs)
              }
              detail="request to terminal"
            />
            <EvidenceMetric
              label="Awaiting terminal state"
              value={analytics.totalTasks - analytics.terminalTasks}
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="flex min-w-0 flex-col gap-2">
              {feedbackError === null ? null : (
                <p role="alert" className="text-xs text-destructive">
                  {feedbackError}
                </p>
              )}
              <RecentTasksTable
                analytics={analytics}
                pendingFeedbackKey={pendingFeedbackKey}
                onSetFeedback={setFeedback}
              />
            </div>
            <div className="flex flex-col gap-5">
              <EvidenceBreakdown
                title="User feedback"
                entries={analytics.feedback.map(({ value, count }) => ({
                  label: humanize(value),
                  count,
                  tone:
                    value === "accepted"
                      ? "text-emerald-700 dark:text-emerald-300"
                      : value === "rejected"
                        ? "text-destructive"
                        : "text-amber-700 dark:text-amber-300",
                }))}
              />
              <EvidenceBreakdown
                title="Terminal states"
                entries={analytics.terminalStates.map(({ state, count }) => ({
                  label: humanize(state),
                  count,
                  tone: terminalTone(state),
                }))}
              />
              <EvidenceBreakdown
                title="Task domains"
                entries={analytics.domains.map(({ domain, count }) => ({
                  label: humanize(domain),
                  count,
                }))}
              />
              <EvidenceBreakdown
                title="Complexity"
                entries={analytics.complexities.map(({ complexity, count }) => ({
                  label: humanize(complexity),
                  count,
                }))}
              />
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-px border-y border-border bg-border md:grid-cols-4">
            <EvidenceMetric label="Shadow decisions" value={analytics.routedTasks} />
            <EvidenceMetric label="Applied decisions" value={0} detail="fixed by v1 contract" />
            <EvidenceMetric label="Context-limited" value={analytics.limitedRoutes} />
            <EvidenceMetric
              label="Without route evidence"
              value={analytics.totalTasks - analytics.routedTasks}
            />
          </section>

          <section className="grid gap-8 md:grid-cols-3">
            <EvidenceBreakdown
              title="Recommendations"
              entries={analytics.recommendations.map(({ recommendation, count }) => ({
                label: humanize(recommendation),
                count,
              }))}
            />
            <EvidenceBreakdown
              title="Selected eligibility"
              entries={analytics.eligibilities.map(({ eligibility, count }) => ({
                label: humanize(eligibility),
                count,
              }))}
            />
            <EvidenceBreakdown
              title="Observed providers"
              entries={analytics.providers.map(({ driver, count }) => ({
                label: humanize(driver),
                count,
              }))}
            />
          </section>

          <RecentTasksTable analytics={analytics} routerOnly />
        </>
      )}
    </div>
  );
}

function TaskTimeline({
  analytics,
  notices,
}: {
  readonly analytics: MergedTaskAnalytics;
  readonly notices: readonly string[];
}) {
  const events = projectTaskTimeline(analytics.records);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 border-l-2 border-foreground/70 pl-4">
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Content-free lifecycle evidence
        </p>
        <p className="max-w-3xl text-sm text-foreground">
          This is a chronological record of task requests, shadow-router evidence, terminal
          observations, and direct user feedback. It does not infer correctness or causality.
        </p>
      </div>
      {notices.length > 0 || analytics.truncated ? (
        <div className="border border-border px-3 py-2 text-xs text-muted-foreground">
          {notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
          {analytics.truncated ? <p>Source records are bounded to this window.</p> : null}
        </div>
      ) : null}
      <section className="border border-border">
        <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">Recent lifecycle events</h2>
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
            newest first
          </span>
        </div>
        {events.map((event) => (
          <div
            key={event.key}
            className="flex gap-3 border-b border-border/50 px-4 py-3 last:border-b-0"
          >
            <span className="mt-1 size-2 shrink-0 rounded-full bg-foreground/70" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{describeTaskTimelineEvent(event)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {event.environmentLabel} ·{" "}
                {new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(new Date(event.timestamp))}
              </p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function EvidenceMetric({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: number | string;
  readonly detail?: string;
}) {
  return (
    <div className="flex min-h-24 flex-col justify-between bg-background px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div>
        <span className="text-2xl font-semibold text-foreground tabular-nums">{value}</span>
        {detail === undefined ? null : (
          <span className="ml-2 text-[10px] text-muted-foreground">{detail}</span>
        )}
      </div>
    </div>
  );
}

function EvidenceBreakdown({
  title,
  entries,
}: {
  readonly title: string;
  readonly entries: readonly {
    readonly label: string;
    readonly count: number;
    readonly tone?: string;
  }[];
}) {
  const maximum = Math.max(1, ...entries.map((entry) => entry.count));
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No evidence yet.</p>
      ) : (
        entries.map((entry) => (
          <div key={entry.label} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className={cn("capitalize", entry.tone ?? "text-foreground")}>
                {entry.label}
              </span>
              <span className="text-muted-foreground tabular-nums">{entry.count}</span>
            </div>
            <div className="h-px bg-border">
              <div
                className="h-px bg-foreground/70"
                style={{ width: `${(entry.count / maximum) * 100}%` }}
              />
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function RecentTasksTable({
  analytics,
  routerOnly = false,
  pendingFeedbackKey = null,
  onSetFeedback,
}: {
  readonly analytics: MergedTaskAnalytics;
  readonly routerOnly?: boolean;
  readonly pendingFeedbackKey?: string | null;
  readonly onSetFeedback?: (
    record: MergedTaskAnalyticsRecord,
    feedback: TaskFeedbackValue | null,
  ) => Promise<void>;
}) {
  const records = analytics.records.slice(0, 50);
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">
          {routerOnly ? "Recent decisions" : "Recent tasks"}
        </h2>
        <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
          newest first
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className={cn("w-full text-xs", routerOnly ? "min-w-[70rem]" : "min-w-[58rem]")}>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-normal">Task</th>
              <th className="py-2 font-normal">Environment</th>
              <th className="py-2 font-normal">Selection</th>
              <th className="py-2 font-normal">{routerOnly ? "Outcome" : "Evidence"}</th>
              <th className="py-2 font-normal">
                {routerOnly ? "Why this decision" : "User feedback"}
              </th>
              <th className="py-2 text-right font-normal">Elapsed</th>
              <th className="py-2 text-right font-normal">Observed</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const state = record.outcome?.terminalState ?? "pending";
              const recordKey = `${record.environmentId}:${record.threadId}:${record.requestedAt}`;
              return (
                <tr
                  key={`${record.environmentId}:${record.threadId}:${record.requestedAt}`}
                  className="border-b border-border/50"
                >
                  <td className="py-3 pr-4 text-foreground">
                    <span className="capitalize">{record.profile?.kinds[0] ?? "unprofiled"}</span>
                    <span className="ml-2 text-muted-foreground">
                      {record.profile === null
                        ? ""
                        : `${humanize(record.profile.primaryDomain)} · ${humanize(record.profile.complexity)}`}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{record.environmentLabel}</td>
                  <td className="py-3 pr-4 text-foreground">
                    {record.route?.selectedInstanceId ?? "not recorded"}
                    {record.route === null ? null : (
                      <span className="ml-2 text-muted-foreground">shadow</span>
                    )}
                  </td>
                  <td className={cn("py-3 pr-4 capitalize", terminalTone(state))}>
                    {humanize(state)}
                  </td>
                  {routerOnly ? (
                    <td className="py-2 pr-4 align-top">
                      <RouterDecisionExplanation reasons={record.route?.reasons ?? []} />
                    </td>
                  ) : (
                    <td className="py-2 pr-4">
                      {record.outcome === null || record.feedback === undefined ? (
                        <span className="text-muted-foreground">
                          {record.feedback === undefined ? "not supported" : "after completion"}
                        </span>
                      ) : (
                        <TaskFeedbackControls
                          value={record.feedback?.value ?? null}
                          disabled={pendingFeedbackKey === recordKey}
                          onChange={(feedback) => onSetFeedback?.(record, feedback)}
                        />
                      )}
                    </td>
                  )}
                  <td className="py-3 pr-4 text-right text-muted-foreground tabular-nums">
                    {record.elapsedMs === undefined ? "—" : formatDuration(record.elapsedMs)}
                  </td>
                  <td className="py-3 text-right text-muted-foreground tabular-nums">
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(record.requestedAt))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RouterDecisionExplanation({
  reasons,
}: {
  readonly reasons: readonly RouterDecisionReason[];
}) {
  if (reasons.length === 0) {
    return <span className="text-muted-foreground">No reason record</span>;
  }
  const primary = explainRouterDecisionReason(reasons[0]!);
  return (
    <details className="min-w-64 max-w-80">
      <summary className="cursor-pointer font-medium text-foreground marker:text-muted-foreground">
        {primary.label}
        {reasons.length === 1 ? null : (
          <span className="ml-1 font-normal text-muted-foreground">+{reasons.length - 1}</span>
        )}
      </summary>
      <ul className="mt-2 flex flex-col gap-2 border-l border-border pl-3">
        {reasons.map((reason) => {
          const explanation = explainRouterDecisionReason(reason);
          return (
            <li key={reason}>
              <p className="font-medium text-foreground">{explanation.label}</p>
              <p className="mt-0.5 leading-4 text-muted-foreground">{explanation.detail}</p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

const feedbackOptions: readonly { readonly value: TaskFeedbackValue; readonly label: string }[] = [
  { value: "accepted", label: "Accepted" },
  { value: "needs-repair", label: "Repair" },
  { value: "rejected", label: "Rejected" },
];

function TaskFeedbackControls({
  value,
  disabled,
  onChange,
}: {
  readonly value: TaskFeedbackValue | null;
  readonly disabled: boolean;
  readonly onChange: (value: TaskFeedbackValue | null) => void;
}) {
  return (
    <div className="flex items-center gap-1" aria-label="Task feedback">
      {feedbackOptions.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : option.value)}
            className={cn(
              "border px-1.5 py-1 text-[10px] transition-colors disabled:cursor-wait disabled:opacity-50",
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
