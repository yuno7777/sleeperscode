import { useAtomValue } from "@effect/atom-react";
import {
  agentHubSummary,
  agentInstallProgressLabel,
  catalogDistributionLabel,
  catalogExternalUrl,
  catalogPrerequisiteLabel,
  catalogPrerequisiteStatuses,
  filterAgentCatalog,
  findAgentInstallation,
  providerReadinessLabel,
  type AgentHubCatalogFilter,
} from "@t3tools/client-runtime/agent-hub";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AgentInstallCommandState } from "@t3tools/client-runtime/state/server";
import {
  deriveAgentStatusLevels,
  type AgentCatalogEntry,
  type AgentCatalogUnavailableReason,
  type AgentInstallation,
  type AgentInstallPlan,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  DownloadIcon,
  MoonStarIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  WaypointsIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { EMPTY_FIRST_RUN_STATE, FIRST_RUN_STORAGE_KEY, FirstRunState } from "../../firstRun";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerProvidersAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
const FILTERS: ReadonlyArray<{ readonly value: AgentHubCatalogFilter; readonly label: string }> = [
  { value: "all", label: "All agents" },
  { value: "compatible", label: "Runs here" },
  { value: "verifiable", label: "Verifiable binary" },
  { value: "package", label: "Package manager" },
];

function catalogFailureLabel(reason: AgentCatalogUnavailableReason): string {
  switch (reason) {
    case "bad_status":
      return "The registry returned an unexpected status.";
    case "invalid_payload":
      return "The registry response did not match the supported contract.";
    default:
      return "The registry could not be reached from this device.";
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AgentHubPage() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) {
    return <AgentHubUnavailable />;
  }
  return <ConnectedAgentHub environmentId={environmentId} />;
}

function ConnectedAgentHub({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AgentHubCatalogFilter>("all");
  const [installPlan, setInstallPlan] = useState<AgentInstallPlan | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<AgentInstallation | null>(null);
  const [publisherAcknowledged, setPublisherAcknowledged] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [, setFirstRunState] = useLocalStorage(
    FIRST_RUN_STORAGE_KEY,
    EMPTY_FIRST_RUN_STATE,
    FirstRunState,
  );
  const catalogAtom = serverEnvironment.agentCatalog({
    environmentId,
    input: { refresh: true },
  });
  const catalogResult = useAtomValue(catalogAtom);
  const installationsAtom = serverEnvironment.agentInstallations({
    environmentId,
    input: {},
  });
  const installationsResult = useAtomValue(installationsAtom);
  const installationsSnapshot = Option.getOrNull(AsyncResult.value(installationsResult));
  const installations = installationsSnapshot?.installations ?? [];
  const installState = useAtomValue(serverEnvironment.agentInstallStateAtom(environmentId));
  const prepareAgentInstall = useAtomCommand(serverEnvironment.prepareAgentInstall, {
    reportFailure: false,
  });
  const installAgent = useAtomCommand(serverEnvironment.installAgent, { reportFailure: false });
  const uninstallAgent = useAtomCommand(serverEnvironment.uninstallAgent, { reportFailure: false });
  const snapshot = Option.getOrNull(AsyncResult.value(catalogResult));
  const catalog = snapshot?.agents ?? [];
  const filteredCatalog = useMemo(
    () => filterAgentCatalog(catalog, query, filter),
    [catalog, filter, query],
  );
  const summary = useMemo(() => agentHubSummary(providers, catalog), [catalog, providers]);
  const isPending = snapshot === null && catalogResult.waiting;
  const failed = snapshot === null && catalogResult._tag === "Failure";

  const describeCommandFailure = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
    const error = squashAtomCommandFailure(result);
    return error instanceof Error ? error.message : "The Agent Hub operation failed.";
  };

  const reviewInstall = async (agentId: string) => {
    setActionError(null);
    setPublisherAcknowledged(false);
    const result = await prepareAgentInstall({ environmentId, input: { agentId } });
    if (AsyncResult.isSuccess(result)) {
      setInstallPlan(result.value);
      return;
    }
    if (!isAtomCommandInterrupted(result)) setActionError(describeCommandFailure(result));
  };

  const confirmInstall = async () => {
    if (installPlan === null) return;
    setActionError(null);
    const result = await installAgent({
      environmentId,
      input: {
        agentId: installPlan.agentId,
        planId: installPlan.planId,
        acknowledgeUnverifiedPublisher: publisherAcknowledged,
      },
    });
    if (AsyncResult.isSuccess(result)) {
      setInstallPlan(null);
      setPublisherAcknowledged(false);
      appAtomRegistry.refresh(installationsAtom);
      return;
    }
    if (!isAtomCommandInterrupted(result)) setActionError(describeCommandFailure(result));
  };

  const confirmUninstall = async () => {
    if (uninstallTarget === null) return;
    setActionError(null);
    const result = await uninstallAgent({
      environmentId,
      input: { agentId: uninstallTarget.agentId, confirm: true },
    });
    if (AsyncResult.isSuccess(result)) {
      setUninstallTarget(null);
      appAtomRegistry.refresh(installationsAtom);
      return;
    }
    if (!isAtomCommandInterrupted(result)) setActionError(describeCommandFailure(result));
  };

  const goBack = () => {
    if (canGoBack) {
      router.history.back();
      return;
    }
    void navigate({ to: "/" });
  };

  return (
    <ScrollArea className="h-full bg-[radial-gradient(circle_at_86%_2%,color-mix(in_oklab,var(--primary)_9%,transparent),transparent_31rem)]">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button aria-label="Back" onClick={goBack} size="icon" variant="outline">
              <ArrowLeftIcon />
            </Button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
                  Agent Hub
                </h1>
                <Badge variant="warning">Alpha</Badge>
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                See what is integrated, what can route work, and what the ACP ecosystem can provide
                on this device.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setFirstRunState({ version: 1, completed: false })}
              variant="outline"
            >
              <SparklesIcon />
              Setup guide
            </Button>
            <Button
              aria-label="Refresh agent catalog"
              onClick={() => appAtomRegistry.refresh(catalogAtom)}
              variant="outline"
            >
              <RefreshCwIcon />
              Refresh catalog
            </Button>
          </div>
        </header>

        <section className="relative isolate overflow-hidden rounded-2xl border border-border/70 bg-card/75 p-5 shadow-sm sm:p-7">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 opacity-45 [background-image:linear-gradient(to_right,color-mix(in_oklab,var(--border)_60%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--border)_60%,transparent)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:linear-gradient(to_right,black,transparent_84%)]"
          />
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,.8fr)] lg:items-end">
            <div>
              <span className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
                <MoonStarIcon className="size-3.5" /> Sleepers control plane
              </span>
              <h2 className="mt-4 max-w-2xl text-balance text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
                One clear map of every coding agent in reach.
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                Discovery and verified binary installation are live. Every install is revalidated,
                checksum-checked, staged, and activated as an explicit provider instance.
              </p>
            </div>
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/70 bg-background/70">
              <Metric label="Integrated" value={summary.integrated} icon={CheckCircle2Icon} />
              <Metric label="Routable" value={summary.routable} icon={WaypointsIcon} />
              <Metric label="ACP catalog" value={summary.catalog} icon={SparklesIcon} />
              <Metric
                label="Verifiable binary"
                value={summary.checksumVerifiable}
                icon={ShieldCheckIcon}
              />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <SectionHeading
            eyebrow="Local fleet"
            title="Provider instances"
            detail="Built-in and Agent Hub providers share one runtime. Installed, integrated, and routable remain separate states."
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider) => (
              <BuiltInAgentCard
                key={provider.instanceId}
                provider={provider}
                onConfigure={() => void navigate({ to: "/settings/providers" })}
              />
            ))}
            {providers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                Provider status has not arrived from this device yet.
              </div>
            ) : null}
          </div>
        </section>

        <section className="flex flex-col gap-4 pb-8">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <SectionHeading
              eyebrow="Discovery"
              title="ACP registry"
              detail="Curated for protocol compatibility and authentication. Registry membership is not vendor endorsement."
            />
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[24rem]">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search agents"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search agents, authors, licenses..."
                  className="[&_[data-slot=input]]:pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={filter === option.value}
                    onClick={() => setFilter(option.value)}
                    className={cn(
                      "cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      filter === option.value
                        ? "border-primary/30 bg-primary/8 text-primary"
                        : "border-border/70 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {snapshot?.status === "stale" ? (
            <CatalogNotice tone="warning">
              Showing the last valid registry snapshot.{" "}
              {catalogFailureLabel(snapshot.reason ?? "request_failed")}
            </CatalogNotice>
          ) : null}
          {snapshot?.status === "unavailable" || failed ? (
            <CatalogNotice tone="error">
              {snapshot?.status === "unavailable"
                ? catalogFailureLabel(snapshot.reason)
                : "The catalog request could not be completed."}
            </CatalogNotice>
          ) : null}
          {actionError ? <CatalogNotice tone="error">{actionError}</CatalogNotice> : null}

          {isPending ? (
            <CatalogSkeleton />
          ) : filteredCatalog.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredCatalog.map((entry) => (
                <RegistryAgentCard
                  key={entry.agent.id}
                  entry={entry}
                  installation={findAgentInstallation(installations, entry.agent.id)}
                  installState={installState}
                  onReviewInstall={() => void reviewInstall(entry.agent.id)}
                  onUninstall={setUninstallTarget}
                />
              ))}
            </div>
          ) : snapshot?.status !== "unavailable" && !failed ? (
            <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
              <p className="text-sm font-medium text-foreground">No agents match this view</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try a broader search or switch back to All agents.
              </p>
            </div>
          ) : null}

          {snapshot?.status !== "unavailable" ? (
            <p className="font-mono text-[10px] tracking-wide text-muted-foreground/70 uppercase">
              {snapshot?.registryVersion ? `Registry ${snapshot.registryVersion} · ` : ""}
              {snapshot?.platformTriple ?? `${snapshot?.platform ?? "unknown"} platform`} · secure
              binary installs only
            </p>
          ) : null}
        </section>
        <AgentInstallDialog
          plan={installPlan}
          installState={installState}
          acknowledged={publisherAcknowledged}
          error={actionError}
          onAcknowledgedChange={setPublisherAcknowledged}
          onClose={() => {
            if (installState.status !== "running") setInstallPlan(null);
          }}
          onConfirm={() => void confirmInstall()}
        />
        <AlertDialog
          open={uninstallTarget !== null}
          onOpenChange={(open) => !open && setUninstallTarget(null)}
        >
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Uninstall {uninstallTarget?.displayName}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the Agent Hub provider and its app-managed files. External tools and
                repositories are not touched.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
              <Button
                disabled={installState.status === "running"}
                onClick={() => void confirmUninstall()}
                variant="destructive"
              >
                <Trash2Icon />
                Uninstall
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </main>
    </ScrollArea>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  readonly label: string;
  readonly value: number;
  readonly icon: typeof BotIcon;
}) {
  return (
    <div className="flex min-h-24 flex-col justify-between border-b border-r border-border/60 p-4 even:border-r-0 [&:nth-last-child(-n+2)]:border-b-0">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <div>
        <div className="font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  detail,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-foreground">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function BuiltInAgentCard({
  provider,
  onConfigure,
}: {
  readonly provider: ServerProvider;
  readonly onConfigure: () => void;
}) {
  const levels = deriveAgentStatusLevels(provider);
  const readiness = providerReadinessLabel(provider);
  const readinessVariant = levels.routable ? "success" : levels.integrated ? "info" : "warning";

  return (
    <article className="group flex min-w-0 flex-col gap-4 rounded-xl border border-border/70 bg-card/70 p-4 transition-colors hover:border-border hover:bg-card">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background font-mono text-xs font-semibold text-foreground">
          {initials(provider.displayName ?? provider.driver)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {provider.displayName ?? provider.driver}
            </h3>
            <Badge variant={readinessVariant}>{readiness}</Badge>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {provider.version ?? "Version unavailable"} · {provider.instanceId}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 text-center">
        <ReadinessCell label="Installed" ready={provider.installed} />
        <ReadinessCell label="Integrated" ready={levels.integrated} />
        <ReadinessCell label="Routable" ready={levels.routable} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="truncate text-[11px] text-muted-foreground">
          {provider.auth.status === "authenticated"
            ? (provider.auth.email ?? "Authenticated")
            : provider.auth.status === "unknown"
              ? "Auth unknown"
              : "Authentication required"}
        </span>
        <Button onClick={onConfigure} size="xs" variant="outline">
          Configure
        </Button>
      </div>
    </article>
  );
}

export function ReadinessCell({
  label,
  ready,
}: {
  readonly label: string;
  readonly ready: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1 bg-background/90 px-2 py-2.5">
      <span className="sr-only">
        {label}: {ready ? "Yes" : "No"}
      </span>
      {ready ? (
        <CheckCircle2Icon className="size-3.5 text-success-foreground" aria-hidden />
      ) : (
        <CircleAlertIcon className="size-3.5 text-muted-foreground/50" aria-hidden />
      )}
      <span className="text-[10px] text-muted-foreground" aria-hidden>
        {label}
      </span>
    </div>
  );
}

function RegistryAgentCard({
  entry,
  installation,
  installState,
  onReviewInstall,
  onUninstall,
}: {
  readonly entry: AgentCatalogEntry;
  readonly installation: AgentInstallation | undefined;
  readonly installState: AgentInstallCommandState;
  readonly onReviewInstall: () => void;
  readonly onUninstall: (installation: AgentInstallation) => void;
}) {
  const href = catalogExternalUrl(entry);
  const distribution = catalogDistributionLabel(entry);
  const safe = entry.installSafety.checksumVerifiable;
  const installing = installState.status === "running" && installState.agentId === entry.agent.id;
  const installable = entry.selectedDistribution.kind === "binary" && safe;

  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-xl border border-border/65 bg-card/45 p-4 hover:border-border hover:bg-card/75">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background font-mono text-[11px] font-semibold text-muted-foreground">
          {initials(entry.agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{entry.agent.name}</h3>
            {href ? (
              <a
                aria-label={`Open ${entry.agent.name} website`}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowUpRightIcon className="size-3.5" />
              </a>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            v{entry.agent.version} · {entry.agent.license ?? "License not listed"}
          </p>
        </div>
      </div>
      <p className="line-clamp-3 min-h-[3.75rem] text-xs leading-5 text-muted-foreground">
        {entry.agent.description ?? "ACP-compatible coding agent."}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={safe ? "success" : "warning"}>
          {safe ? <ShieldCheckIcon /> : <CircleAlertIcon />}
          {distribution}
        </Badge>
        <Badge variant="secondary">Registry · unverified</Badge>
        {catalogPrerequisiteStatuses(entry).map((status) => (
          <Badge
            key={status.prerequisite}
            variant={
              status.availability === "available"
                ? "success"
                : status.availability === "missing"
                  ? "warning"
                  : "outline"
            }
          >
            {catalogPrerequisiteLabel(status)}
          </Badge>
        ))}
      </div>
      {installation ? (
        <Button
          className="mt-auto w-full"
          disabled={installState.status === "running"}
          onClick={() => onUninstall(installation)}
          size="sm"
          variant="outline"
        >
          <Trash2Icon />
          Uninstall v{installation.version}
        </Button>
      ) : (
        <Button
          className="mt-auto w-full"
          disabled={!installable || installState.status === "running"}
          onClick={onReviewInstall}
          size="sm"
          variant="outline"
        >
          <DownloadIcon />
          {installing
            ? agentInstallProgressLabel(installState.event)
            : installable
              ? "Review secure install"
              : "No secure binary"}
        </Button>
      )}
    </article>
  );
}

function installBlockerLabel(blocker: AgentInstallPlan["blockers"][number]): string {
  switch (blocker) {
    case "distribution_not_binary":
      return "Only isolated binary distributions are enabled.";
    case "archive_not_https":
      return "The download is not HTTPS.";
    case "checksum_unavailable":
      return "The publisher did not provide a SHA-256 checksum.";
    case "archive_format_unsupported":
      return "The archive format is not supported.";
    case "command_path_unsafe":
      return "The declared command path is unsafe.";
  }
}

function AgentInstallDialog(props: {
  readonly plan: AgentInstallPlan | null;
  readonly installState: AgentInstallCommandState;
  readonly acknowledged: boolean;
  readonly error: string | null;
  readonly onAcknowledgedChange: (value: boolean) => void;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  const plan = props.plan;
  const installing =
    plan !== null &&
    props.installState.status === "running" &&
    props.installState.agentId === plan.agentId;
  const acknowledged = !plan?.requiresPublisherAcknowledgement || props.acknowledged;

  return (
    <Dialog open={plan !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPopup>
        {plan ? (
          <>
            <DialogHeader>
              <DialogTitle>Install {plan.displayName}</DialogTitle>
              <DialogDescription>
                Review the exact artifact Sleepers Code will download and activate.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/25 p-3 text-xs">
                <InstallDetail label="Publisher" value={plan.publisher} />
                <InstallDetail label="Version" value={plan.version} />
                <InstallDetail label="Download host" value={plan.archiveHost} />
                <InstallDetail label="Command" value={[plan.command, ...plan.args].join(" ")} />
                <InstallDetail label="SHA-256" value={plan.sha256 ?? "Not provided"} mono />
              </div>
              <CatalogNotice tone="warning">
                Registry membership does not verify or endorse this publisher. Sleepers Code
                verifies the downloaded bytes against the checksum supplied by that publisher.
              </CatalogNotice>
              {plan.blockers.length > 0 ? (
                <ul className="space-y-1 rounded-lg border border-destructive/25 bg-destructive/8 p-3 text-xs text-destructive-foreground">
                  {plan.blockers.map((blocker) => (
                    <li key={blocker}>- {installBlockerLabel(blocker)}</li>
                  ))}
                </ul>
              ) : null}
              {plan.requiresPublisherAcknowledgement ? (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 p-3 text-xs leading-5 text-muted-foreground">
                  <Checkbox
                    checked={props.acknowledged}
                    disabled={installing}
                    onCheckedChange={(checked) => props.onAcknowledgedChange(Boolean(checked))}
                  />
                  <span>
                    I understand that this registry entry and publisher are not independently
                    verified by Sleepers Code.
                  </span>
                </label>
              ) : null}
              {installing ? (
                <div className="rounded-lg border border-primary/25 bg-primary/8 px-3 py-2 text-xs text-primary">
                  {agentInstallProgressLabel(props.installState.event)}
                </div>
              ) : null}
              {props.error ? <CatalogNotice tone="error">{props.error}</CatalogNotice> : null}
            </DialogPanel>
            <DialogFooter>
              <Button disabled={installing} onClick={props.onClose} variant="outline">
                Cancel
              </Button>
              <Button
                disabled={!plan.canInstall || !acknowledged || installing}
                onClick={props.onConfirm}
              >
                <ShieldCheckIcon />
                {installing ? "Installing securely" : "Verify and install"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function InstallDetail({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("break-all text-foreground", mono && "font-mono text-[10px]")}>
        {value}
      </span>
    </div>
  );
}

function CatalogNotice({
  children,
  tone,
}: {
  readonly children: ReactNode;
  readonly tone: "warning" | "error";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        tone === "warning"
          ? "border-warning/25 bg-warning/8 text-warning-foreground"
          : "border-destructive/25 bg-destructive/8 text-destructive-foreground",
      )}
    >
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function CatalogSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading agent catalog">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-56 rounded-xl border border-border/60 bg-muted/20" />
      ))}
    </div>
  );
}

function AgentHubUnavailable() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <BotIcon className="mx-auto size-6 text-muted-foreground" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Agent Hub is unavailable</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect a primary Sleepers Code environment to read its provider and registry state.
        </p>
      </div>
    </div>
  );
}
