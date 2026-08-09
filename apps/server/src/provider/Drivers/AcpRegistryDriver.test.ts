// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect } from "vite-plus/test";

import * as ServerConfig from "../../config.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { AcpRegistryDriver } from "./AcpRegistryDriver.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

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
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          ServerConfig.layerTest(process.cwd(), {
            prefix: "acp-registry-driver-test-",
          }).pipe(Layer.provide(NodeServices.layer)),
          Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers),
        ),
      ),
    ),
  );
});
