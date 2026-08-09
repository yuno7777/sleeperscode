/**
 * LocalModelDiscovery — lists models a local runtime currently has.
 *
 * A local runtime that is not running is the ordinary case, not a failure: most
 * users will never have Ollama or LM Studio installed. So this never fails the
 * effect. It reports `unreachable` with a short reason, which the caller renders
 * as "not detected" rather than as an error.
 *
 * Probes are given a short deadline because they are aimed at loopback. A user
 * opening a model picker should not wait on a machine that is not listening.
 *
 * @module localModel/LocalModelDiscovery
 */
import {
  LOCAL_MODEL_DEFAULT_BASE_URL,
  localModelListUrl,
  parseLocalModels,
  type LocalModel,
  type LocalModelRuntime,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

/** Loopback should answer quickly or not at all. */
export const LOCAL_MODEL_PROBE_TIMEOUT = Duration.seconds(2);

export interface LocalModelProbeInput {
  readonly runtime: LocalModelRuntime;
  /** Defaults to the runtime's documented base URL where one exists. */
  readonly baseUrl?: string;
}

export type LocalModelProbeResult =
  | {
      readonly status: "ready";
      readonly runtime: LocalModelRuntime;
      readonly baseUrl: string;
      readonly models: ReadonlyArray<LocalModel>;
    }
  | {
      readonly status: "unreachable";
      readonly runtime: LocalModelRuntime;
      readonly baseUrl: string;
      /** Short, loggable reason. Never carries response bodies. */
      readonly reason:
        | "no_base_url"
        | "invalid_base_url"
        | "request_failed"
        | "bad_status"
        | "unreadable_payload";
    };

export class LocalModelDiscovery extends Context.Service<
  LocalModelDiscovery,
  {
    readonly probe: (input: LocalModelProbeInput) => Effect.Effect<LocalModelProbeResult>;
  }
>()("t3/localModel/LocalModelDiscovery") {}

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  const probe: LocalModelDiscovery["Service"]["probe"] = (input) =>
    Effect.gen(function* () {
      const configuredBaseUrl = input.baseUrl ?? LOCAL_MODEL_DEFAULT_BASE_URL[input.runtime];
      if (configuredBaseUrl === undefined || configuredBaseUrl.trim().length === 0) {
        return {
          status: "unreachable",
          runtime: input.runtime,
          baseUrl: "",
          reason: "no_base_url",
        } as const;
      }

      const baseUrl = configuredBaseUrl.trim();
      let protocol: string;
      try {
        protocol = new URL(baseUrl).protocol;
      } catch {
        return {
          status: "unreachable",
          runtime: input.runtime,
          baseUrl,
          reason: "invalid_base_url",
        } as const;
      }
      if (protocol !== "http:" && protocol !== "https:") {
        return {
          status: "unreachable",
          runtime: input.runtime,
          baseUrl,
          reason: "invalid_base_url",
        } as const;
      }

      const url = localModelListUrl(input.runtime, baseUrl);
      const unreachable = (reason: "request_failed" | "bad_status" | "unreadable_payload") =>
        ({ status: "unreachable", runtime: input.runtime, baseUrl, reason }) as const;

      const response = yield* httpClient
        .execute(HttpClientRequest.get(url))
        .pipe(Effect.timeout(LOCAL_MODEL_PROBE_TIMEOUT), Effect.option);
      if (response._tag === "None") return unreachable("request_failed");
      if (response.value.status < 200 || response.value.status >= 300) {
        return unreachable("bad_status");
      }

      const payload = yield* Effect.option(response.value.json);
      if (payload._tag === "None") return unreachable("unreadable_payload");

      return {
        status: "ready",
        runtime: input.runtime,
        baseUrl,
        models: parseLocalModels(payload.value, input.runtime),
      } as const;
    });

  return LocalModelDiscovery.of({ probe });
});

export const layer = Layer.effect(LocalModelDiscovery, make);
