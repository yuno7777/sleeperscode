import { useNavigation } from "@react-navigation/native";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import {
  enumerateDays,
  formatCount,
  formatDayShort,
  formatPercent,
  formatTokens,
  formatUsd,
  hasUsageCostEstimate,
  makeWindow,
} from "@t3tools/shared/usageFormat";
import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { showConfirmDialog } from "../../components/ConfirmDialogHost";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useTaskAnalytics, useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { SettingsSection } from "../settings/components/SettingsSection";
import { UsageDailyChart } from "./UsageDailyChart";
import type { UsageChartMetric } from "./usageChartData";
import { PROVIDER_LABEL, useProviderColors } from "./usageProviders";
import { TaskAnalyticsSections, type MobileUsageAnalyticsView } from "./TaskAnalyticsSections";

const WINDOW_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

const CHART_HEIGHT = 180;

export function UsageRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [windowDays, setWindowDays] = useState<number>(30);
  const [metric, setMetric] = useState<UsageChartMetric>("cost");
  const [view, setView] = useState<"overview" | MobileUsageAnalyticsView>("overview");
  const [isClearing, setIsClearing] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);

  // Recomputed only when the window length changes, so a re-render does not
  // shift the range and refetch every environment.
  const window = useMemo(() => makeWindow(windowDays), [windowDays]);
  const { merged, environments, isPending, isPartial, refresh } = useUsage(window);
  const taskAnalytics = useTaskAnalytics(window);

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );

  // The pull spinner tracks re-scans of environments that have answered
  // before. The initial scan renders its own placeholder, and an unreachable
  // environment stays pending forever — neither may pin the spinner on.
  const refreshing =
    environments.some((entry) => entry.isPending && entry.summary !== null) ||
    taskAnalytics.environments.some((entry) => entry.isPending && entry.summary !== null);

  const clearHistory = () => {
    setIsClearing(true);
    setClearNotice(null);
    void taskAnalytics
      .clearHistory()
      .then((deletedRecords) => {
        setClearNotice(
          deletedRecords === 1
            ? "Cleared 1 local task record."
            : `Cleared ${deletedRecords} local task records.`,
        );
      })
      .catch(() => setClearNotice("Task history could not be cleared from every environment."))
      .finally(() => setIsClearing(false));
  };

  const confirmClearHistory = () => {
    const title = "Clear task and router history?";
    const message =
      "This permanently removes content-free task profiles, shadow routing decisions, and terminal observations from every connected environment. Conversations and usage transcripts are not changed.";
    if (process.env.EXPO_OS === "ios") {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel" },
        { text: "Clear history", style: "destructive", onPress: clearHistory },
      ]);
      return;
    }
    showConfirmDialog({
      title,
      message,
      confirmText: "Clear history",
      destructive: true,
      onConfirm: clearHistory,
    });
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Usage" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              refresh();
              taskAnalytics.refresh();
            }}
          />
        }
      >
        <SegmentedControl
          options={
            [
              { value: "overview", label: "Overview" },
              { value: "tasks", label: "Tasks" },
              { value: "router", label: "Router" },
            ] as const
          }
          selected={view}
          onSelect={setView}
        />

        <SegmentedControl
          options={WINDOW_OPTIONS.map((option) => ({ value: option.days, label: option.label }))}
          selected={windowDays}
          onSelect={setWindowDays}
        />

        {view === "overview" ? null : (
          <View className="gap-2">
            <Pressable
              accessibilityRole="button"
              disabled={taskAnalytics.environments.length === 0 || isClearing}
              onPress={confirmClearHistory}
              className="items-center rounded-full border-continuous bg-card px-4 py-2.5 disabled:opacity-50"
            >
              <Text className="font-t3-medium text-danger-foreground">
                {isClearing ? "Clearing…" : "Clear task history"}
              </Text>
            </Pressable>
            {clearNotice === null ? null : (
              <Text className="text-center text-sm text-foreground-muted">{clearNotice}</Text>
            )}
          </View>
        )}

        {view === "overview" ? (
          <UsageCoverageNotice environments={environments} merged={merged} isPartial={isPartial} />
        ) : null}

        {view === "overview" ? (
          isPending ? (
            <Text className="py-16 text-center text-base text-foreground-muted">
              Scanning provider transcripts…
            </Text>
          ) : environments.length === 0 ? (
            <Text className="py-16 text-center text-base text-foreground-muted">
              Connect an environment to see usage.
            </Text>
          ) : (
            <>
              <ProviderCoverageSection merged={merged} />
              <ChartCard
                merged={merged}
                days={days}
                metric={metric}
                onMetricChange={setMetric}
                sinceDay={window.sinceDay}
                untilDay={window.untilDay}
              />
              <ProviderSection merged={merged} metric={metric} />
              <TotalsSection merged={merged} />
              <ModelsSection merged={merged} />
            </>
          )
        ) : taskAnalytics.isPending || taskAnalytics.isPartial ? (
          <Text className="py-16 text-center text-base text-foreground-muted">
            Reading local task evidenceâ€¦
          </Text>
        ) : taskAnalytics.environments.length === 0 ? (
          <Text className="py-16 text-center text-base text-foreground-muted">
            Connect an environment to see task analytics.
          </Text>
        ) : (
          <TaskAnalyticsSections
            view={view}
            analytics={taskAnalytics.merged}
            onSetFeedback={(record, feedback) =>
              taskAnalytics.setFeedback(
                record.environmentId,
                record.threadId,
                record.requestedAt,
                feedback,
              )
            }
            notices={[
              ...taskAnalytics.environments
                .filter((environment) => environment.error !== null)
                .map((environment) => `${environment.label} could not report task analytics.`),
              ...taskAnalytics.merged.duplicateSources.map(
                (source) => `Counted one local task store once: ${source}.`,
              ),
            ]}
          />
        )}
      </ScrollView>
    </View>
  );
}

function ProviderCoverageSection({ merged }: { readonly merged: MergedUsage }) {
  if (merged.providerCoverage.length === 0) return null;

  return (
    <SettingsSection title="Providers on this host" card>
      {merged.providerCoverage.map((provider, index) => (
        <View
          key={`${provider.hostId}:${provider.instanceId}`}
          className={index === 0 ? "gap-1 p-4" : "gap-1 border-t border-border-subtle p-4"}
        >
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-base text-foreground">{provider.displayName}</Text>
              <Text className="text-xs text-foreground-tertiary">
                {provider.hostId} · {provider.instanceId}
              </Text>
            </View>
            <Text
              className={
                provider.observed
                  ? "text-xs text-success-foreground"
                  : provider.reporting !== "notReported"
                    ? "text-xs text-foreground-muted"
                    : "text-xs text-warning-foreground"
              }
            >
              {provider.observed
                ? "Usage observed"
                : provider.reporting !== "notReported"
                  ? "No usage in range"
                  : "Totals not reported"}
            </Text>
          </View>
          <Text className="text-sm text-foreground-muted">
            {provider.enabled ? "Enabled" : "Disabled"} ·{" "}
            {provider.routable ? "Routable" : "Manual selection"} ·{" "}
            {provider.authStatus === "authenticated"
              ? "Signed in"
              : provider.authStatus === "unauthenticated"
                ? "Sign-in required"
                : "Sign-in unconfirmed"}
          </Text>
          {provider.message === null ? null : (
            <Text className="text-sm text-foreground-muted">{provider.message}</Text>
          )}
        </View>
      ))}
    </SettingsSection>
  );
}

function SegmentedControl<Value extends number | string>(props: {
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly selected: Value;
  readonly onSelect: (value: Value) => void;
}) {
  return (
    <View className="flex-row overflow-hidden rounded-full border-continuous bg-card">
      {props.options.map((option) => {
        const active = option.value === props.selected;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => props.onSelect(option.value)}
            className={
              active
                ? "flex-1 items-center rounded-full bg-subtle-strong py-2"
                : "flex-1 items-center py-2"
            }
          >
            <Text
              className={
                active ? "text-sm font-t3-medium text-foreground" : "text-sm text-foreground-muted"
              }
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Headline figure, the animated daily chart, and its legend, in one card. */
function ChartCard(props: {
  readonly merged: MergedUsage;
  readonly days: readonly string[];
  readonly metric: UsageChartMetric;
  readonly onMetricChange: (metric: UsageChartMetric) => void;
  readonly sinceDay: string;
  readonly untilDay: string;
}) {
  const { merged, metric } = props;
  const colors = useProviderColors();
  const hasActivity = merged.daily.some((day) => day.totalTokens > 0);

  return (
    <View className="gap-4 rounded-[24px] border-continuous bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-sm text-foreground-muted">
            {metric === "cost" ? "Raw token cost" : "Processed tokens"}
          </Text>
          <Text className="text-4xl font-t3-bold tabular-nums text-foreground">
            {metric === "cost" ? `${formatUsd(merged.costUsd)}*` : formatTokens(merged.totalTokens)}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {metric === "cost"
              ? "* if billed at full API rate"
              : `Across ${formatCount(merged.sessions)} sessions`}
          </Text>
        </View>
        <MetricToggle metric={metric} onChange={props.onMetricChange} />
      </View>

      {hasActivity ? (
        <UsageDailyChart
          days={props.days}
          daily={merged.daily}
          metric={metric}
          height={CHART_HEIGHT}
        />
      ) : (
        <View style={{ height: CHART_HEIGHT }} className="items-center justify-center">
          <Text className="text-base text-foreground-muted">No activity in this window.</Text>
        </View>
      )}

      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-foreground-tertiary">{formatDayShort(props.sinceDay)}</Text>
        <View className="flex-row items-center gap-4">
          {merged.providers.map((provider) => (
            <View key={provider.provider} className="flex-row items-center gap-1.5">
              <View
                className="size-2 rounded-full"
                style={{ backgroundColor: colors[provider.provider] }}
              />
              <Text className="text-xs text-foreground-muted">
                {PROVIDER_LABEL[provider.provider]}
              </Text>
            </View>
          ))}
        </View>
        <Text className="text-xs text-foreground-tertiary">{formatDayShort(props.untilDay)}</Text>
      </View>
    </View>
  );
}

function MetricToggle(props: {
  readonly metric: UsageChartMetric;
  readonly onChange: (metric: UsageChartMetric) => void;
}) {
  return (
    <View className="flex-row overflow-hidden rounded-full bg-subtle">
      {(["cost", "tokens"] as const).map((option) => {
        const active = option === props.metric;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => props.onChange(option)}
            className={active ? "rounded-full bg-subtle-strong px-3 py-1.5" : "px-3 py-1.5"}
          >
            <Text
              className={
                active
                  ? "text-xs font-t3-medium uppercase text-foreground"
                  : "text-xs uppercase text-foreground-muted"
              }
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ProviderSection(props: {
  readonly merged: MergedUsage;
  readonly metric: UsageChartMetric;
}) {
  const { merged, metric } = props;
  const colors = useProviderColors();
  if (merged.providers.length === 0) return null;

  // Ranked by whatever the toggle is showing, so the rows always descend.
  // .sort() on a copy, not .toSorted(): Hermes doesn't ship the ES2023 method.
  const ordered = [...merged.providers].sort((a, b) =>
    metric === "cost" ? b.costUsd - a.costUsd : b.totalTokens - a.totalTokens,
  );

  return (
    <SettingsSection title="Providers" card>
      {ordered.map((provider, index) => {
        const share = metric === "cost" ? provider.costShare : provider.tokenShare;
        const hasCost = hasUsageCostEstimate(provider.provider);
        return (
          <View
            key={provider.provider}
            className={index === 0 ? "gap-2 p-4" : "gap-2 border-t border-border-subtle p-4"}
          >
            <View className="flex-row items-baseline justify-between gap-3">
              <View className="flex-row items-center gap-2">
                <View
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: colors[provider.provider] }}
                />
                <Text className="text-lg text-foreground">{PROVIDER_LABEL[provider.provider]}</Text>
              </View>
              <Text className="text-lg tabular-nums text-foreground">
                {metric === "cost"
                  ? hasCost
                    ? formatUsd(provider.costUsd)
                    : "N/A"
                  : formatTokens(provider.totalTokens)}
              </Text>
            </View>
            <View className="h-1 flex-row overflow-hidden rounded-full bg-subtle">
              <View
                className="h-full rounded-full"
                style={{ flex: share, backgroundColor: colors[provider.provider] }}
              />
              <View style={{ flex: 1 - share }} />
            </View>
            <Text className="text-sm text-foreground-muted">
              {metric === "cost"
                ? hasCost
                  ? `${formatPercent(share)} of cost · ${formatTokens(provider.totalTokens)} tokens`
                  : `Cost unavailable · ${formatTokens(provider.totalTokens)} tokens`
                : hasCost
                  ? `${formatPercent(share)} of tokens · ${formatUsd(provider.costUsd)}`
                  : `${formatPercent(share)} of tokens · cost unavailable`}
            </Text>
          </View>
        );
      })}
    </SettingsSection>
  );
}

function TotalsSection(props: { readonly merged: MergedUsage }) {
  const { merged } = props;
  const activeDays = merged.daily.filter((day) => day.totalTokens > 0).length;
  const dailyAverage = activeDays === 0 ? 0 : merged.totalTokens / activeDays;
  const observedInput = merged.uncachedInputTokens + merged.cachedInputTokens;
  const cachedShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;

  return (
    <SettingsSection title="Totals" card>
      <View className="flex-row flex-wrap">
        <MetricCell
          label="Processed tokens"
          value={formatTokens(merged.totalTokens)}
          detail={`${formatTokens(dailyAverage)} per active day`}
        />
        <MetricCell
          label="Cache savings"
          value={formatUsd(merged.costQuality.cacheSavingsUsd)}
          detail={
            merged.costUsd > 0
              ? `${(merged.costQuality.cacheSavingsUsd / merged.costUsd).toFixed(1)}x the raw cost`
              : "vs full input rates"
          }
        />
        <MetricCell
          label="Cached input"
          value={formatTokens(merged.cachedInputTokens)}
          detail={`${formatPercent(cachedShare)} of observed input`}
        />
        <MetricCell
          label="Uncached input"
          value={formatTokens(merged.uncachedInputTokens)}
          detail={`${formatTokens(merged.cacheCreationTokens)} cache writes`}
        />
        <MetricCell
          label="Output"
          value={formatTokens(merged.outputTokens)}
          detail={`incl. ${formatTokens(merged.reasoningTokens)} reasoning`}
        />
        <MetricCell
          label="Unpriced"
          value={formatPercent(merged.costQuality.unpricedShare)}
          detail="of records, excluded from cost"
        />
      </View>
    </SettingsSection>
  );
}

function MetricCell(props: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <View className="w-1/2 gap-0.5 p-4">
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <Text className="text-xl font-t3-medium tabular-nums text-foreground">{props.value}</Text>
      <Text className="text-xs text-foreground-tertiary">{props.detail}</Text>
    </View>
  );
}

function ModelsSection(props: { readonly merged: MergedUsage }) {
  const { merged } = props;
  const colors = useProviderColors();
  if (merged.models.length === 0) return null;

  return (
    <SettingsSection title="By model" card>
      {merged.models.map((model, index) => (
        <View
          key={`${model.provider}:${model.model}`}
          className={
            index === 0
              ? "flex-row items-center gap-3 p-4"
              : "flex-row items-center gap-3 border-t border-border-subtle p-4"
          }
        >
          <View
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: colors[model.provider] }}
          />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base text-foreground" numberOfLines={1}>
              {model.model}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {hasUsageCostEstimate(model.provider)
                ? `${formatPercent(model.costShare)} of cost · ${formatTokens(model.totalTokens)} tokens`
                : `Cost unavailable · ${formatTokens(model.totalTokens)} tokens`}
            </Text>
          </View>
          <Text className="text-base tabular-nums text-foreground">
            {hasUsageCostEstimate(model.provider) ? formatUsd(model.costUsd) : "N/A"}
          </Text>
        </View>
      ))}
    </SettingsSection>
  );
}

/**
 * Says plainly when the totals are incomplete: an environment still answering,
 * one that failed, or one whose transcripts another environment already
 * reported.
 */
function UsageCoverageNotice(props: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly merged: MergedUsage;
  readonly isPartial: boolean;
}) {
  const failed = props.environments.filter((environment) => environment.error !== null);
  const stale = props.environments.filter((environment) =>
    props.merged.staleEnvironments.includes(environment.environmentId),
  );
  const duplicateSources = props.merged.duplicateSources;
  if (
    failed.length === 0 &&
    stale.length === 0 &&
    duplicateSources.length === 0 &&
    !props.isPartial
  ) {
    return null;
  }

  return (
    <View className="gap-1 rounded-[16px] border-continuous bg-card px-4 py-3">
      {props.isPartial ? (
        <Text className="text-sm text-foreground-muted">
          Some environments are still reporting. Totals are partial.
        </Text>
      ) : null}
      {failed.map((environment) => (
        <Text key={environment.environmentId} className="text-sm text-foreground-muted">
          {environment.label} could not report usage.
        </Text>
      ))}
      {stale.map((environment) => (
        <Text key={environment.environmentId} className="text-sm text-foreground-muted">
          {environment.label} runs an older server version and is excluded from totals.
        </Text>
      ))}
      {duplicateSources.length > 0 ? (
        <Text className="text-sm text-foreground-muted">
          Counted once across environments sharing a transcript directory:{" "}
          {duplicateSources.join(", ")}
        </Text>
      ) : null}
    </View>
  );
}
