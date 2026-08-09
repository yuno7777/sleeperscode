import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { describe, expect } from "vite-plus/test";

import * as LocalModelDiscovery from "./LocalModelDiscovery.ts";

/** Records the URL each probe requested and replies with a canned response. */
const stubHttp = (reply: (url: string) => Response | "fail", requested: Array<string> = []) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      requested.push(url.toString());
      const response = reply(url.toString());
      // A refused connection reaches the client as a typed transport failure,
      // which is what the probe is expected to absorb. Dying here instead would
      // test a defect path the real client never produces.
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const ollamaPayload = {
  models: [
    {
      name: "llama3.2:latest",
      model: "llama3.2:latest",
      size: 2019393189,
      details: { family: "llama", parameter_size: "3.2B", quantization_level: "Q4_K_M" },
    },
  ],
};

const run = <A>(
  effect: Effect.Effect<A, never, LocalModelDiscovery.LocalModelDiscovery>,
  http: Layer.Layer<HttpClient.HttpClient>,
) => effect.pipe(Effect.provide(LocalModelDiscovery.layer.pipe(Layer.provide(http))));

describe("LocalModelDiscovery", () => {
  it.effect("lists Ollama models from its documented endpoint", () => {
    const requested: Array<string> = [];
    return run(
      Effect.gen(function* () {
        const discovery = yield* LocalModelDiscovery.LocalModelDiscovery;
        const result = yield* discovery.probe({ runtime: "ollama" });

        expect(requested).toEqual(["http://localhost:11434/api/tags"]);
        expect(result.status).toBe("ready");
        expect(result.status === "ready" && result.models).toEqual([
          {
            id: "llama3.2:latest",
            runtime: "ollama",
            parameterSize: "3.2B",
            quantization: "Q4_K_M",
            family: "llama",
            sizeBytes: 2019393189,
          },
        ]);
      }),
      stubHttp(() => json(ollamaPayload), requested),
    );
  });

  it.effect("lists LM Studio models from the OpenAI-shaped endpoint", () => {
    const requested: Array<string> = [];
    return run(
      Effect.gen(function* () {
        const discovery = yield* LocalModelDiscovery.LocalModelDiscovery;
        const result = yield* discovery.probe({ runtime: "lmstudio" });

        expect(requested).toEqual(["http://localhost:1234/v1/models"]);
        expect(result.status === "ready" && result.models).toEqual([
          { id: "qwen2.5-coder-7b", runtime: "lmstudio" },
        ]);
      }),
      stubHttp(() => json({ object: "list", data: [{ id: "qwen2.5-coder-7b" }] }), requested),
    );
  });

  it.effect("honours a custom base URL", () => {
    const requested: Array<string> = [];
    return run(
      Effect.gen(function* () {
        const discovery = yield* LocalModelDiscovery.LocalModelDiscovery;
        yield* discovery.probe({
          runtime: "openai-compatible",
          baseUrl: "http://192.168.1.10:8000/v1/",
        });
        expect(requested).toEqual(["http://192.168.1.10:8000/v1/models"]);
      }),
      stubHttp(() => json({ data: [] }), requested),
    );
  });

  it.effect("reports a runtime that is not running as unreachable, not as a failure", () =>
    run(
      Effect.gen(function* () {
        const discovery = yield* LocalModelDiscovery.LocalModelDiscovery;
        const result = yield* discovery.probe({ runtime: "ollama" });
        expect(result).toEqual({
          status: "unreachable",
          runtime: "ollama",
          baseUrl: "http://localhost:11434",
          reason: "request_failed",
        });
      }),
      stubHttp(() => "fail"),
    ),
  );

  it.effect("treats a non-2xx reply as unreachable", () =>
    run(
      Effect.gen(function* () {
        const discovery = yield* LocalModelDiscovery.LocalModelDiscovery;
        const result = yield* discovery.probe({ runtime: "ollama" });
        expect(result.status === "unreachable" && result.reason).toBe("bad_status");
      }),
      stubHttp(() => json({ error: "nope" }, 500)),
    ),
  );

  it.effect("treats a non-JSON body as unreachable", () =>
    run(
      Effect.gen(function* () {
        const discovery = yield* LocalModelDiscovery.LocalModelDiscovery;
        const result = yield* discovery.probe({ runtime: "ollama" });
        expect(result.status === "unreachable" && result.reason).toBe("unreadable_payload");
      }),
      stubHttp(() => new Response("<html>not json</html>", { status: 200 })),
    ),
  );

  it.effect("refuses to guess a base URL for a generic OpenAI-compatible server", () => {
    const requested: Array<string> = [];
    return run(
      Effect.gen(function* () {
        const discovery = yield* LocalModelDiscovery.LocalModelDiscovery;
        const result = yield* discovery.probe({ runtime: "openai-compatible" });
        expect(result).toEqual({
          status: "unreachable",
          runtime: "openai-compatible",
          baseUrl: "",
          reason: "no_base_url",
        });
        expect(requested).toEqual([]);
      }),
      stubHttp(() => json({ data: [] }), requested),
    );
  });

  it.effect("reports a malformed base URL without failing the effect", () => {
    const requested: Array<string> = [];
    return run(
      Effect.gen(function* () {
        const discovery = yield* LocalModelDiscovery.LocalModelDiscovery;
        const result = yield* discovery.probe({
          runtime: "openai-compatible",
          baseUrl: "not a URL",
        });
        expect(result).toEqual({
          status: "unreachable",
          runtime: "openai-compatible",
          baseUrl: "not a URL",
          reason: "invalid_base_url",
        });
        expect(requested).toEqual([]);
      }),
      stubHttp(() => json({ data: [] }), requested),
    );
  });

  it.effect("rejects non-HTTP local model URLs before creating a request", () => {
    const requested: Array<string> = [];
    return run(
      Effect.gen(function* () {
        const discovery = yield* LocalModelDiscovery.LocalModelDiscovery;
        const result = yield* discovery.probe({
          runtime: "openai-compatible",
          baseUrl: "file:///tmp/models",
        });
        expect(result.status === "unreachable" && result.reason).toBe("invalid_base_url");
        expect(requested).toEqual([]);
      }),
      stubHttp(() => json({ data: [] }), requested),
    );
  });

  it.effect("reports a reachable runtime holding no models", () =>
    run(
      Effect.gen(function* () {
        const discovery = yield* LocalModelDiscovery.LocalModelDiscovery;
        const result = yield* discovery.probe({ runtime: "ollama" });
        expect(result.status).toBe("ready");
        expect(result.status === "ready" && result.models).toEqual([]);
      }),
      stubHttp(() => json({ models: [] })),
    ),
  );
});
