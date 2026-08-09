import { CursorSettings, type ServerProvider, TextGenerationError } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PubSub from "effect/PubSub";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config.ts";
import type * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { makeGenericAcpRuntime } from "../acp/GenericAcpSupport.ts";
import {
  INSTALLED_ACP_DRIVER_KIND,
  InstalledAcpProviderConfig,
} from "../acp/InstalledAcpProviderConfig.ts";
import { makeCursorAdapter } from "../Layers/CursorAdapter.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";

const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const decodeConfig = Schema.decodeSync(InstalledAcpProviderConfig);

export type AcpRegistryDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig;

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
      const eventLoggers = yield* ProviderEventLoggers;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: INSTALLED_ACP_DRIVER_KIND,
        instanceId,
      });
      const resolvedDisplayName = displayName ?? config.agentId;
      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: INSTALLED_ACP_DRIVER_KIND,
        packageName: null,
      });

      const buildSnapshot = Effect.gen(function* () {
        const commandAvailable = yield* fs.exists(config.commandPath).pipe(
          Effect.flatMap((exists) =>
            exists
              ? fs.stat(config.commandPath).pipe(Effect.map((info) => info.type === "File"))
              : Effect.succeed(false),
          ),
          Effect.orElseSucceed(() => false),
        );
        const checkedAt = DateTime.formatIso(yield* DateTime.now);
        return {
          instanceId,
          driver: INSTALLED_ACP_DRIVER_KIND,
          displayName: resolvedDisplayName,
          ...(accentColor ? { accentColor } : {}),
          continuation: { groupKey: continuationIdentity.continuationKey },
          enabled,
          installed: commandAvailable,
          version: config.version,
          status: !enabled ? "disabled" : commandAvailable ? "ready" : "error",
          auth: { status: "unknown" },
          checkedAt,
          availability: "available",
          message: commandAvailable
            ? "Installed from the ACP registry. Authentication is not yet verified; select this agent explicitly for its first run."
            : "The installed ACP agent executable is missing.",
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

      const changes = yield* Effect.acquireRelease(
        PubSub.unbounded<ServerProvider>(),
        PubSub.shutdown,
      );
      const snapshotRef = yield* Ref.make(yield* buildSnapshot);
      const refresh = buildSnapshot.pipe(
        Effect.tap((snapshot) => Ref.set(snapshotRef, snapshot)),
        Effect.tap((snapshot) => PubSub.publish(changes, snapshot)),
      );

      const adapter = yield* makeCursorAdapter(decodeCursorSettings({ enabled: true }), {
        provider: INSTALLED_ACP_DRIVER_KIND,
        providerDisplayName: resolvedDisplayName,
        enableModelSelection: false,
        instanceId,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        makeAcpRuntime: (input) => makeGenericAcpRuntime(config, input),
        environment: mergeProviderInstanceEnvironment(environment),
      });

      return {
        instanceId,
        driverKind: INSTALLED_ACP_DRIVER_KIND,
        continuationIdentity,
        displayName: resolvedDisplayName,
        accentColor,
        enabled,
        snapshot: {
          maintenanceCapabilities,
          getSnapshot: Ref.get(snapshotRef),
          refresh,
          streamChanges: Stream.fromPubSub(changes),
        },
        adapter,
        textGeneration: unsupportedTextGeneration(resolvedDisplayName),
      } satisfies ProviderInstance;
    }),
};
