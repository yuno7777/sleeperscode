import type { TaskFeedbackValue, TaskOutcomeTerminalState } from "@t3tools/contracts";

import type { MergedTaskAnalyticsRecord } from "./taskAnalyticsMerge.ts";

export const TASK_TIMELINE_MAX_EVENTS = 200;

export type TaskTimelineEventKind =
  | "requested"
  | "routing-recorded"
  | "terminal-observed"
  | "feedback-recorded";

export interface TaskTimelineEvent {
  readonly key: string;
  readonly timestamp: string;
  readonly kind: TaskTimelineEventKind;
  readonly environmentId: MergedTaskAnalyticsRecord["environmentId"];
  readonly environmentLabel: string;
  readonly threadId: MergedTaskAnalyticsRecord["threadId"];
  readonly terminalState?: TaskOutcomeTerminalState;
  readonly providerDriver?: string;
  readonly feedback?: TaskFeedbackValue;
}

const chronologicalRank: Readonly<Record<TaskTimelineEventKind, number>> = {
  requested: 0,
  "routing-recorded": 1,
  "terminal-observed": 2,
  "feedback-recorded": 3,
};

/**
 * Project the content-free evidence already stored for a task into a stable,
 * newest-first lifecycle timeline. This records observations, not success,
 * causal routing, task quality, or resource attribution.
 */
export function projectTaskTimeline(
  records: readonly MergedTaskAnalyticsRecord[],
  maxEvents = TASK_TIMELINE_MAX_EVENTS,
): readonly TaskTimelineEvent[] {
  const events: TaskTimelineEvent[] = [];
  for (const record of records) {
    const base = {
      environmentId: record.environmentId,
      environmentLabel: record.environmentLabel,
      threadId: record.threadId,
    };
    events.push({
      ...base,
      key: `${record.environmentId}:${record.threadId}:${record.requestedAt}:requested`,
      timestamp: record.requestedAt,
      kind: "requested",
    });
    if (record.route !== null) {
      events.push({
        ...base,
        key: `${record.environmentId}:${record.threadId}:${record.requestedAt}:routing-recorded`,
        timestamp: record.requestedAt,
        kind: "routing-recorded",
      });
    }
    if (record.outcome !== null) {
      events.push({
        ...base,
        key: `${record.environmentId}:${record.threadId}:${record.requestedAt}:terminal-observed`,
        timestamp: record.outcome.observedAt,
        kind: "terminal-observed",
        terminalState: record.outcome.terminalState,
        providerDriver: record.outcome.provider.driver,
      });
    }
    if (record.feedback !== undefined && record.feedback !== null) {
      events.push({
        ...base,
        key: `${record.environmentId}:${record.threadId}:${record.requestedAt}:feedback-recorded`,
        timestamp: record.feedback.observedAt,
        kind: "feedback-recorded",
        feedback: record.feedback.value,
      });
    }
  }
  events.sort((left, right) => {
    const timestampOrder = right.timestamp.localeCompare(left.timestamp);
    if (timestampOrder !== 0) return timestampOrder;
    const kindOrder = chronologicalRank[right.kind] - chronologicalRank[left.kind];
    if (kindOrder !== 0) return kindOrder;
    return left.key.localeCompare(right.key);
  });
  return events.slice(0, Math.max(0, Math.floor(maxEvents)));
}

export function describeTaskTimelineEvent(event: TaskTimelineEvent): string {
  switch (event.kind) {
    case "requested":
      return "Task requested";
    case "routing-recorded":
      return "Shadow router evidence recorded";
    case "terminal-observed":
      return `Terminal observation: ${event.terminalState ?? "unknown"}`;
    case "feedback-recorded":
      return `User feedback: ${event.feedback ?? "unknown"}`;
  }
}
