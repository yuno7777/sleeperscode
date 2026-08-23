/**
 * Multi-environment usage state.
 *
 * Every connected environment answers the same typed query; the client merges
 * the results. Raw transcripts never leave the machine that produced them.
 *
 * @module state/usage
 */
import { useAtomValue } from "@effect/atom-react";
import {
  USAGE_CONTRACT_VERSION,
  TASK_ANALYTICS_CONTRACT_VERSION,
  type EnvironmentId,
  type TaskFeedbackValue,
  type TaskAnalyticsSummary,
  type TaskAnalyticsSummaryInput,
  type UsageSummary,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { mergeUsage, type EnvironmentUsage, type MergedUsage } from "@t3tools/shared/usageMerge";
import {
  mergeTaskAnalytics,
  type EnvironmentTaskAnalytics,
  type MergedTaskAnalytics,
} from "@t3tools/shared/taskAnalyticsMerge";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

export interface EnvironmentUsageStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly summary: UsageSummary | null;
}

/**
 * Reads every environment's summary for one window.
 *
 * Keyed by the serialised window so switching ranges does not thrash the atom
 * cache, and so each environment's query is shared with any other reader of the
 * same window.
 */
const usageByWindowAtom = Atom.family((windowKey: string) =>
  Atom.make((get): readonly EnvironmentUsageStatus[] => {
    const input = JSON.parse(windowKey) as UsageSummaryInput;
    const presentations = get(environmentPresentations.presentationsAtom);

    const statuses: EnvironmentUsageStatus[] = [];
    for (const [environmentId, presentation] of presentations) {
      const result = get(serverEnvironment.usageSummary({ environmentId, input }));
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        isPending: result.waiting,
        error: result._tag === "Failure" ? "This environment could not report usage." : null,
        summary: Option.getOrNull(AsyncResult.value(result)),
      });
    }
    return statuses;
  }).pipe(Atom.withLabel(`web-usage:window:${windowKey}`)),
);

export interface UsageView {
  readonly merged: MergedUsage;
  readonly environments: readonly EnvironmentUsageStatus[];
  /** True until at least one environment has answered. */
  readonly isPending: boolean;
  /**
   * True while environments that have not failed are still answering. Failed
   * environments are reported through their own error rows: totals will not
   * improve by waiting on them, so they must not read as "still reporting".
   */
  readonly isPartial: boolean;
  readonly refresh: () => void;
}

export function useUsage(input: UsageSummaryInput): UsageView {
  const windowKey = useMemo(
    () =>
      JSON.stringify({
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        timeZone: input.timeZone,
      }),
    [input.sinceDay, input.untilDay, input.timeZone],
  );
  const atom = usageByWindowAtom(windowKey);
  const environments = useAtomValue(atom);

  // Refreshing only the derived atom would re-read the per-environment SWR
  // queries within their stale window and change nothing. Refresh each
  // environment's query so the button always rescans.
  const refresh = useCallback(() => {
    const input = JSON.parse(windowKey) as UsageSummaryInput;
    for (const environment of environments) {
      appAtomRegistry.refresh(
        serverEnvironment.usageSummary({ environmentId: environment.environmentId, input }),
      );
    }
  }, [environments, windowKey]);

  const merged = useMemo(() => {
    const answered: EnvironmentUsage[] = environments.flatMap((environment) =>
      environment.summary === null
        ? []
        : [
            {
              environmentId: environment.environmentId,
              label: environment.label,
              summary: environment.summary,
            },
          ],
    );
    return mergeUsage(answered, USAGE_CONTRACT_VERSION);
  }, [environments]);

  const answeredCount = environments.filter((environment) => environment.summary !== null).length;
  const stillReporting = environments.filter(
    (environment) => environment.summary === null && environment.error === null,
  ).length;

  return {
    merged,
    environments,
    isPending: answeredCount === 0 && stillReporting > 0,
    isPartial: answeredCount > 0 && stillReporting > 0,
    refresh,
  };
}

export interface EnvironmentTaskAnalyticsStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly summary: TaskAnalyticsSummary | null;
}

const taskAnalyticsByWindowAtom = Atom.family((windowKey: string) =>
  Atom.make((get): readonly EnvironmentTaskAnalyticsStatus[] => {
    const input = JSON.parse(windowKey) as TaskAnalyticsSummaryInput;
    const presentations = get(environmentPresentations.presentationsAtom);
    const statuses: EnvironmentTaskAnalyticsStatus[] = [];
    for (const [environmentId, presentation] of presentations) {
      const result = get(serverEnvironment.taskAnalytics({ environmentId, input }));
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        isPending: result.waiting,
        error:
          result._tag === "Failure" ? "This environment could not report task analytics." : null,
        summary: Option.getOrNull(AsyncResult.value(result)),
      });
    }
    return statuses;
  }).pipe(Atom.withLabel(`web-task-analytics:window:${windowKey}`)),
);

export interface TaskAnalyticsView {
  readonly merged: MergedTaskAnalytics;
  readonly environments: readonly EnvironmentTaskAnalyticsStatus[];
  readonly isPending: boolean;
  readonly isPartial: boolean;
  readonly refresh: () => void;
  readonly clearHistory: () => Promise<number>;
  readonly setFeedback: (
    environmentId: EnvironmentId,
    threadId: TaskAnalyticsSummary["records"][number]["threadId"],
    requestedAt: TaskAnalyticsSummary["records"][number]["requestedAt"],
    feedback: TaskFeedbackValue | null,
  ) => Promise<void>;
}

export function useTaskAnalytics(input: TaskAnalyticsSummaryInput): TaskAnalyticsView {
  const windowKey = useMemo(
    () =>
      JSON.stringify({
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        timeZone: input.timeZone,
      }),
    [input.sinceDay, input.untilDay, input.timeZone],
  );
  const environments = useAtomValue(taskAnalyticsByWindowAtom(windowKey));
  const clearCommand = useAtomCommand(serverEnvironment.clearTaskAnalytics, {
    reportFailure: false,
  });
  const feedbackCommand = useAtomCommand(serverEnvironment.setTaskFeedback, {
    reportFailure: false,
  });

  const refresh = useCallback(() => {
    const input = JSON.parse(windowKey) as TaskAnalyticsSummaryInput;
    for (const environment of environments) {
      appAtomRegistry.refresh(
        serverEnvironment.taskAnalytics({ environmentId: environment.environmentId, input }),
      );
    }
  }, [environments, windowKey]);

  const merged = useMemo(() => {
    const answered: EnvironmentTaskAnalytics[] = environments.flatMap((environment) =>
      environment.summary === null
        ? []
        : [
            {
              environmentId: environment.environmentId,
              label: environment.label,
              summary: environment.summary,
            },
          ],
    );
    return mergeTaskAnalytics(answered, TASK_ANALYTICS_CONTRACT_VERSION);
  }, [environments]);

  const clearHistory = useCallback(async () => {
    const targets = new Map<string, EnvironmentId>();
    for (const environment of environments) {
      targets.set(
        environment.summary?.sourceFingerprint ?? environment.environmentId,
        environment.environmentId,
      );
    }
    const results = await Promise.all(
      [...targets.values()].map((environmentId) => clearCommand({ environmentId, input: {} })),
    );
    let deletedRecords = 0;
    for (const result of results) {
      if (result._tag === "Failure") throw Cause.squash(result.cause);
      deletedRecords += result.value.deletedRecords;
    }
    refresh();
    return deletedRecords;
  }, [clearCommand, environments, refresh]);

  const setFeedback = useCallback(
    async (
      environmentId: EnvironmentId,
      threadId: TaskAnalyticsSummary["records"][number]["threadId"],
      requestedAt: TaskAnalyticsSummary["records"][number]["requestedAt"],
      feedback: TaskFeedbackValue | null,
    ) => {
      const result = await feedbackCommand({
        environmentId,
        input: { threadId, requestedAt, feedback },
      });
      if (result._tag === "Failure") throw Cause.squash(result.cause);
      const input = JSON.parse(windowKey) as TaskAnalyticsSummaryInput;
      appAtomRegistry.refresh(serverEnvironment.taskAnalytics({ environmentId, input }));
    },
    [feedbackCommand, windowKey],
  );

  const answeredCount = environments.filter((environment) => environment.summary !== null).length;
  const stillReporting = environments.filter(
    (environment) => environment.summary === null && environment.error === null,
  ).length;
  return {
    merged,
    environments,
    isPending: answeredCount === 0 && stillReporting > 0,
    isPartial: answeredCount > 0 && stillReporting > 0,
    refresh,
    clearHistory,
    setFeedback,
  };
}
