import {
  ACP_REGISTRY_URL,
  AcpRegistry,
  acpPlatformTriple,
  acpPrerequisiteCommandsFor,
  acpPrerequisitesFor,
  deriveAcpInstallSafety,
  selectAcpDistribution,
  type AcpPrerequisite,
  type AcpPrerequisiteStatus,
  type AgentCatalogEntry,
  type AgentCatalogSnapshot,
  type AgentCatalogUnavailableReason,
} from "@t3tools/contracts";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

const CATALOG_TTL = Duration.minutes(15);
const CATALOG_REQUEST_TIMEOUT = Duration.seconds(10);

interface CachedCatalog {
  readonly fetchedAtMillis: number;
  readonly fetchedAt: string;
  readonly registryVersion: string;
  readonly agents: ReadonlyArray<AgentCatalogEntry>;
}

export class AgentCatalog extends Context.Service<
  AgentCatalog,
  {
    readonly get: (input?: {
      readonly refresh?: boolean | undefined;
    }) => Effect.Effect<AgentCatalogSnapshot>;
  }
>()("t3/agentCatalog/AgentCatalog") {}

const prepareEntries = (
  registry: AcpRegistry,
  platformTriple: string | undefined,
): ReadonlyArray<AgentCatalogEntry> =>
  registry.agents
    .map((agent) => {
      const selectedDistribution = selectAcpDistribution(agent, platformTriple);
      return {
        agent,
        selectedDistribution,
        installSafety: deriveAcpInstallSafety(selectedDistribution),
        prerequisites: acpPrerequisitesFor(selectedDistribution),
        trust: "registry-unverified" as const,
      };
    })
    .toSorted((left, right) => left.agent.name.localeCompare(right.agent.name));

const probePrerequisites = <R>(
  prerequisites: ReadonlyArray<AcpPrerequisite>,
  commandAvailable: (command: string) => Effect.Effect<boolean, never, R>,
): Effect.Effect<ReadonlyArray<AcpPrerequisiteStatus>, never, R> =>
  Effect.forEach(prerequisites, (prerequisite) => {
    const commands = acpPrerequisiteCommandsFor(prerequisite);
    return Effect.all(commands.map(commandAvailable), { concurrency: "unbounded" }).pipe(
      Effect.map(
        (available): AcpPrerequisiteStatus => ({
          prerequisite,
          availability: available.every(Boolean) ? "available" : "missing",
          commands,
        }),
      ),
      Effect.catchCause(() =>
        Effect.succeed<AcpPrerequisiteStatus>({
          prerequisite,
          availability: "unknown",
          commands,
        }),
      ),
    );
  });

export const makeWithPlatform = <R>(
  platform: string,
  architecture: string,
  commandAvailable: (command: string) => Effect.Effect<boolean, never, R>,
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const commandContext = yield* Effect.context<R>();
    const probeCommand = (command: string) =>
      commandAvailable(command).pipe(Effect.provideContext(commandContext));
    const cache = yield* Ref.make<Option.Option<CachedCatalog>>(Option.none());
    const refreshLock = yield* Semaphore.make(1);
    const platformTriple = acpPlatformTriple(platform, architecture);
    const platformFields = {
      platform,
      architecture,
      ...(platformTriple === undefined ? {} : { platformTriple }),
    };

    const fetchCatalog = Effect.gen(function* () {
      const response = yield* httpClient
        .execute(HttpClientRequest.get(ACP_REGISTRY_URL))
        .pipe(Effect.timeout(CATALOG_REQUEST_TIMEOUT), Effect.option);
      if (Option.isNone(response)) {
        return yield* Effect.fail("request_failed" as const);
      }
      if (response.value.status < 200 || response.value.status >= 300) {
        return yield* Effect.fail("bad_status" as const);
      }

      const payload = yield* response.value.json.pipe(Effect.option);
      if (Option.isNone(payload)) {
        return yield* Effect.fail("invalid_payload" as const);
      }
      const registry = yield* Schema.decodeUnknownEffect(AcpRegistry)(payload.value).pipe(
        Effect.mapError(() => "invalid_payload" as const),
      );
      const preparedEntries = prepareEntries(registry, platformTriple);
      const requiredPrerequisites = [
        ...new Set(preparedEntries.flatMap((entry) => entry.prerequisites)),
      ];
      const prerequisiteStatus = yield* probePrerequisites(requiredPrerequisites, probeCommand);
      const fetchedAt = yield* DateTime.now;
      const fetchedAtMillis = DateTime.toEpochMillis(fetchedAt);
      return {
        fetchedAtMillis,
        fetchedAt: DateTime.formatIso(fetchedAt),
        registryVersion: registry.version,
        agents: preparedEntries.map((entry) => ({
          ...entry,
          prerequisiteStatus: prerequisiteStatus.filter((status) =>
            entry.prerequisites.includes(status.prerequisite),
          ),
        })),
      } satisfies CachedCatalog;
    });

    const get: AgentCatalog["Service"]["get"] = (input) =>
      refreshLock.withPermits(1)(
        Effect.gen(function* () {
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          const cached = yield* Ref.get(cache);
          if (
            input?.refresh !== true &&
            Option.isSome(cached) &&
            now - cached.value.fetchedAtMillis < Duration.toMillis(CATALOG_TTL)
          ) {
            return {
              status: "ready",
              sourceUrl: ACP_REGISTRY_URL,
              registryVersion: cached.value.registryVersion,
              fetchedAt: cached.value.fetchedAt,
              agents: cached.value.agents,
              ...platformFields,
            };
          }

          const result = yield* Effect.result(fetchCatalog);
          if (result._tag === "Success") {
            yield* Ref.set(cache, Option.some(result.success));
            return {
              status: "ready",
              sourceUrl: ACP_REGISTRY_URL,
              registryVersion: result.success.registryVersion,
              fetchedAt: result.success.fetchedAt,
              agents: result.success.agents,
              ...platformFields,
            };
          }

          const reason: AgentCatalogUnavailableReason = result.failure;
          if (Option.isSome(cached)) {
            return {
              status: "stale",
              sourceUrl: ACP_REGISTRY_URL,
              registryVersion: cached.value.registryVersion,
              fetchedAt: cached.value.fetchedAt,
              agents: cached.value.agents,
              reason,
              ...platformFields,
            };
          }
          return {
            status: "unavailable",
            sourceUrl: ACP_REGISTRY_URL,
            agents: [],
            reason,
            ...platformFields,
          };
        }),
      );

    return AgentCatalog.of({ get });
  });

export const make = makeWithPlatform(
  globalThis.process.platform,
  globalThis.process.arch,
  isCommandAvailable,
);
export const layer = Layer.effect(AgentCatalog, make);
