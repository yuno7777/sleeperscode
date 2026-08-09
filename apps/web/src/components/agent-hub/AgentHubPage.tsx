import { useAtomValue } from "@effect/atom-react";
import {
  agentHubSummary,
  catalogDistributionLabel,
  catalogExternalUrl,
  filterAgentCatalog,
  providerReadinessLabel,
  type AgentHubCatalogFilter,
} from "@t3tools/client-runtime/agent-hub";
import {
  deriveAgentStatusLevels,
  type AgentCatalogEntry,
  type AgentCatalogUnavailableReason,
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
  LockKeyholeIcon,
  MoonStarIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WaypointsIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerProvidersAtom, serverEnvironment } from "../../state/server";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
  const catalogAtom = serverEnvironment.agentCatalog({
    environmentId,
    input: { refresh: true },
  });
  const catalogResult = useAtomValue(catalogAtom);
  const snapshot = Option.getOrNull(AsyncResult.value(catalogResult));
  const catalog = snapshot?.agents ?? [];
  const filteredCatalog = useMemo(
    () => filterAgentCatalog(catalog, query, filter),
    [catalog, filter, query],
  );
  const summary = useMemo(() => agentHubSummary(providers, catalog), [catalog, providers]);
  const isPending = snapshot === null && catalogResult.waiting;
  const failed = snapshot === null && catalogResult._tag === "Failure";

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
          <Button
            aria-label="Refresh agent catalog"
            onClick={() => appAtomRegistry.refresh(catalogAtom)}
            variant="outline"
          >
            <RefreshCwIcon />
            Refresh catalog
          </Button>
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
                Discovery is live. Installation stays intentionally gated until publisher trust,
                consent, checksum verification, and rollback are enforced end to end.
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
            title="Built-in providers"
            detail="These adapters ship with Sleepers Code. Installed, integrated, and routable are separate states."
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

          {isPending ? (
            <CatalogSkeleton />
          ) : filteredCatalog.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredCatalog.map((entry) => (
                <RegistryAgentCard key={entry.agent.id} entry={entry} />
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
              {snapshot?.platformTriple ?? `${snapshot?.platform ?? "unknown"} platform`} · install
              execution disabled in alpha
            </p>
          ) : null}
        </section>
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

function ReadinessCell({ label, ready }: { readonly label: string; readonly ready: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 bg-background/90 px-2 py-2.5">
      {ready ? (
        <CheckCircle2Icon className="size-3.5 text-success-foreground" aria-hidden />
      ) : (
        <CircleAlertIcon className="size-3.5 text-muted-foreground/50" aria-hidden />
      )}
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function RegistryAgentCard({ entry }: { readonly entry: AgentCatalogEntry }) {
  const href = catalogExternalUrl(entry);
  const distribution = catalogDistributionLabel(entry);
  const safe = entry.installSafety.checksumVerifiable;

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
        {entry.prerequisites.map((prerequisite) => (
          <Badge key={prerequisite} variant="outline">
            Needs {prerequisite}
          </Badge>
        ))}
      </div>
      <Button disabled className="mt-auto w-full" size="sm" variant="outline">
        <LockKeyholeIcon />
        Install gated
      </Button>
    </article>
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
