import { useAtomValue } from "@effect/atom-react";
import {
  agentHubSummary,
  agentInstallProgressLabel,
  catalogDistributionLabel,
  filterAgentCatalog,
  findAgentInstallation,
  providerReadinessLabel,
  type AgentHubCatalogFilter,
} from "@t3tools/client-runtime/agent-hub";
import {
  type AtomCommandResult,
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
import { useNavigation } from "@react-navigation/native";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  type ColorValue,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { type EnvironmentPresentation, useEnvironments } from "../../state/environments";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const FILTERS: ReadonlyArray<{
  readonly value: AgentHubCatalogFilter;
  readonly label: string;
}> = [
  { value: "all", label: "All" },
  { value: "compatible", label: "Runs here" },
  { value: "verifiable", label: "Verifiable" },
  { value: "package", label: "Packages" },
];

const EMPTY_PROVIDERS: ReadonlyArray<ServerProvider> = [];

function catalogFailureLabel(reason: AgentCatalogUnavailableReason): string {
  switch (reason) {
    case "bad_status":
      return "The registry returned an unexpected status.";
    case "invalid_payload":
      return "The registry response did not match the supported contract.";
    default:
      return "The registry could not be reached from this environment.";
  }
}

export function AgentHubRouteScreen() {
  const navigation = useNavigation();
  const { environments } = useEnvironments();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    environments[0]?.environmentId ?? null,
  );

  useEffect(() => {
    if (
      selectedEnvironmentId === null ||
      !environments.some((environment) => environment.environmentId === selectedEnvironmentId)
    ) {
      setSelectedEnvironmentId(environments[0]?.environmentId ?? null);
    }
  }, [environments, selectedEnvironmentId]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Agent Hub" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      {selectedEnvironmentId === null ? (
        <AgentHubEmpty />
      ) : (
        <ConnectedAgentHub
          environmentId={selectedEnvironmentId}
          environments={environments}
          onSelectEnvironment={setSelectedEnvironmentId}
        />
      )}
    </View>
  );
}

function ConnectedAgentHub(props: {
  readonly environmentId: EnvironmentId;
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
  readonly onSelectEnvironment: (environmentId: EnvironmentId) => void;
}) {
  const insets = useSafeAreaInsets();
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  const providers = config?.providers ?? EMPTY_PROVIDERS;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AgentHubCatalogFilter>("all");
  const catalogQuery = useEnvironmentQuery(
    serverEnvironment.agentCatalog({
      environmentId: props.environmentId,
      input: { refresh: true },
    }),
  );
  const installationsAtom = serverEnvironment.agentInstallations({
    environmentId: props.environmentId,
    input: {},
  });
  const installationsQuery = useEnvironmentQuery(installationsAtom);
  const installations = installationsQuery.data?.installations ?? [];
  const installState = useAtomValue(serverEnvironment.agentInstallStateAtom(props.environmentId));
  const prepareAgentInstall = useAtomCommand(serverEnvironment.prepareAgentInstall, {
    reportFailure: false,
  });
  const installAgent = useAtomCommand(serverEnvironment.installAgent, { reportFailure: false });
  const uninstallAgent = useAtomCommand(serverEnvironment.uninstallAgent, {
    reportFailure: false,
  });
  const snapshot = catalogQuery.data;
  const catalog = snapshot?.agents ?? [];
  const filteredCatalog = useMemo(
    () => filterAgentCatalog(catalog, query, filter),
    [catalog, filter, query],
  );
  const summary = useMemo(() => agentHubSummary(providers, catalog), [catalog, providers]);

  const showCommandFailure = (title: string, result: AtomCommandResult<unknown, unknown>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    Alert.alert(title, error instanceof Error ? error.message : "The Agent Hub operation failed.");
  };

  const runInstall = async (plan: AgentInstallPlan, acknowledged: boolean) => {
    const result = await installAgent({
      environmentId: props.environmentId,
      input: {
        agentId: plan.agentId,
        planId: plan.planId,
        acknowledgeUnverifiedPublisher: acknowledged,
      },
    });
    if (AsyncResult.isSuccess(result)) {
      appAtomRegistry.refresh(installationsAtom);
      return;
    }
    showCommandFailure("Installation failed", result);
  };

  const reviewInstall = async (entry: AgentCatalogEntry) => {
    const result = await prepareAgentInstall({
      environmentId: props.environmentId,
      input: { agentId: entry.agent.id },
    });
    if (!AsyncResult.isSuccess(result)) {
      showCommandFailure("Could not prepare installation", result);
      return;
    }
    const plan = result.value;
    const checksum = plan.sha256 ?? "Not provided";
    const blockers = plan.blockers.length > 0 ? `\n\nBlocked: ${plan.blockers.join(", ")}` : "";
    Alert.alert(
      `Install ${plan.displayName}?`,
      `Publisher: ${plan.publisher}\nVersion: ${plan.version}\nHost: ${plan.archiveHost}\nCommand: ${[plan.command, ...plan.args].join(" ")}\nSHA-256: ${checksum}\n\nRegistry membership does not verify or endorse this publisher.${blockers}`,
      plan.canInstall
        ? [
            { text: "Cancel", style: "cancel" },
            {
              text: plan.requiresPublisherAcknowledgement
                ? "I understand & install"
                : "Verify & install",
              onPress: () => void runInstall(plan, plan.requiresPublisherAcknowledgement),
              style: "default",
            },
          ]
        : [{ text: "Close", style: "cancel" }],
    );
  };

  const confirmUninstall = (installation: AgentInstallation) => {
    Alert.alert(
      `Uninstall ${installation.displayName}?`,
      "This removes the Agent Hub provider and its app-managed files. External tools and repositories are not touched.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Uninstall",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const result = await uninstallAgent({
                environmentId: props.environmentId,
                input: { agentId: installation.agentId, confirm: true },
              });
              if (AsyncResult.isSuccess(result)) {
                appAtomRegistry.refresh(installationsAtom);
                return;
              }
              showCommandFailure("Uninstall failed", result);
            })();
          },
        },
      ],
    );
  };

  return (
    <FlatList
      data={filteredCatalog}
      keyExtractor={(entry) => entry.agent.id}
      renderItem={({ item }) => (
        <RegistryAgentCard
          entry={item}
          installation={findAgentInstallation(installations, item.agent.id)}
          installState={installState}
          onInstall={() => void reviewInstall(item)}
          onUninstall={confirmUninstall}
        />
      )}
      ItemSeparatorComponent={AgentCardGap}
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={(catalogQuery.isPending && snapshot !== null) || installationsQuery.isPending}
          onRefresh={() => {
            catalogQuery.refresh();
            installationsQuery.refresh();
          }}
        />
      }
      ListHeaderComponent={
        <View className="gap-6 pb-4">
          <ControlPlaneCard summary={summary} />
          {props.environments.length > 1 ? (
            <EnvironmentPicker
              environments={props.environments}
              selectedEnvironmentId={props.environmentId}
              onSelect={props.onSelectEnvironment}
            />
          ) : null}
          <BuiltInProviders providers={providers} />
          <View className="gap-3">
            <View className="gap-1 px-2">
              <Text className="text-sm font-t3-medium text-foreground-muted">ACP registry</Text>
              <Text className="text-xs leading-5 text-foreground-tertiary">
                Registry membership confirms ACP catalog inclusion, not vendor endorsement.
              </Text>
            </View>
            <TextInput
              accessibilityLabel="Search agents"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Search agents, authors, licenses"
              returnKeyType="search"
              value={query}
              onChangeText={setQuery}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2 pr-5"
            >
              {FILTERS.map((option) => {
                const selected = filter === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setFilter(option.value)}
                    className={
                      selected
                        ? "rounded-full bg-foreground px-3 py-2"
                        : "rounded-full border border-border-subtle bg-card px-3 py-2"
                    }
                  >
                    <Text
                      className={
                        selected
                          ? "text-xs font-t3-medium text-background"
                          : "text-xs text-foreground-muted"
                      }
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {snapshot?.status === "stale" ? (
              <CatalogNotice>
                Showing the last valid snapshot.{" "}
                {catalogFailureLabel(snapshot.reason ?? "request_failed")}
              </CatalogNotice>
            ) : null}
            {snapshot?.status === "unavailable" ? (
              <CatalogNotice>{catalogFailureLabel(snapshot.reason)}</CatalogNotice>
            ) : catalogQuery.error !== null ? (
              <CatalogNotice>{catalogQuery.error}</CatalogNotice>
            ) : null}
          </View>
        </View>
      }
      ListEmptyComponent={
        catalogQuery.isPending ? (
          <Text className="py-14 text-center text-base text-foreground-muted">
            Reading the agent catalog…
          </Text>
        ) : snapshot?.status === "unavailable" || catalogQuery.error !== null ? null : (
          <View className="items-center rounded-[24px] border border-dashed border-border-subtle px-5 py-12">
            <Text className="text-base font-t3-medium text-foreground">No matching agents</Text>
            <Text className="mt-1 text-center text-sm text-foreground-muted">
              Broaden the search or select All.
            </Text>
          </View>
        )
      }
      ListFooterComponent={
        snapshot?.status === "ready" || snapshot?.status === "stale" ? (
          <Text className="px-2 pb-2 pt-4 text-xs uppercase tracking-wider text-foreground-tertiary">
            Registry {snapshot.registryVersion} · {snapshot.platformTriple} · secure binary installs
            only
          </Text>
        ) : null
      }
    />
  );
}

function ControlPlaneCard(props: { readonly summary: ReturnType<typeof agentHubSummary> }) {
  const icon = useThemeColor("--color-icon");
  return (
    <View className="overflow-hidden rounded-[28px] border-continuous bg-card">
      <View className="gap-3 border-b border-border-subtle p-5">
        <View className="flex-row items-center gap-2">
          <SymbolView
            name={{ ios: "sparkles", android: "auto_awesome" }}
            size={16}
            tintColor={icon}
            weight="semibold"
          />
          <Text className="text-xs font-t3-medium uppercase tracking-widest text-foreground-muted">
            Sleepers control plane
          </Text>
        </View>
        <Text className="text-3xl font-t3-bold leading-9 text-foreground">
          Every coding agent in reach.
        </Text>
        <Text className="text-sm leading-5 text-foreground-muted">
          Discovery and verified binary installation are live. Every install is revalidated,
          checksum-checked, staged, and activated as an explicit provider instance.
        </Text>
      </View>
      <View className="flex-row flex-wrap">
        <Metric label="Integrated" value={props.summary.integrated} />
        <Metric label="Routable" value={props.summary.routable} />
        <Metric label="ACP catalog" value={props.summary.catalog} />
        <Metric label="Verifiable" value={props.summary.checksumVerifiable} />
      </View>
    </View>
  );
}

function Metric(props: { readonly label: string; readonly value: number }) {
  return (
    <View className="basis-1/2 border-b border-r border-border-subtle p-4">
      <Text className="text-2xl font-t3-bold tabular-nums text-foreground">{props.value}</Text>
      <Text className="text-xs text-foreground-muted">{props.label}</Text>
    </View>
  );
}

function EnvironmentPicker(props: {
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
  readonly selectedEnvironmentId: EnvironmentId;
  readonly onSelect: (environmentId: EnvironmentId) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="px-2 text-sm font-t3-medium text-foreground-muted">Environment</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 pr-5"
      >
        {props.environments.map((environment) => {
          const selected = environment.environmentId === props.selectedEnvironmentId;
          return (
            <Pressable
              key={environment.environmentId}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => props.onSelect(environment.environmentId)}
              className={
                selected
                  ? "rounded-full bg-foreground px-3 py-2"
                  : "rounded-full border border-border-subtle bg-card px-3 py-2"
              }
            >
              <Text
                className={
                  selected
                    ? "text-xs font-t3-medium text-background"
                    : "text-xs text-foreground-muted"
                }
              >
                {environment.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function BuiltInProviders(props: { readonly providers: ReadonlyArray<ServerProvider> }) {
  return (
    <View className="gap-2">
      <View className="gap-1 px-2">
        <Text className="text-sm font-t3-medium text-foreground-muted">Provider instances</Text>
        <Text className="text-xs leading-5 text-foreground-tertiary">
          Installed, integrated, and routable are intentionally separate states.
        </Text>
      </View>
      <View className="overflow-hidden rounded-[24px] border-continuous bg-card">
        {props.providers.length === 0 ? (
          <Text className="p-4 text-sm text-foreground-muted">
            Provider status has not arrived from this environment.
          </Text>
        ) : (
          props.providers.map((provider, index) => (
            <BuiltInProviderRow key={provider.instanceId} provider={provider} divided={index > 0} />
          ))
        )}
      </View>
    </View>
  );
}

function BuiltInProviderRow(props: {
  readonly provider: ServerProvider;
  readonly divided: boolean;
}) {
  const levels = deriveAgentStatusLevels(props.provider);
  const readyColor = useThemeColor("--color-switch-active");
  const mutedColor = useThemeColor("--color-icon");
  return (
    <View className={props.divided ? "gap-3 border-t border-border-subtle p-4" : "gap-3 p-4"}>
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
            {props.provider.displayName ?? props.provider.driver}
          </Text>
          <Text className="mt-0.5 text-xs text-foreground-muted" numberOfLines={1}>
            {props.provider.version ?? "Version unavailable"} · {props.provider.instanceId}
          </Text>
        </View>
        <Text
          className={
            levels.routable
              ? "text-xs font-t3-medium text-foreground"
              : "text-xs font-t3-medium text-foreground-muted"
          }
        >
          {providerReadinessLabel(props.provider)}
        </Text>
      </View>
      <View className="flex-row gap-4">
        <ReadinessState
          label="Installed"
          ready={props.provider.installed}
          readyColor={readyColor}
          mutedColor={mutedColor}
        />
        <ReadinessState
          label="Integrated"
          ready={levels.integrated}
          readyColor={readyColor}
          mutedColor={mutedColor}
        />
        <ReadinessState
          label="Routable"
          ready={levels.routable}
          readyColor={readyColor}
          mutedColor={mutedColor}
        />
      </View>
    </View>
  );
}

function ReadinessState(props: {
  readonly label: string;
  readonly ready: boolean;
  readonly readyColor: ColorValue;
  readonly mutedColor: ColorValue;
}) {
  return (
    <View className="flex-row items-center gap-1.5">
      <SymbolView
        name={props.ready ? "checkmark.circle" : "exclamationmark.triangle"}
        size={13}
        tintColor={props.ready ? props.readyColor : props.mutedColor}
        weight="medium"
      />
      <Text className="text-xs text-foreground-muted">{props.label}</Text>
    </View>
  );
}

function RegistryAgentCard(props: {
  readonly entry: AgentCatalogEntry;
  readonly installation: AgentInstallation | undefined;
  readonly installState: AgentInstallCommandState;
  readonly onInstall: () => void;
  readonly onUninstall: (installation: AgentInstallation) => void;
}) {
  const { entry } = props;
  const installation = props.installation;
  const verifiable = entry.installSafety.checksumVerifiable;
  const installable = entry.selectedDistribution.kind === "binary" && verifiable;
  const installing =
    props.installState.status === "running" && props.installState.agentId === entry.agent.id;
  return (
    <View className="gap-3 rounded-[24px] border-continuous bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-t3-medium text-foreground" numberOfLines={1}>
            {entry.agent.name}
          </Text>
          <Text className="mt-0.5 text-xs text-foreground-muted">
            v{entry.agent.version} · {entry.agent.license ?? "License not listed"}
          </Text>
        </View>
        <View
          className={
            verifiable
              ? "rounded-full bg-subtle-strong px-2.5 py-1.5"
              : "rounded-full bg-subtle px-2.5 py-1.5"
          }
        >
          <Text
            className={
              verifiable
                ? "text-xs font-t3-medium text-foreground"
                : "text-xs font-t3-medium text-foreground-muted"
            }
          >
            {catalogDistributionLabel(entry)}
          </Text>
        </View>
      </View>
      <Text className="text-sm leading-5 text-foreground-muted" numberOfLines={3}>
        {entry.agent.description ?? "ACP-compatible coding agent."}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <View className="rounded-full bg-subtle px-2.5 py-1.5">
          <Text className="text-xs text-foreground-muted">Registry · unverified</Text>
        </View>
        {entry.prerequisites.map((prerequisite) => (
          <View key={prerequisite} className="rounded-full bg-subtle px-2.5 py-1.5">
            <Text className="text-xs text-foreground-muted">Needs {prerequisite}</Text>
          </View>
        ))}
      </View>
      {installation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: props.installState.status === "running" }}
          disabled={props.installState.status === "running"}
          onPress={() => props.onUninstall(installation)}
          className="items-center rounded-2xl border border-border-subtle bg-subtle py-3"
        >
          <Text className="text-sm font-t3-medium text-foreground">
            Uninstall v{installation.version}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            disabled: !installable || props.installState.status === "running",
          }}
          disabled={!installable || props.installState.status === "running"}
          onPress={props.onInstall}
          className={
            installable
              ? "items-center rounded-2xl bg-foreground py-3"
              : "items-center rounded-2xl border border-border-subtle bg-subtle py-3 opacity-60"
          }
        >
          <Text
            className={
              installable
                ? "text-sm font-t3-medium text-background"
                : "text-sm font-t3-medium text-foreground-muted"
            }
          >
            {installing
              ? agentInstallProgressLabel(props.installState.event)
              : installable
                ? "Review secure install"
                : "No secure binary"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function CatalogNotice({ children }: { readonly children: ReactNode }) {
  return (
    <View className="rounded-2xl border border-danger-border bg-danger p-3">
      <Text className="text-sm leading-5 text-danger-foreground">{children}</Text>
    </View>
  );
}

function AgentCardGap() {
  return <View className="h-3" />;
}

function AgentHubEmpty() {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center px-8"
      style={{ paddingBottom: Math.max(insets.bottom, 18) }}
    >
      <Text className="text-center text-2xl font-t3-bold text-foreground">
        Connect an environment
      </Text>
      <Text className="mt-2 text-center text-base leading-6 text-foreground-muted">
        Agent Hub reads provider and catalog state from a connected Sleepers Code environment.
      </Text>
    </View>
  );
}
