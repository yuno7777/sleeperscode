import { useAtomValue } from "@effect/atom-react";
import { providerReadinessLabel } from "@t3tools/client-runtime/agent-hub";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { deriveAgentStatusLevels, type ServerProvider } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  LoaderCircleIcon,
  MoonStarIcon,
  RadarIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  WaypointsIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  EMPTY_FIRST_RUN_STATE,
  FIRST_RUN_STORAGE_KEY,
  FirstRunState,
  orderFirstRunProviders,
  shouldPresentFirstRun,
  summarizeFirstRunProviders,
} from "../../firstRun";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { usePrimaryEnvironmentId } from "../../state/environments";
import {
  primaryServerConfigAtom,
  primaryServerProvidersAtom,
  serverEnvironment,
} from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

type FirstRunStep = "welcome" | "agents";

export function FirstRunOnboarding({ enabled }: { readonly enabled: boolean }) {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const providers = useAtomValue(primaryServerProvidersAtom);
  const [state, setState] = useLocalStorage(
    FIRST_RUN_STORAGE_KEY,
    EMPTY_FIRST_RUN_STATE,
    FirstRunState,
  );
  const [step, setStep] = useState<FirstRunStep>("welcome");
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const open = shouldPresentFirstRun({
    enabled,
    serverReady: environmentId !== null && serverConfig !== null,
    completed: state.completed,
  });
  const orderedProviders = useMemo(() => orderFirstRunProviders(providers), [providers]);
  const summary = useMemo(() => summarizeFirstRunProviders(providers), [providers]);

  const complete = (destination?: "/agents") => {
    setState({ version: 1, completed: true });
    if (destination) void navigate({ to: destination });
  };

  const scan = async () => {
    setStep("agents");
    if (environmentId === null) return;
    setIsScanning(true);
    setScanError(null);
    const result = await refreshProviders({ environmentId, input: {} });
    setIsScanning(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setScanError(error instanceof Error ? error.message : "Provider discovery could not finish.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogPopup
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="max-w-4xl overflow-hidden border-border/75 bg-popover p-0 shadow-2xl shadow-black/30"
      >
        <div className="grid min-h-[30rem] md:min-h-[34rem] md:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="relative isolate hidden overflow-hidden border-r border-border/70 bg-muted/35 p-6 md:flex md:flex-col">
            <div
              aria-hidden
              className="absolute inset-0 -z-10 opacity-45 [background-image:linear-gradient(to_right,color-mix(in_oklab,var(--border)_60%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--border)_60%,transparent)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_84%)]"
            />
            <div className="flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
              <MoonStarIcon className="size-5" />
            </div>
            <p className="mt-4 font-mono text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
              Sleepers Code
            </p>
            <p className="mt-1 text-sm font-semibold tracking-[-0.02em] text-foreground">
              Night shift setup
            </p>

            <div className="mt-10 flex flex-col gap-1">
              <StepRailItem
                index="01"
                label="Welcome"
                active={step === "welcome"}
                done={step !== "welcome"}
              />
              <div className="ml-[0.9rem] h-7 w-px bg-border" />
              <StepRailItem index="02" label="Agent scan" active={step === "agents"} done={false} />
              <div className="ml-[0.9rem] h-7 w-px bg-border" />
              <StepRailItem index="03" label="Ready" active={false} done={false} />
            </div>

            <p className="mt-auto text-[11px] leading-5 text-muted-foreground">
              No provider credentials are copied into Sleepers Code. Every agent keeps its own
              sign-in.
            </p>
          </aside>

          <div className="flex min-w-0 flex-col">
            {step === "welcome" ? (
              <WelcomeStep />
            ) : (
              <AgentScanStep
                providers={orderedProviders}
                summary={summary}
                isScanning={isScanning}
                error={scanError}
              />
            )}

            <DialogFooter className="mt-auto justify-between border-t border-border/70 bg-muted/45 sm:justify-between">
              {step === "welcome" ? (
                <>
                  <Button variant="ghost" onClick={() => complete()}>
                    Skip setup
                  </Button>
                  <Button onClick={() => void scan()}>
                    <RadarIcon />
                    Scan this device
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => setStep("welcome")} disabled={isScanning}>
                    Back
                  </Button>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    <Button
                      variant="outline"
                      onClick={() => complete("/agents")}
                      disabled={isScanning}
                    >
                      <Settings2Icon />
                      Open Agent Hub
                    </Button>
                    <Button onClick={() => complete()} disabled={isScanning}>
                      Start coding
                      <ArrowRightIcon />
                    </Button>
                  </div>
                </>
              )}
            </DialogFooter>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function WelcomeStep() {
  return (
    <>
      <DialogHeader className="gap-3 px-6 pb-3 pt-7 sm:px-8 sm:pt-8">
        <div className="flex items-center gap-2 md:hidden">
          <MoonStarIcon className="size-4 text-primary" />
          <span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary uppercase">
            Sleepers Code
          </span>
        </div>
        <DialogTitle className="max-w-xl text-balance text-3xl leading-[1.05] tracking-[-0.045em] sm:text-4xl">
          Your coding agents. One quiet control plane.
        </DialogTitle>
        <DialogDescription className="max-w-xl text-sm leading-6 sm:text-base">
          Detect the agents already installed on this machine, see which ones are signed in, and
          keep every explicit provider choice under your control.
        </DialogDescription>
      </DialogHeader>

      <DialogPanel className="grid gap-3 px-6 pb-7 pt-4 sm:grid-cols-3 sm:px-8" scrollFade={false}>
        <ValueCard
          icon={BotIcon}
          title="Bring your agents"
          detail="Codex, Claude Code, Cursor, Grok, and OpenCode stay first-class integrations."
        />
        <ValueCard
          icon={WaypointsIcon}
          title="Remote ready"
          detail="Use the same environment from the desktop, browser, or mobile client."
        />
        <ValueCard
          icon={ShieldCheckIcon}
          title="Local by default"
          detail="Provider auth stays with provider CLIs; routing evidence remains content-free."
        />
      </DialogPanel>
    </>
  );
}

function AgentScanStep({
  providers,
  summary,
  isScanning,
  error,
}: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly summary: ReturnType<typeof summarizeFirstRunProviders>;
  readonly isScanning: boolean;
  readonly error: string | null;
}) {
  return (
    <>
      <DialogHeader className="gap-3 px-6 pb-3 pt-7 sm:px-8 sm:pt-8">
        <div className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-primary uppercase">
          {isScanning ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" />
          ) : (
            <SparklesIcon className="size-3.5" />
          )}
          {isScanning ? "Scanning provider paths" : "Device scan complete"}
        </div>
        <DialogTitle className="text-2xl tracking-[-0.035em] sm:text-3xl">
          {summary.installed} of {summary.total} agent instances detected
        </DialogTitle>
        <DialogDescription className="leading-6">
          Installed, authenticated, and routable are separate facts. Nothing is enabled or signed in
          automatically.
        </DialogDescription>
      </DialogHeader>

      <DialogPanel className="px-6 pb-6 pt-3 sm:px-8">
        <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/70 bg-border/70">
          <ScanMetric label="Installed" value={summary.installed} />
          <ScanMetric label="Signed in" value={summary.authenticated} />
          <ScanMetric label="Routable" value={summary.routable} />
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs leading-5 text-warning-foreground">
            The latest scan did not finish: {error} Existing provider state is shown below.
          </div>
        ) : null}

        <div className="mt-4 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {providers.map((provider) => (
            <ProviderScanRow key={provider.instanceId} provider={provider} />
          ))}
          {providers.length === 0 ? (
            <div className="col-span-full flex min-h-28 items-center justify-center rounded-xl border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
              {isScanning
                ? "Checking provider commands and authentication…"
                : "No provider instances reported yet."}
            </div>
          ) : null}
        </div>
      </DialogPanel>
    </>
  );
}

function ProviderScanRow({ provider }: { readonly provider: ServerProvider }) {
  const levels = deriveAgentStatusLevels(provider);
  const name = provider.displayName ?? provider.driver;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <article className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-card/65 p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background font-mono text-[11px] font-semibold text-foreground">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          <StatusDot ready={levels.routable} warning={provider.installed} />
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {providerReadinessLabel(provider)} ·{" "}
          {provider.auth.status === "authenticated"
            ? (provider.auth.email ?? "Signed in")
            : provider.auth.status === "unauthenticated"
              ? "Sign in required"
              : "Auth not verified"}
        </p>
      </div>
      {provider.installed ? (
        <CheckCircle2Icon
          className="size-4 shrink-0 text-success-foreground"
          aria-label="Installed"
        />
      ) : (
        <CircleAlertIcon
          className="size-4 shrink-0 text-muted-foreground/45"
          aria-label="Not detected"
        />
      )}
    </article>
  );
}

function StatusDot({ ready, warning }: { readonly ready: boolean; readonly warning: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        ready
          ? "bg-success-foreground"
          : warning
            ? "bg-warning-foreground"
            : "bg-muted-foreground/35",
      )}
    />
  );
}

function ScanMetric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="bg-background/90 px-3 py-3 text-center">
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</p>
    </div>
  );
}

function ValueCard({
  icon: Icon,
  title,
  detail,
}: {
  readonly icon: typeof BotIcon;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <article className="rounded-xl border border-border/70 bg-card/60 p-4">
      <Icon className="size-4 text-primary" />
      <h3 className="mt-5 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </article>
  );
}

function StepRailItem({
  index,
  label,
  active,
  done,
}: {
  readonly index: string;
  readonly label: string;
  readonly active: boolean;
  readonly done: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex size-7 items-center justify-center rounded-full border font-mono text-[9px]",
          active
            ? "border-primary/40 bg-primary/10 text-primary"
            : done
              ? "border-success-foreground/30 bg-success-foreground/8 text-success-foreground"
              : "border-border bg-background text-muted-foreground",
        )}
      >
        {done ? <CheckCircle2Icon className="size-3.5" /> : index}
      </div>
      <span
        className={cn("text-xs", active ? "font-medium text-foreground" : "text-muted-foreground")}
      >
        {label}
      </span>
    </div>
  );
}
