import { CursorSettings, type ServerProvider, TextGenerationError } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import type * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { makeGenericAcpRuntime } from "../acp/GenericAcpSupport.ts";
import {
  INSTALLED_ACP_DRIVER_KIND,
  InstalledAcpProviderConfig,
} from "../acp/InstalledAcpProviderConfig.ts";
import { makeCursorAdapter } from "../Layers/CursorAdapter.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { ProviderDriverError } from "../Errors.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";

const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const decodeConfig = Schema.decodeSync(InstalledAcpProviderConfig);
const GENERIC_ACP_HEALTH_PROBE_TIMEOUT = Duration.seconds(15);

export type AcpRegistryDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

const unsupportedTextGeneration = (
  displayName: string,
): TextGeneration.TextGeneration["Service"] => ({
  generateCommitMessage: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateCommitMessage",
        detail: `${displayName} does not advertise structured text generation.`,
      }),
    ),
  generatePrContent: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generatePrContent",
        detail: `${displayName} does not advertise structured text generation.`,
      }),
    ),
  generateBranchName: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateBranchName",
        detail: `${displayName} does not advertise structured text generation.`,
      }),
    ),
  generateThreadTitle: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateThreadTitle",
        detail: `${displayName} does not advertise structured text generation.`,
      }),
    ),
});

export const AcpRegistryDriver: ProviderDriver<InstalledAcpProviderConfig, AcpRegistryDriverEnv> = {
  driverKind: INSTALLED_ACP_DRIVER_KIND,
  metadata: {
    displayName: "Installed ACP agent",
    supportsMultipleInstances: true,
  },
  configSchema: InstalledAcpProviderConfig,
  defaultConfig: () =>
    decodeConfig({
      agentId: "unconfigured-agent",
      version: "unknown",
      commandPath: "unconfigured-acp-agent",
      args: [],
      environment: {},
    }),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const crypto = yield* Crypto.Crypto;
      const eventLoggers = yield* ProviderEventLoggers;
      const { cwd } = yield* ServerConfig;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: INSTALLED_ACP_DRIVER_KIND,
        instanceId,
      });
      const resolvedDisplayName = displayName ?? config.agentId;
      const processEnvironment = mergeProviderInstanceEnvironment(environment);
      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: INSTALLED_ACP_DRIVER_KIND,
        packageName: null,
      });

      const makeSnapshot = (input: {
        readonly installed: boolean;
        readonly status: ServerProvider["status"];
        readonly message?: string;
      }) =>
        Effect.gen(function* () {
          const checkedAt = DateTime.formatIso(yield* DateTime.now);
          return {
            instanceId,
            driver: INSTALLED_ACP_DRIVER_KIND,
            displayName: resolvedDisplayName,
            ...(accentColor ? { accentColor } : {}),
            continuation: { groupKey: continuationIdentity.continuationKey },
            enabled,
            installed: input.installed,
            version: config.version,
            status: input.status,
            auth: { status: "unknown" },
            checkedAt,
            availability: "available",
            ...(input.message ? { message: input.message } : {}),
            models: [
              {
                slug: "default",
                name: "Agent default",
                isCustom: false,
                isDefault: true,
                capabilities: null,
              },
            ],
            slashCommands: [],
            skills: [],
          } satisfies ServerProvider;
        });

      const commandAvailable = fs.exists(config.commandPath).pipe(
        Effect.flatMap((exists) =>
          exists
            ? fs.stat(config.commandPath).pipe(Effect.map((info) => info.type === "File"))
            : Effect.succeed(false),
        ),
        Effect.orElseSucceed(() => false),
      );

      const buildInitialSnapshot = Effect.gen(function* () {
        const installed = yield* commandAvailable;
        return yield* makeSnapshot({
          installed,
          status: !enabled ? "disabled" : installed ? "warning" : "error",
          message: !enabled
            ? "This installed ACP provider is disabled."
            : installed
              ? "Waiting for the ACP protocol health check."
              : "The installed ACP agent executable is missing.",
        });
      });

      const checkProvider = Effect.gen(function* () {
        const installed = yield* commandAvailable;
        if (!enabled) {
          return yield* makeSnapshot({
            installed,
            status: "disabled",
            message: "This installed ACP provider is disabled.",
          });
        }
        if (!installed) {
          return yield* makeSnapshot({
            installed: false,
            status: "error",
            message: "The installed ACP agent executable is missing.",
          });
        }

        const probe = yield* makeGenericAcpRuntime(config, {
          childProcessSpawner,
          cwd,
          clientInfo: { name: "sleepers-code-provider-probe", version: "0.0.0" },
          environment: processEnvironment,
        }).pipe(
          Effect.flatMap((runtime) => runtime.initialize()),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.timeoutOption(GENERIC_ACP_HEALTH_PROBE_TIMEOUT),
          Effect.exit,
          Effect.scoped,
        );

        if (Exit.isFailure(probe)) {
          yield* Effect.logWarning("Installed ACP agent failed its protocol health check.", {
            agentId: config.agentId,
          });
          return yield* makeSnapshot({
            installed: true,
            status: "error",
            message: "The agent executable started but the ACP initialize handshake failed.",
          });
        }
        if (Option.isNone(probe.value)) {
          return yield* makeSnapshot({
            installed: true,
            status: "error",
            message: "The ACP initialize handshake timed out after 15 seconds.",
          });
        }

        const advertisedAuthMethodCount = probe.value.value.authMethods?.length ?? 0;
        return yield* makeSnapshot({
          installed: true,
          status: "ready",
          message:
            advertisedAuthMethodCount > 0
              ? `ACP health check passed. The agent advertises ${advertisedAuthMethodCount} authentication method${advertisedAuthMethodCount === 1 ? "" : "s"}, but current authentication is not yet verified.`
              : "ACP health check passed. Current authentication is not yet verified.",
        });
      });

      const snapshot = yield* makeManagedServerProvider({
        maintenanceCapabilities,
        getSettings: Effect.succeed(config),
        streamSettings: Stream.empty,
        haveSettingsChanged: () => false,
        initialSnapshot: () => buildInitialSnapshot,
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: INSTALLED_ACP_DRIVER_KIND,
              instanceId,
              detail: `Failed to build the installed ACP provider snapshot: ${cause.message}`,
              cause,
            }),
        ),
      );

      const adapter = yield* makeCursorAdapter(decodeCursorSettings({ enabled: true }), {
        provider: INSTALLED_ACP_DRIVER_KIND,
        providerDisplayName: resolvedDisplayName,
        enableModelSelection: false,
        instanceId,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        makeAcpRuntime: (input) => makeGenericAcpRuntime(config, input),
        environment: processEnvironment,
      });

      return {
        instanceId,
        driverKind: INSTALLED_ACP_DRIVER_KIND,
        continuationIdentity,
        displayName: resolvedDisplayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration: unsupportedTextGeneration(resolvedDisplayName),
      } satisfies ProviderInstance;
    }),
};
