import type { RouterDecisionReason, TaskFeedbackValue } from "@t3tools/contracts";
import { explainRouterDecisionReason } from "@t3tools/shared/router";
import type {
  MergedTaskAnalytics,
  MergedTaskAnalyticsRecord,
} from "@t3tools/shared/taskAnalyticsMerge";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SettingsSection } from "../settings/components/SettingsSection";

export type MobileUsageAnalyticsView = "tasks" | "router";

const humanize = (value: string) => value.replaceAll("-", " ");

export function TaskAnalyticsSections(props: {
  readonly view: MobileUsageAnalyticsView;
  readonly analytics: MergedTaskAnalytics;
  readonly notices: readonly string[];
  readonly onSetFeedback: (
    record: MergedTaskAnalyticsRecord,
    feedback: TaskFeedbackValue | null,
  ) => Promise<void>;
}) {
  const { analytics, view } = props;
  const [pendingFeedbackKey, setPendingFeedbackKey] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [expandedRouterKey, setExpandedRouterKey] = useState<string | null>(null);

  const setFeedback = async (
    record: MergedTaskAnalyticsRecord,
    feedback: TaskFeedbackValue | null,
  ) => {
    const key = `${record.environmentId}:${record.threadId}:${record.requestedAt}`;
    setPendingFeedbackKey(key);
    setFeedbackError(null);
    try {
      await props.onSetFeedback(record, feedback);
    } catch {
      setFeedbackError("Task feedback could not be saved. Pull to refresh and try again.");
    } finally {
      setPendingFeedbackKey(null);
    }
  };
  if (analytics.totalTasks === 0) {
    return (
      <View className="items-center gap-1 py-16">
        <Text className="text-base text-foreground">No local task evidence yet.</Text>
        <Text className="text-center text-sm text-foreground-muted">
          New normal turns will appear after their server records a task profile.
        </Text>
      </View>
    );
  }

  return (
    <>
      <View className="gap-1 rounded-[16px] border-continuous bg-card px-4 py-3">
        <Text className="text-xs font-t3-medium uppercase text-foreground-muted">
          Local evidence only
        </Text>
        <Text className="text-sm text-foreground">
          {view === "tasks"
            ? "Terminal states are provider lifecycle evidence, not correctness or quality."
            : "Routing is shadow-only. Open a recent decision to see why it retained or questioned your selection."}
        </Text>
        {props.notices.map((notice) => (
          <Text key={notice} className="text-xs text-foreground-tertiary">
            {notice}
          </Text>
        ))}
        {analytics.truncated ? (
          <Text className="text-xs text-foreground-tertiary">
            Showing the newest bounded records in this window.
          </Text>
        ) : null}
      </View>

      <SettingsSection title={view === "tasks" ? "Task evidence" : "Router evidence"} card>
        <View className="flex-row flex-wrap">
          {view === "tasks" ? (
            <>
              <Metric label="Recorded" value={analytics.totalTasks} />
              <Metric label="Profiled" value={analytics.profiledTasks} />
              <Metric label="Terminal" value={analytics.terminalTasks} />
              <Metric label="Timed" value={analytics.timedTasks} />
              <Metric label="User feedback" value={analytics.feedbackTasks} />
              <Metric
                label="Average elapsed"
                value={
                  analytics.averageElapsedMs === null
                    ? "N/A"
                    : formatDuration(analytics.averageElapsedMs)
                }
              />
              <Metric label="Pending" value={analytics.totalTasks - analytics.terminalTasks} />
            </>
          ) : (
            <>
              <Metric label="Shadow decisions" value={analytics.routedTasks} />
              <Metric label="Applied" value={0} />
              <Metric label="Context-limited" value={analytics.limitedRoutes} />
              <Metric
                label="No route record"
                value={analytics.totalTasks - analytics.routedTasks}
              />
            </>
          )}
        </View>
      </SettingsSection>

      <SettingsSection title={view === "tasks" ? "Recent tasks" : "Recent decisions"} card>
        {analytics.records.slice(0, 30).map((record, index) => {
          const recordKey = `${record.environmentId}:${record.threadId}:${record.requestedAt}`;
          return (
            <View
              key={recordKey}
              className={index === 0 ? "gap-1 p-4" : "gap-1 border-t border-border-subtle p-4"}
            >
              <View className="flex-row items-baseline justify-between gap-3">
                <Text
                  className="min-w-0 flex-1 text-base capitalize text-foreground"
                  numberOfLines={1}
                >
                  {view === "tasks"
                    ? (record.profile?.kinds[0] ?? "unprofiled")
                    : (record.route?.selectedInstanceId ?? "not recorded")}
                </Text>
                <Text className="text-sm capitalize text-foreground-muted">
                  {humanize(record.outcome?.terminalState ?? "pending")}
                  {record.elapsedMs === undefined ? "" : ` · ${formatDuration(record.elapsedMs)}`}
                </Text>
              </View>
              <Text className="text-sm capitalize text-foreground-muted" numberOfLines={1}>
                {record.environmentLabel}
                {view === "tasks" && record.profile !== null
                  ? ` · ${humanize(record.profile.primaryDomain)} · ${humanize(record.profile.complexity)}`
                  : record.route === null
                    ? ""
                    : ` · ${humanize(record.route.recommendation)}`}
              </Text>
              {view === "tasks" && record.outcome !== null && record.feedback !== undefined ? (
                <TaskFeedbackControls
                  value={record.feedback?.value ?? null}
                  disabled={pendingFeedbackKey === recordKey}
                  onChange={(feedback) => void setFeedback(record, feedback)}
                />
              ) : null}
              {view === "router" && record.route !== null ? (
                <RouterDecisionExplanation
                  reasons={record.route.reasons}
                  expanded={expandedRouterKey === recordKey}
                  onToggle={() =>
                    setExpandedRouterKey((current) => (current === recordKey ? null : recordKey))
                  }
                />
              ) : null}
            </View>
          );
        })}
      </SettingsSection>

      {view === "tasks" ? (
        <SettingsSection title="User feedback" card>
          {feedbackError === null ? null : (
            <Text className="px-4 pt-4 text-sm text-destructive">{feedbackError}</Text>
          )}
          {analytics.feedback.length === 0 ? (
            <Text className="p-4 text-sm text-foreground-muted">No direct feedback yet.</Text>
          ) : (
            analytics.feedback.map((entry, index) => (
              <View
                key={entry.value}
                className={
                  index === 0
                    ? "flex-row items-center justify-between p-4"
                    : "flex-row items-center justify-between border-t border-border-subtle p-4"
                }
              >
                <Text className="text-base capitalize text-foreground">
                  {humanize(entry.value)}
                </Text>
                <Text className="text-base tabular-nums text-foreground-muted">{entry.count}</Text>
              </View>
            ))
          )}
        </SettingsSection>
      ) : null}

      <SettingsSection title={view === "tasks" ? "Terminal states" : "Recommendations"} card>
        {(view === "tasks" ? analytics.terminalStates : analytics.recommendations).map(
          (entry, index) => {
            const label = "state" in entry ? entry.state : entry.recommendation;
            return (
              <View
                key={label}
                className={
                  index === 0
                    ? "flex-row items-center justify-between p-4"
                    : "flex-row items-center justify-between border-t border-border-subtle p-4"
                }
              >
                <Text className="text-base capitalize text-foreground">{humanize(label)}</Text>
                <Text className="text-base tabular-nums text-foreground-muted">{entry.count}</Text>
              </View>
            );
          },
        )}
      </SettingsSection>
    </>
  );
}

function RouterDecisionExplanation({
  reasons,
  expanded,
  onToggle,
}: {
  readonly reasons: readonly RouterDecisionReason[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const visibleReasons = expanded ? reasons : reasons.slice(0, 1);
  return (
    <View className="mt-2 gap-2 border-l border-border pl-3">
      {visibleReasons.map((reason) => {
        const explanation = explainRouterDecisionReason(reason);
        return (
          <View key={reason} className="gap-0.5">
            <Text className="text-sm font-t3-medium text-foreground">{explanation.label}</Text>
            <Text className="text-xs leading-4 text-foreground-muted">{explanation.detail}</Text>
          </View>
        );
      })}
      {reasons.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onToggle}
          className="self-start py-1 active:opacity-60"
        >
          <Text className="text-xs font-t3-medium text-foreground">
            {expanded ? "Show less" : `Show ${reasons.length - 1} more`}
          </Text>
        </Pressable>
      ) : null}
    </View>
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
    <View className="mt-2 flex-row gap-2" accessibilityLabel="Task feedback">
      {feedbackOptions.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(selected ? null : option.value)}
            className={
              selected
                ? "rounded-full bg-foreground px-3 py-1.5 active:opacity-70"
                : "rounded-full border border-border px-3 py-1.5 active:bg-fill-tertiary"
            }
          >
            <Text
              className={selected ? "text-xs text-background" : "text-xs text-foreground-muted"}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number | string }) {
  return (
    <View className="w-1/2 gap-0.5 p-4">
      <Text className="text-sm text-foreground-muted">{label}</Text>
      <Text className="text-2xl font-t3-medium tabular-nums text-foreground">{value}</Text>
    </View>
  );
}
