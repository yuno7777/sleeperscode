import { createHash } from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  ACP_REGISTRY_URL,
  type AgentCatalogSnapshot,
  type AgentInstallProgressEvent,
  type AgentInstallerError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { describe, expect } from "vite-plus/test";

import * as AgentCatalog from "../agentCatalog/AgentCatalog.ts";
import * as ServerConfig from "../config.ts";
import { installedAcpInstanceId } from "../provider/acp/InstalledAcpProviderConfig.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AgentInstaller from "./AgentInstaller.ts";

const executable = new Uint8Array([77, 90, 83, 76, 69, 69, 80, 69, 82, 83]);
const executableSha256 = createHash("sha256").update(executable).digest("hex");

const snapshot = (registryVersion = "2026.08.09"): AgentCatalogSnapshot => ({
  status: "ready",
  sourceUrl: ACP_REGISTRY_URL,
  registryVersion,
  fetchedAt: "2026-08-09T12:00:00.000Z",
  platform: "win32",
  architecture: "x64",
  platformTriple: "windows-x86_64",
  agents: [
    {
      agent: {
        id: "fixture-agent",
        name: "Fixture Agent",
        version: "1.2.3",
        authors: ["Fixture Publisher"],
        repository: "https://github.com/example/fixture-agent",
        distribution: {
          binary: {
            "windows-x86_64": {
              archive: "https://downloads.example.test/fixture-agent.exe",
              cmd: "fixture-agent.exe",
              sha256: executableSha256,
              args: ["acp"],
              env: { FIXTURE_MODE: "acp" },
            },
          },
        },
      },
      selectedDistribution: {
        kind: "binary",
        triple: "windows-x86_64",
        artifact: {
          archive: "https://downloads.example.test/fixture-agent.exe",
          cmd: "fixture-agent.exe",
          sha256: executableSha256,
          args: ["acp"],
          env: { FIXTURE_MODE: "acp" },
        },
      },
      installSafety: { checksumVerifiable: true, risks: [] },
      prerequisites: [],
      trust: "registry-unverified",
    },
  ],
});

const makeCatalog = (getSnapshot: (refresh: boolean) => AgentCatalogSnapshot) =>
  AgentCatalog.AgentCatalog.of({
    get: (input) => Effect.succeed(getSnapshot(input?.refresh === true)),
  });

const makeHttp = (body = executable, requests: string[] = []) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      requests.push(url.toString());
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(body, {
            status: 200,
            headers: { "content-length": String(body.byteLength) },
          }),
        ),
      );
    }),
  );

const run = <A>(input: {
  readonly effect: Effect.Effect<
    A,
    AgentInstallerError,
    AgentInstaller.AgentInstaller | ServerSettings.ServerSettingsService
  >;
  readonly catalog?: AgentCatalog.AgentCatalog["Service"];
  readonly http?: Layer.Layer<HttpClient.HttpClient>;
}) => {
  const settingsLayer = ServerSettings.layerTest();
  return input.effect.pipe(
    Effect.provide(
      AgentInstaller.layer.pipe(
        Layer.provide(
          Layer.succeed(AgentCatalog.AgentCatalog, input.catalog ?? makeCatalog(() => snapshot())),
        ),
        Layer.provide(input.http ?? makeHttp()),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "agent-installer-test-" })),
        Layer.provide(NodeServices.layer),
        Layer.provideMerge(settingsLayer),
      ),
    ),
  );
};

describe("AgentInstaller", () => {
  it.effect("builds a byte-exact plan without promoting registry trust", () =>
    run({
      effect: Effect.gen(function* () {
        const installer = yield* AgentInstaller.AgentInstaller;
        const plan = yield* installer.getPlan("fixture-agent");
        expect(plan).toMatchObject({
          agentId: "fixture-agent",
          version: "1.2.3",
          archiveFormat: "executable",
          sha256: executableSha256,
          trust: "registry-unverified",
          canInstall: true,
          requiresPublisherAcknowledgement: true,
        });
        expect(plan.planId).toMatch(/^[0-9a-f]{64}$/);
      }),
    }),
  );

  it.effect("requires explicit unverified-publisher consent before downloading", () => {
    const requests: string[] = [];
    return run({
      http: makeHttp(executable, requests),
      effect: Effect.gen(function* () {
        const installer = yield* AgentInstaller.AgentInstaller;
        const plan = yield* installer.getPlan("fixture-agent");
        const error = yield* installer
          .install({
            agentId: plan.agentId,
            planId: plan.planId,
            acknowledgeUnverifiedPublisher: false,
          })
          .pipe(Effect.flip, Effect.orDie);
        expect(error.reason).toBe("consent_required");
        expect(requests).toEqual([]);
      }),
    });
  });

  it.effect(
    "downloads, verifies, activates, lists, and uninstalls a raw Windows executable",
    () => {
      const requests: string[] = [];
      const progress: AgentInstallProgressEvent[] = [];
      return run({
        http: makeHttp(executable, requests),
        effect: Effect.gen(function* () {
          const installer = yield* AgentInstaller.AgentInstaller;
          const settings = yield* ServerSettings.ServerSettingsService;
          const plan = yield* installer.getPlan("fixture-agent");
          const installation = yield* installer.install(
            {
              agentId: plan.agentId,
              planId: plan.planId,
              acknowledgeUnverifiedPublisher: true,
            },
            (event) => Effect.sync(() => progress.push(event)),
          );

          expect(requests).toEqual([plan.archiveUrl]);
          expect(installation).toMatchObject({
            agentId: "fixture-agent",
            sha256: executableSha256,
            command: "fixture-agent.exe",
          });
          expect((yield* installer.list).installations).toEqual([installation]);
          expect(progress.map((event) => event.type === "progress" && event.stage)).toContain(
            "activating",
          );
          expect(progress.at(-1)).toEqual({ type: "complete", installation });
          const providerInstanceId = installedAcpInstanceId(plan.agentId);
          expect(
            (yield* settings.getSettings.pipe(Effect.orDie)).providerInstances[providerInstanceId],
          ).toMatchObject({
            driver: "acp",
            displayName: "Fixture Agent",
            enabled: true,
            config: {
              agentId: "fixture-agent",
              version: "1.2.3",
              args: ["acp"],
              environment: { FIXTURE_MODE: "acp" },
            },
          });

          expect(yield* installer.uninstall({ agentId: plan.agentId, confirm: true })).toEqual({
            agentId: plan.agentId,
            removed: true,
          });
          expect((yield* installer.list).installations).toEqual([]);
          expect(
            (yield* settings.getSettings.pipe(Effect.orDie)).providerInstances[providerInstanceId],
          ).toBeUndefined();
        }),
      });
    },
  );

  it.effect("leaves no active installation when checksum verification fails", () =>
    run({
      http: makeHttp(new Uint8Array([1, 2, 3, 4])),
      effect: Effect.gen(function* () {
        const installer = yield* AgentInstaller.AgentInstaller;
        const plan = yield* installer.getPlan("fixture-agent");
        const error = yield* installer
          .install({
            agentId: plan.agentId,
            planId: plan.planId,
            acknowledgeUnverifiedPublisher: true,
          })
          .pipe(Effect.flip, Effect.orDie);
        expect(error.reason).toBe("checksum_mismatch");
        expect((yield* installer.list).installations).toEqual([]);
      }),
    }),
  );

  it.effect("forces a fresh catalog read and rejects a changed plan before downloading", () => {
    const requests: string[] = [];
    return run({
      catalog: makeCatalog((refresh) => snapshot(refresh ? "2026.08.10" : "2026.08.09")),
      http: makeHttp(executable, requests),
      effect: Effect.gen(function* () {
        const installer = yield* AgentInstaller.AgentInstaller;
        const plan = yield* installer.getPlan("fixture-agent");
        const error = yield* installer
          .install({
            agentId: plan.agentId,
            planId: plan.planId,
            acknowledgeUnverifiedPublisher: true,
          })
          .pipe(Effect.flip, Effect.orDie);
        expect(error.reason).toBe("stale_plan");
        expect(requests).toEqual([]);
      }),
    });
  });
});
