import { ACP_REGISTRY_URL } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { describe, expect } from "vite-plus/test";

import * as AgentCatalog from "./AgentCatalog.ts";

const fixture = {
  version: "1.0.0",
  agents: [
    {
      id: "safe-agent",
      name: "Safe Agent",
      version: "2.3.4",
      description: "Checksummed on Windows",
      repository: "https://github.com/example/safe-agent",
      distribution: {
        npx: { package: "safe-agent@2.3.4" },
        binary: {
          "windows-x86_64": {
            archive: "https://downloads.example.com/safe-agent.zip",
            cmd: "safe-agent.exe",
            sha256: "a".repeat(64),
          },
        },
      },
    },
    {
      id: "package-agent",
      name: "Package Agent",
      version: "1.0.0",
      distribution: { npx: { package: "package-agent@1.0.0" } },
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const stubHttp = (reply: (requestNumber: number) => Response | "fail", requests: string[]) => {
  let requestNumber = 0;
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      requests.push(url.toString());
      requestNumber += 1;
      const response = reply(requestNumber);
      return response === "fail"
        ? Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request,
                description: "connection refused",
              }),
            }),
          )
        : Effect.succeed(HttpClientResponse.fromWeb(request, response));
    }),
  );
};

const run = <A>(
  effect: Effect.Effect<A, never, AgentCatalog.AgentCatalog>,
  http: Layer.Layer<HttpClient.HttpClient>,
  commandAvailable: (command: string) => Effect.Effect<boolean> = () => Effect.succeed(true),
) =>
  effect.pipe(
    Effect.provide(
      Layer.effect(
        AgentCatalog.AgentCatalog,
        AgentCatalog.makeWithPlatform("win32", "x64", commandAvailable),
      ).pipe(Layer.provide(http)),
    ),
  );

describe("AgentCatalog", () => {
  it.effect("prepares platform-specific choices without granting registry trust", () => {
    const requests: string[] = [];
    const commands: string[] = [];
    return run(
      Effect.gen(function* () {
        const catalog = yield* AgentCatalog.AgentCatalog;
        const snapshot = yield* catalog.get();

        expect(requests).toEqual([ACP_REGISTRY_URL]);
        expect(snapshot.status).toBe("ready");
        if (snapshot.status === "unavailable") return;
        expect(snapshot.platformTriple).toBe("windows-x86_64");
        expect(snapshot.agents.map((entry) => entry.agent.id)).toEqual([
          "package-agent",
          "safe-agent",
        ]);
        expect(snapshot.agents[0]).toMatchObject({
          selectedDistribution: { kind: "npx" },
          installSafety: {
            checksumVerifiable: false,
            risks: ["package_manager_install"],
          },
          prerequisites: ["node"],
          prerequisiteStatus: [
            {
              prerequisite: "node",
              availability: "available",
              commands: ["node", "npx"],
            },
          ],
          trust: "registry-unverified",
        });
        expect(snapshot.agents[1]).toMatchObject({
          selectedDistribution: { kind: "binary", triple: "windows-x86_64" },
          installSafety: { checksumVerifiable: true, risks: [] },
          prerequisites: [],
          prerequisiteStatus: [],
          trust: "registry-unverified",
        });
        expect(commands).toEqual(["node", "npx"]);
      }),
      stubHttp(() => json(fixture), requests),
      (command) => {
        commands.push(command);
        return Effect.succeed(true);
      },
    );
  });

  it.effect("shares a fresh catalog across callers", () => {
    const requests: string[] = [];
    const commands: string[] = [];
    return run(
      Effect.gen(function* () {
        const catalog = yield* AgentCatalog.AgentCatalog;
        const first = yield* catalog.get();
        const second = yield* catalog.get();
        expect(first).toEqual(second);
        expect(requests).toEqual([ACP_REGISTRY_URL]);
        expect(commands).toEqual(["node", "npx"]);
      }),
      stubHttp(() => json(fixture), requests),
      (command) => {
        commands.push(command);
        return Effect.succeed(true);
      },
    );
  });

  it.effect("reports missing and unknown prerequisite evidence without hiding the catalog", () => {
    const missingRequests: string[] = [];
    const unknownRequests: string[] = [];
    return Effect.all([
      run(
        Effect.gen(function* () {
          const catalog = yield* AgentCatalog.AgentCatalog;
          const snapshot = yield* catalog.get();
          expect(snapshot.agents[0]?.prerequisiteStatus).toEqual([
            {
              prerequisite: "node",
              availability: "missing",
              commands: ["node", "npx"],
            },
          ]);
        }),
        stubHttp(() => json(fixture), missingRequests),
        (command) => Effect.succeed(command === "node"),
      ),
      run(
        Effect.gen(function* () {
          const catalog = yield* AgentCatalog.AgentCatalog;
          const snapshot = yield* catalog.get();
          expect(snapshot.agents[0]?.prerequisiteStatus).toEqual([
            {
              prerequisite: "node",
              availability: "unknown",
              commands: ["node", "npx"],
            },
          ]);
        }),
        stubHttp(() => json(fixture), unknownRequests),
        () => Effect.die("probe failed"),
      ),
    ]).pipe(Effect.asVoid);
  });

  it.effect("serves the last valid catalog when an explicit refresh fails", () => {
    const requests: string[] = [];
    return run(
      Effect.gen(function* () {
        const catalog = yield* AgentCatalog.AgentCatalog;
        const first = yield* catalog.get();
        const stale = yield* catalog.get({ refresh: true });

        expect(first.status).toBe("ready");
        expect(stale.status).toBe("stale");
        expect(stale.status !== "unavailable" && stale.reason).toBe("request_failed");
        expect(stale.agents).toEqual(first.agents);
        expect(requests).toEqual([ACP_REGISTRY_URL, ACP_REGISTRY_URL]);
      }),
      stubHttp((requestNumber) => (requestNumber === 1 ? json(fixture) : "fail"), requests),
    );
  });

  it.effect("reports bad status and invalid payload without leaking response content", () => {
    const badStatusRequests: string[] = [];
    const invalidPayloadRequests: string[] = [];
    return Effect.all([
      run(
        Effect.gen(function* () {
          const catalog = yield* AgentCatalog.AgentCatalog;
          expect(yield* catalog.get()).toMatchObject({
            status: "unavailable",
            reason: "bad_status",
            agents: [],
          });
        }),
        stubHttp(() => json({ private: "do not expose" }, 503), badStatusRequests),
      ),
      run(
        Effect.gen(function* () {
          const catalog = yield* AgentCatalog.AgentCatalog;
          expect(yield* catalog.get()).toMatchObject({
            status: "unavailable",
            reason: "invalid_payload",
            agents: [],
          });
        }),
        stubHttp(() => json({ agents: "not-an-array" }), invalidPayloadRequests),
      ),
    ]).pipe(Effect.asVoid);
  });
});
