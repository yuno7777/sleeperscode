// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { AcpRegistryDriver } from "./AcpRegistryDriver.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");
const BackgroundPolicyTestLayer = Layer.mock(BackgroundPolicy.BackgroundPolicy)({
  reportClientActivity: () => Effect.void,
  removeRpcClient: () => Effect.void,
  reportHostPowerState: () => Effect.void,
  snapshot: Effect.succeed({
    hostPower: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: true,
      updatedAt: TEST_EPOCH,
    },
    leases: [],
    activeForegroundLeaseCount: 0,
    activeScopeKeys: [],
    shouldRunOpportunisticWork: true,
    updatedAt: TEST_EPOCH,
  }),
  streamChanges: Stream.empty,
  hasDemand: () => Effect.succeed(true),
  shouldRunScopeWork: () => Effect.succeed(true),
  shouldRunOpportunisticWork: Effect.succeed(true),
});

function makeDriverTestLayer() {
  return Layer.mergeAll(
    NodeServices.layer,
    ServerConfig.layerTest(process.cwd(), {
      prefix: "acp-registry-driver-test-",
    }).pipe(Layer.provide(NodeServices.layer)),
    BackgroundPolicyTestLayer,
    ServerSettingsService.layerTest(),
    Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers),
  );
}

describe("AcpRegistryDriver", () => {
  it.effect("runs an installed generic ACP agent with its own provider identity", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("acp_fixture_agent");
      const instance = yield* AcpRegistryDriver.create({
        instanceId,
        displayName: "Fixture ACP Agent",
        environment: [],
        enabled: true,
        config: {
          agentId: "fixture-agent",
          version: "1.2.3",
          commandPath: process.execPath,
          args: ["--experimental-strip-types", mockAgentPath],
          environment: { FIXTURE_MODE: "acp" },
        },
      });

      yield* instance.snapshot.refresh;
      expect(yield* instance.snapshot.getSnapshot).toMatchObject({
        instanceId,
        driver: "acp",
        installed: true,
        status: "ready",
        auth: { status: "unknown" },
      });
      expect(instance.adapter.capabilities).toEqual({
        sessionModelSwitch: "unsupported",
        integrationTransport: "acp",
      });

      const threadId = ThreadId.make("installed-acp-fixture-thread");
      const session = yield* instance.adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("acp"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });
      const turn = yield* instance.adapter.sendTurn({
        threadId,
        input: "hello from Sleepers Code",
      });

      expect(session).toMatchObject({
        provider: "acp",
        providerInstanceId: instanceId,
        status: "ready",
      });
      expect(turn.threadId).toBe(threadId);
      expect(yield* instance.adapter.listSessions()).toHaveLength(1);
      yield* instance.adapter.stopAll();
    }).pipe(Effect.scoped, Effect.provide(makeDriverTestLayer())),
  );

  it.effect("reports ACP handshake failures without claiming authentication", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("acp_broken_fixture");
      const instance = yield* AcpRegistryDriver.create({
        instanceId,
        displayName: "Broken ACP Fixture",
        environment: [],
        enabled: true,
        config: {
          agentId: "broken-fixture",
          version: "1.0.0",
          commandPath: process.execPath,
          args: ["-e", "process.exit(0)"],
          environment: {},
        },
      });

      yield* instance.snapshot.refresh;
      expect(yield* instance.snapshot.getSnapshot).toMatchObject({
        instanceId,
        driver: "acp",
        installed: true,
        status: "error",
        auth: { status: "unknown" },
        message: "The agent executable started but the ACP initialize handshake failed.",
      });
    }).pipe(Effect.scoped, Effect.provide(makeDriverTestLayer())),
  );
});
