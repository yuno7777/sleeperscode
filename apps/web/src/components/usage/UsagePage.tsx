import type { BackgroundActivityProfile, UsageProviderKind } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import type { MergedProviderCoverage } from "@t3tools/shared/usageMerge";
import {
  describeResourceTelemetryStatus,
  formatResourceBytes,
  formatResourceCpuPercent,
  summarizeResourceTelemetry,
} from "@t3tools/shared/resourceTelemetrySummary";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, CheckIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useTaskAnalytics, useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import {
  enumerateDays,
  formatCount,
  formatDayShort,
  formatPercent,
  formatTokens,
  formatUsd,
  makeWindow,
  summarizeUsageCost,
} from "@t3tools/shared/usageFormat";
import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { UsageChartLegend, UsageProviderChart, type UsageChartMetric } from "./UsageProviderChart";
import { TaskAnalyticsPanel, type UsageAnalyticsView } from "./TaskAnalyticsPanel";
import { PROVIDER_COLOR, PROVIDER_LABEL, PROVIDER_MARK, PROVIDER_ORDER } from "./usageProviders";

const WINDOW_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

export function UsagePage() {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [metric, setMetric] = useState<UsageChartMetric>("cost");
  const [breakdown, setBreakdown] = useState<"model" | "day">("model");
  const [view, setView] = useState<"overview" | UsageAnalyticsView>("overview");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  const router = useRouter();

  // Recomputed only when the window length changes, so a re-render does not
  // shift the range and refetch every environment.
  const window = useMemo(() => makeWindow(windowDays), [windowDays]);
  const { merged, environments, isPending, isPartial, refresh } = useUsage(window);
  const taskAnalytics = useTaskAnalytics(window);

  // Hold the content until every environment is terminal. Rendering merged
  // totals while devices are still answering makes every number on the page
  // jump as each one lands.
  const settling = isPending || isPartial;

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );
  const recentDays = useMemo(() => merged.daily.toReversed().slice(0, 8), [merged.daily]);

  // Ranked by whatever the toggle is showing, so the bars always descend.
  const orderedProviders = useMemo(
    () =>
      merged.providers.toSorted((a, b) =>
        metric === "cost" ? b.costUsd - a.costUsd : b.totalTokens - a.totalTokens,
      ),
    [merged.providers, metric],
  );

  const activeDays = merged.daily.filter((day) => day.totalTokens > 0).length;
  const dailyAverage = activeDays === 0 ? 0 : merged.totalTokens / activeDays;
  const observedInput = merged.uncachedInputTokens + merged.cachedInputTokens;
  const cachedShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;
  const costSummary = summarizeUsageCost(merged.costQuality.unpricedShare);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              aria-label="Back"
              onClick={() => {
                if (canGoBack) {
                  router.history.back();
                  return;
                }
                void navigate({ to: "/" });
              }}
              className="mt-1 cursor-pointer rounded-md border border-border p-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftIcon className="size-3.5" />
            </button>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold text-foreground">Usage</h1>
              <p className="text-sm text-muted-foreground">
                {formatDayShort(window.sinceDay)} to {formatDayShort(window.untilDay)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive-outline"
              disabled={taskAnalytics.environments.length === 0 || isClearing}
              onClick={() => setClearConfirmOpen(true)}
            >
              <Trash2Icon />
              Clear history
            </Button>
            <div className="flex overflow-hidden rounded-md border border-border">
              {WINDOW_OPTIONS.map((option) => (
                <button
                  key={option.days}
                  type="button"
                  onClick={() => setWindowDays(option.days)}
                  className={cn(
                    "cursor-pointer px-3 py-1.5 text-xs",
                    option.days === windowDays
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                refresh();
                taskAnalytics.refresh();
              }}
              aria-label="Refresh analytics"
              className="cursor-pointer rounded-md border border-border p-2 text-muted-foreground hover:text-foreground"
            >
              <RefreshCwIcon className="size-3.5" />
            </button>
          </div>
        </header>

        <nav className="flex gap-5 border-b border-border" aria-label="Usage analytics views">
          {(["overview", "tasks", "router", "timeline"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={cn(
                "relative cursor-pointer pb-2 text-xs tracking-wide uppercase",
                view === option
                  ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-px after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option}
            </button>
          ))}
        </nav>

        {clearNotice === null ? null : (
          <p className="-mt-5 text-xs text-muted-foreground" role="status" aria-live="polite">
            {clearNotice}
          </p>
        )}

        {view === "overview" ? (
          settling ? (
            <>
              {environments.length > 1 ? <UsageDeviceStrip environments={environments} /> : null}
              <UsageSkeleton />
            </>
          ) : (
            <>
              <UsageCoverageNotice
                environments={environments}
                duplicateSources={merged.duplicateSources}
                staleEnvironments={merged.staleEnvironments}
              />

              <ProviderCoverageSection providers={merged.providerCoverage} />

              <SystemMetricsSection environments={environments} />

              {/* Cost first: the financial answer, then the provider split. */}
              <section className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                {/* The summary follows the chart toggle, so the headline and the
                  series are always reading the same units. */}
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs tracking-wide text-muted-foreground uppercase">
                      {metric === "cost" ? costSummary.label : "Processed tokens"}
                    </span>
                    <span className="text-4xl font-semibold text-foreground tabular-nums">
                      {metric === "cost"
                        ? `${formatUsd(merged.costUsd)}*`
                        : formatTokens(merged.totalTokens)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {metric === "cost"
                        ? costSummary.detail
                        : `Input, cache reads and output across ${formatCount(merged.sessions)} sessions.`}
                    </span>
                  </div>

                  {orderedProviders.map((provider) => {
                    const share = metric === "cost" ? provider.costShare : provider.tokenShare;
                    const hasCost = provider.hasPricedUsage;
                    return (
                      <div key={provider.provider} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between">
                          <span className="flex items-center gap-2 text-sm text-foreground">
                            <ProviderMark provider={provider.provider} className="size-4" />
                            {PROVIDER_LABEL[provider.provider]}
                          </span>
                          <span className="text-sm text-foreground tabular-nums">
                            {metric === "cost"
                              ? hasCost
                                ? formatUsd(provider.costUsd)
                                : "N/A"
                              : formatTokens(provider.totalTokens)}
                          </span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full"
                            style={{
                              width: `${(share * 100).toFixed(1)}%`,
                              backgroundColor: PROVIDER_COLOR[provider.provider],
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {metric === "cost"
                            ? hasCost
                              ? `${formatPercent(share)} of cost · ${formatTokens(provider.totalTokens)} tokens`
                              : `Cost unavailable · ${formatTokens(provider.totalTokens)} tokens`
                            : hasCost
                              ? `${formatPercent(share)} of tokens · ${formatUsd(provider.costUsd)}`
                              : `${formatPercent(share)} of tokens · cost unavailable`}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-medium text-foreground">
                      Daily {metric === "tokens" ? "processed tokens" : "cost"}
                    </h2>
                    <div className="flex items-center gap-4">
                      <div className="flex overflow-hidden rounded-md border border-border">
                        {(["cost", "tokens"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setMetric(option)}
                            className={cn(
                              "cursor-pointer px-2.5 py-1 text-[10px] tracking-wide uppercase",
                              option === metric
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                      <UsageChartLegend />
                    </div>
                  </div>
                  <UsageProviderChart days={days} daily={merged.daily} metric={metric} />
                </div>
              </section>

              <section className="grid grid-cols-2 gap-px border-y border-border bg-border md:grid-cols-5">
                <Metric
                  label="Processed tokens"
                  value={formatTokens(merged.totalTokens)}
                  detail={`${formatTokens(dailyAverage)} per active day`}
                />
                <Metric
                  label="Cached input"
                  value={formatTokens(merged.cachedInputTokens)}
                  detail={`${formatPercent(cachedShare)} of observed input`}
                />
                <Metric
                  label="Uncached input"
                  value={formatTokens(merged.uncachedInputTokens)}
                  detail={`${formatTokens(merged.cacheCreationTokens)} cache writes`}
                />
                <Metric
                  label="Output"
                  value={formatTokens(merged.outputTokens)}
                  detail={`includes ${formatTokens(merged.reasoningTokens)} reasoning`}
                />
                <Metric
                  label="Cache savings"
                  value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                  detail={
                    merged.costUsd > 0
                      ? `${(merged.costQuality.cacheSavingsUsd / merged.costUsd).toFixed(1)}x the raw token cost`
                      : "vs full input rates"
                  }
                />
              </section>

              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-foreground">Breakdown</h2>
                  <div className="flex overflow-hidden rounded-md border border-border">
                    {(["model", "day"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setBreakdown(option)}
                        className={cn(
                          "cursor-pointer px-2.5 py-1 text-[10px] tracking-wide uppercase",
                          option === breakdown
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                {breakdown === "model" ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 font-normal">Model</th>
                        <th className="py-2 text-right font-normal">Cost</th>
                        <th className="py-2 text-right font-normal">Share</th>
                        <th className="py-2 text-right font-normal">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {merged.models.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-muted-foreground">
                            No activity in this window.
                          </td>
                        </tr>
                      ) : (
                        merged.models.map((model) => (
                          <tr
                            key={`${model.provider}:${model.model}`}
                            className="border-b border-border/50"
                          >
                            <td className="py-2 text-foreground">
                              <span className="flex items-center gap-2">
                                <ProviderMark provider={model.provider} className="size-3.5" />
                                {model.model}
                              </span>
                            </td>
                            <td className="py-2 text-right text-foreground tabular-nums">
                              {model.hasPricedUsage ? formatUsd(model.costUsd) : "N/A"}
                            </td>
                            <td className="py-2 text-right text-muted-foreground tabular-nums">
                              {model.hasPricedUsage ? formatPercent(model.costShare) : "N/A"}
                            </td>
                            <td className="py-2 text-right text-muted-foreground tabular-nums">
                              {formatTokens(model.totalTokens)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 font-normal">Day</th>
                        {PROVIDER_ORDER.map((provider) => (
                          <th key={provider} className="py-2 text-right font-normal">
                            {PROVIDER_LABEL[provider]}
                          </th>
                        ))}
                        <th className="py-2 text-right font-normal">Total</th>
                        <th className="py-2 text-right font-normal">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentDays.length === 0 ? (
                        <tr>
                          <td
                            colSpan={PROVIDER_ORDER.length + 3}
                            className="py-6 text-center text-muted-foreground"
                          >
                            No activity in this window.
                          </td>
                        </tr>
                      ) : (
                        recentDays.map((day) => (
                          <tr key={day.day} className="border-b border-border/50">
                            <td className="py-2 text-foreground">{formatDayShort(day.day)}</td>
                            {PROVIDER_ORDER.map((provider) => (
                              <td
                                key={provider}
                                className="py-2 text-right text-muted-foreground tabular-nums"
                              >
                                {formatUsd(day.byProvider.get(provider)?.costUsd ?? 0)}
                              </td>
                            ))}
                            <td className="py-2 text-right text-foreground tabular-nums">
                              {formatUsd(day.costUsd)}
                            </td>
                            <td className="py-2 text-right text-muted-foreground tabular-nums">
                              {formatTokens(day.totalTokens)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )
        ) : taskAnalytics.isPending || taskAnalytics.isPartial ? (
          <UsageSkeleton />
        ) : (
          <TaskAnalyticsPanel
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
              ...taskAnalytics.merged.staleEnvironments.map(
                (environmentId) =>
                  `${taskAnalytics.environments.find((entry) => entry.environmentId === environmentId)?.label ?? environmentId} runs an incompatible analytics contract.`,
              ),
              ...taskAnalytics.merged.duplicateSources.map(
                (source) => `Counted one local task store once: ${source}.`,
              ),
            ]}
          />
        )}

        <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear task and router history?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the content-free task profiles, shadow routing decisions,
                and terminal observations stored by every connected environment. Conversations and
                provider usage transcripts are not changed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />} disabled={isClearing}>
                Cancel
              </AlertDialogClose>
              <Button
                variant="destructive"
                disabled={isClearing}
                onClick={() => {
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
                      setClearConfirmOpen(false);
                    })
                    .catch(() => {
                      setClearNotice("Task history could not be cleared from every environment.");
                    })
                    .finally(() => setIsClearing(false));
                }}
              >
                <Trash2Icon />
                {isClearing ? "Clearing…" : "Clear history"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </div>
    </ScrollArea>
  );
}

function SystemMetricsSection(props: { readonly environments: readonly EnvironmentUsageStatus[] }) {
  if (props.environments.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">Host system</h2>
        <p className="text-xs text-muted-foreground">
          Current T3 process telemetry is shown separately for each connected host. It is not task,
          provider, or whole-machine attribution.
        </p>
      </div>
      <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-2">
        {props.environments.map((environment) => (
          <HostSystemMetrics key={environment.environmentId} environment={environment} />
        ))}
      </div>
    </section>
  );
}

function HostSystemMetrics(props: { readonly environment: EnvironmentUsageStatus }) {
  const telemetry = useEnvironmentQuery(
    serverEnvironment.resourceTelemetry({
      environmentId: props.environment.environmentId,
      input: {},
    }),
  );
  const summary = telemetry.data === null ? null : summarizeResourceTelemetry(telemetry.data);
  const settings = useAtomValue(
    serverEnvironment.settingsValueAtom(props.environment.environmentId),
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "resource profile update",
  });

  return (
    <div className="flex min-w-0 flex-col gap-3 bg-background px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm text-foreground">{props.environment.label}</div>
          <div className="text-xs text-muted-foreground">T3 process telemetry</div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px]",
            summary?.status === "healthy"
              ? "border-emerald-500/50 text-emerald-400"
              : summary === null
                ? "border-border text-muted-foreground"
                : "border-amber-500/50 text-amber-400",
          )}
        >
          {summary === null
            ? telemetry.isPending
              ? "Starting"
              : telemetry.error === null
                ? "Waiting"
                : "Unavailable"
            : describeResourceTelemetryStatus(summary.status)}
        </span>
      </div>
      {summary === null ? (
        <p className="text-xs text-muted-foreground">
          {telemetry.error ?? "Waiting for this host's resource monitor."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px bg-border">
            <Metric
              label="T3 CPU"
              value={formatResourceCpuPercent(summary.currentCpuPercent)}
              detail={`${summary.processCount} tracked processes`}
            />
            <Metric
              label="Resident memory"
              value={formatResourceBytes(summary.currentRssBytes)}
              detail={`${formatResourceBytes(summary.peakRssBytes)} observed peak`}
            />
            <Metric
              label="Read rate"
              value={`${formatResourceBytes(summary.ioReadBytesPerSecond)}/s`}
              detail="T3 process I/O"
            />
            <Metric
              label="Write rate"
              value={`${formatResourceBytes(summary.ioWriteBytesPerSecond)}/s`}
              detail={`sampled every ${Math.round(summary.sampleIntervalMs / 1_000)}s`}
            />
          </div>
        </>
      )}
      <ResourceProfileControls
        currentProfile={settings?.backgroundActivity.profile ?? null}
        onSelect={(profile) =>
          void updateSettings({
            environmentId: props.environment.environmentId,
            input: {
              patch: {
                backgroundActivity: { schemaVersion: 1, profile, overrides: {} },
              },
            },
          })
        }
      />
    </div>
  );
}

const RESOURCE_PROFILES: readonly {
  readonly value: BackgroundActivityProfile;
  readonly label: string;
}[] = [
  { value: "performance", label: "Performance" },
  { value: "balanced", label: "Balanced" },
  { value: "battery-saver", label: "Battery saver" },
];

function ResourceProfileControls(props: {
  readonly currentProfile: BackgroundActivityProfile | "custom" | null;
  readonly onSelect: (profile: BackgroundActivityProfile) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">Background resource policy</p>
      <div className="flex flex-wrap gap-1.5" aria-label="Background resource policy">
        {RESOURCE_PROFILES.map((profile) => {
          const selected = props.currentProfile === profile.value;
          return (
            <button
              key={profile.value}
              type="button"
              aria-pressed={selected}
              onClick={() => props.onSelect(profile.value)}
              className={cn(
                "cursor-pointer border px-2 py-1 text-[10px]",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {profile.label}
            </button>
          );
        })}
      </div>
      {props.currentProfile === "custom" ? (
        <p className="text-[10px] text-muted-foreground">
          Custom settings are active; selecting a preset replaces their overrides.
        </p>
      ) : null}
    </div>
  );
}

function ProviderCoverageSection({
  providers,
}: {
  readonly providers: readonly MergedProviderCoverage[];
}) {
  if (providers.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">Providers on connected hosts</h2>
        <p className="text-xs text-muted-foreground">
          Installed providers stay visible even when their CLI does not expose trustworthy usage
          totals.
        </p>
      </div>
      <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => (
          <div
            key={`${provider.hostId}:${provider.instanceId}`}
            className="flex min-w-0 flex-col gap-2 bg-background px-3 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{provider.displayName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {provider.hostId} · {provider.instanceId}
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px]",
                  provider.observed
                    ? "border-success/40 text-success"
                    : provider.reporting !== "notReported"
                      ? "border-border text-muted-foreground"
                      : "border-warning/40 text-warning",
                )}
              >
                {provider.observed
                  ? "Usage observed"
                  : provider.reporting !== "notReported"
                    ? "No usage in range"
                    : "Totals not reported"}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{provider.enabled ? "Enabled" : "Disabled"}</span>
              <span>{provider.routable ? "Routable" : "Manual selection"}</span>
              <span>
                {provider.authStatus === "authenticated"
                  ? "Signed in"
                  : provider.authStatus === "unauthenticated"
                    ? "Sign-in required"
                    : "Sign-in unconfirmed"}
              </span>
            </div>
            {provider.message === null ? null : (
              <p className="text-xs text-muted-foreground">{provider.message}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Brand mark for the harness a row belongs to. */
function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const Mark = PROVIDER_MARK[provider];
  return <Mark className={cn("shrink-0", className)} aria-hidden />;
}

function Metric({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-background px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg text-foreground tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

/**
 * Says plainly when the totals are incomplete: an environment that failed, or
 * one whose transcripts another environment already reported. Environments
 * that are still answering never reach this notice; the page shows the
 * loading skeleton until every one is terminal.
 */
function UsageCoverageNotice({
  environments,
  duplicateSources,
  staleEnvironments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly string[];
}) {
  const failed = environments.filter((environment) => environment.error !== null);
  const stale = environments.filter((environment) =>
    staleEnvironments.includes(environment.environmentId),
  );
  if (failed.length === 0 && stale.length === 0 && duplicateSources.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 border border-border px-3 py-2 text-xs text-muted-foreground">
      {failed.map((environment) => (
        <span key={environment.label}>{environment.label} could not report usage.</span>
      ))}
      {stale.map((environment) => (
        <span key={environment.label}>
          {environment.label} runs an older server version and is excluded from totals.
        </span>
      ))}
      {duplicateSources.length > 0 ? (
        <span>
          Counted once across environments sharing a transcript directory:{" "}
          {duplicateSources.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Per-device progress while the page waits for every environment to answer.
 * Only rendered with two or more devices; a lone device has nothing to
 * enumerate.
 */
function UsageDeviceStrip({
  environments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
}) {
  const scanning = environments.filter(
    (environment) => environment.summary === null && environment.error === null,
  );
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border border-border px-3 py-2 text-xs">
      {environments.map((environment) => {
        if (environment.summary !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-foreground"
            >
              <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-300/90" aria-hidden />
              {environment.label}
            </span>
          );
        }
        if (environment.error !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-destructive"
            >
              <XIcon className="size-3" aria-hidden />
              {environment.label}
            </span>
          );
        }
        return (
          <span
            key={environment.environmentId}
            className="animate-status-pulse text-muted-foreground"
          >
            {environment.label}…
          </span>
        );
      })}
      <span className="ms-auto text-muted-foreground">
        {scanning.length === 1
          ? "1 device still scanning"
          : `${scanning.length} devices still scanning`}
      </span>
    </div>
  );
}

/** Deterministic bar heights (each unique: they double as keys). */
const SKELETON_BAR_HEIGHTS = [34, 58, 41, 72, 22, 12, 49, 63, 80, 38, 55, 26, 44, 67];

/**
 * Static stand-in with the loaded page's shape: headline, provider split,
 * chart and metrics strip. No shimmer; blocks fill in exactly once when the
 * last device answers.
 */
function UsageSkeleton() {
  return (
    <>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className="text-xs tracking-wide text-muted-foreground uppercase">
              Raw token cost
            </span>
            <div className="my-1.5 h-8 w-36 rounded-sm bg-muted" />
            <div className="h-3 w-28 rounded-sm bg-muted" />
          </div>

          {PROVIDER_ORDER.map((provider) => (
            <div key={provider} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <ProviderMark provider={provider} className="size-4" />
                  {PROVIDER_LABEL[provider]}
                </span>
                <div className="h-3.5 w-14 rounded-sm bg-muted" />
              </div>
              <div className="h-1 w-full rounded-full bg-muted" />
              <div className="h-3 w-36 rounded-sm bg-muted" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="py-1 text-sm font-medium text-foreground">Daily cost</h2>
          {/* Mirrors the chart's h-56 body and w-14 axis gutter to avoid a
              relayout when the real chart swaps in. */}
          <div className="flex h-56 items-end gap-1 pl-16">
            {SKELETON_BAR_HEIGHTS.map((height) => (
              <div
                key={height}
                className="flex-1 rounded-sm bg-muted"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-px border-y border-border bg-border md:grid-cols-5">
        {["Processed tokens", "Cached input", "Uncached input", "Output", "Cache savings"].map(
          (label) => (
            <div key={label} className="flex flex-col gap-0.5 bg-background px-4 py-3">
              <span className="text-xs text-muted-foreground">{label}</span>
              <div className="my-1 h-5 w-16 rounded-sm bg-muted" />
              <div className="h-3 w-24 rounded-sm bg-muted" />
            </div>
          ),
        )}
      </section>
    </>
  );
}
