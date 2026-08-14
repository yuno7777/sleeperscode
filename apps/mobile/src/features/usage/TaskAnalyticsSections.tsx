import type { MergedTaskAnalytics } from "@t3tools/shared/taskAnalyticsMerge";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SettingsSection } from "../settings/components/SettingsSection";

export type MobileUsageAnalyticsView = "tasks" | "router";

const humanize = (value: string) => value.replaceAll("-", " ");

export function TaskAnalyticsSections(props: {
  readonly view: MobileUsageAnalyticsView;
  readonly analytics: MergedTaskAnalytics;
  readonly notices: readonly string[];
}) {
  const { analytics, view } = props;
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
            : "Routing is shadow-only and never replaces the provider you selected."}
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
        {analytics.records.slice(0, 30).map((record, index) => (
          <View
            key={`${record.environmentId}:${record.threadId}:${record.requestedAt}:${index}`}
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
          </View>
        ))}
      </SettingsSection>

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

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <View className="w-1/2 gap-0.5 p-4">
      <Text className="text-sm text-foreground-muted">{label}</Text>
      <Text className="text-2xl font-t3-medium tabular-nums text-foreground">{value}</Text>
    </View>
  );
}
