import { createHash } from "node:crypto";

import {
  AgentInstallation,
  AgentInstallerError,
  resolveAgentInstallArchiveFormat,
  type AgentCatalogEntry,
  type AgentInstallPlan,
  type AgentInstallProgressEvent,
  type AgentInstallRequest,
  type AgentInstallationsSnapshot,
  type AgentUninstallRequest,
  type AgentUninstallResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import * as AgentCatalog from "../agentCatalog/AgentCatalog.ts";
import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";
import {
  AgentArchiveError,
  extractAgentArchive,
  isSafeArchiveRelativePath,
} from "./archiveExtraction.ts";

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const ACTIVE_MANIFEST_VERSION = 1 as const;

const ActiveAgentManifest = Schema.Struct({
  schemaVersion: Schema.Literal(ACTIVE_MANIFEST_VERSION),
  installation: AgentInstallation,
  relativeCommand: Schema.String,
  environment: Schema.Record(Schema.String, Schema.String),
  storageKey: Schema.String,
  versionKey: Schema.String,
});
type ActiveAgentManifest = typeof ActiveAgentManifest.Type;

const ActiveAgentManifestJson = Schema.fromJsonString(ActiveAgentManifest);
const decodeActiveAgentManifest = Schema.decodeUnknownEffect(ActiveAgentManifestJson);
const encodeActiveAgentManifest = Schema.encodeEffect(ActiveAgentManifestJson);
const encodeUnknownJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const isAgentInstallerError = Schema.is(AgentInstallerError);

const fail = (reason: AgentInstallerError["reason"], detail: string) =>
  new AgentInstallerError({ reason, detail });

const hashText = (value: string): string => createHash("sha256").update(value).digest("hex");

const storageKeyFor = (agentId: string): string => {
  const readable = agentId
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return `${readable || "agent"}-${hashText(agentId).slice(0, 12)}`;
};

const versionKeyFor = (version: string, sha256: string): string => {
  const readable = version
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return `${readable || "version"}-${sha256.slice(0, 16)}`;
};

const planFingerprint = (input: {
  readonly registryVersion: string;
  readonly entry: AgentCatalogEntry;
}): string => {
  const { agent, selectedDistribution, trust } = input.entry;
  return hashText(
    encodeUnknownJsonString({
      registryVersion: input.registryVersion,
      agentId: agent.id,
      version: agent.version,
      authors: agent.authors ?? [],
      repository: agent.repository ?? null,
      trust,
      selectedDistribution,
    }),
  );
};

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export interface AgentInstallerShape {
  readonly getPlan: (agentId: string) => Effect.Effect<AgentInstallPlan, AgentInstallerError>;
  readonly list: Effect.Effect<AgentInstallationsSnapshot, AgentInstallerError>;
  readonly install: (
    input: AgentInstallRequest,
    reportProgress?: (event: AgentInstallProgressEvent) => Effect.Effect<void>,
  ) => Effect.Effect<AgentInstallation, AgentInstallerError>;
  readonly uninstall: (
    input: AgentUninstallRequest,
  ) => Effect.Effect<AgentUninstallResult, AgentInstallerError>;
}

export class AgentInstaller extends Context.Service<AgentInstaller, AgentInstallerShape>()(
  "t3/agentInstaller/AgentInstaller",
) {}

export const make = Effect.fn("agent_installer.make")(function* () {
  const catalog = yield* AgentCatalog.AgentCatalog;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rawHttpClient = yield* HttpClient.HttpClient;
  const inFlight = yield* Ref.make(false);

  const rootDir = path.join(config.baseDir, "agents");
  const activeDir = path.join(rootDir, "active");
  const versionsDir = path.join(rootDir, "versions");

  const activeManifestPath = (agentId: string) =>
    path.join(activeDir, `${storageKeyFor(agentId)}.json`);

  const readManifest = (
    filePath: string,
  ): Effect.Effect<ActiveAgentManifest, AgentInstallerError> =>
    Effect.gen(function* () {
      const raw = yield* fs.readFileString(filePath);
      return yield* decodeActiveAgentManifest(raw).pipe(
        Effect.mapError(() => fail("activation_failed", "Installed agent metadata is invalid.")),
      );
    }).pipe(
      Effect.mapError((error) =>
        isAgentInstallerError(error)
          ? error
          : fail("activation_failed", "Could not read installed agent metadata."),
      ),
    );

  const manifestCommandPath = (manifest: ActiveAgentManifest): string =>
    path.join(
      versionsDir,
      manifest.storageKey,
      manifest.versionKey,
      ...manifest.relativeCommand.replaceAll("\\", "/").split("/"),
    );

  const resolvePlanInternal = (agentId: string, refresh: boolean) =>
    Effect.gen(function* () {
      const snapshot = yield* catalog.get(refresh ? { refresh: true } : undefined);
      if (snapshot.status === "unavailable" || (refresh && snapshot.status !== "ready")) {
        return yield* fail(
          "catalog_unavailable",
          "The ACP registry could not be refreshed, so Sleepers Code refused to install from stale metadata.",
        );
      }
      const entry = snapshot.agents.find((candidate) => candidate.agent.id === agentId);
      if (entry === undefined) {
        return yield* fail(
          "agent_not_found",
          `Agent '${agentId}' is not present in the current registry.`,
        );
      }

      const blockers: AgentInstallPlan["blockers"][number][] = [];
      const distribution = entry.selectedDistribution;
      let archiveUrl = "https://invalid.local/unsupported";
      let command = "unsupported";
      let args: ReadonlyArray<string> = [];
      let sha256: string | undefined;
      let environmentVariables: ReadonlyArray<string> = [];
      let platformTriple = snapshot.platformTriple ?? "unsupported-platform";

      if (distribution.kind !== "binary") {
        blockers.push("distribution_not_binary");
      } else {
        archiveUrl = distribution.artifact.archive;
        command = distribution.artifact.cmd;
        args = distribution.artifact.args ?? [];
        sha256 = distribution.artifact.sha256?.toLowerCase();
        environmentVariables = Object.keys(distribution.artifact.env ?? {}).toSorted();
        platformTriple = distribution.triple;
        if (!isHttpsUrl(archiveUrl)) blockers.push("archive_not_https");
        if (!/^[0-9a-f]{64}$/.test(sha256 ?? "")) blockers.push("checksum_unavailable");
        if (!isSafeArchiveRelativePath(command)) blockers.push("command_path_unsafe");
      }

      const archiveFormat = resolveAgentInstallArchiveFormat(archiveUrl);
      if (archiveFormat === "unsupported") blockers.push("archive_format_unsupported");
      const archiveHost = (() => {
        try {
          return new URL(archiveUrl).host || "invalid-url";
        } catch {
          return "invalid-url";
        }
      })();
      const publisher =
        entry.agent.authors
          ?.map((author) => author.trim())
          .filter(Boolean)
          .join(", ") || "Publisher not listed";

      const plan = {
        planId: planFingerprint({ registryVersion: snapshot.registryVersion, entry }),
        agentId: entry.agent.id,
        displayName: entry.agent.name,
        version: entry.agent.version,
        publisher,
        ...(entry.agent.repository ? { repository: entry.agent.repository } : {}),
        trust: entry.trust,
        registryVersion: snapshot.registryVersion,
        platformTriple,
        archiveUrl,
        archiveHost,
        archiveFormat,
        ...(sha256 ? { sha256 } : {}),
        command,
        args,
        environmentVariables,
        prerequisites: entry.prerequisites,
        blockers,
        canInstall: blockers.length === 0,
        requiresPublisherAcknowledgement: entry.trust === "registry-unverified",
      } satisfies AgentInstallPlan;
      return {
        plan,
        environment: distribution.kind === "binary" ? { ...(distribution.artifact.env ?? {}) } : {},
      };
    });

  const list: AgentInstallerShape["list"] = Effect.gen(function* () {
    if (!(yield* fs.exists(activeDir))) return { installations: [] };
    const entries = yield* fs.readDirectory(activeDir);
    const installations: AgentInstallation[] = [];
    for (const entry of entries.toSorted()) {
      if (!entry.endsWith(".json")) continue;
      const decoded = yield* Effect.option(readManifest(path.join(activeDir, entry)));
      if (decoded._tag === "None") continue;
      const commandExists = yield* fs
        .exists(manifestCommandPath(decoded.value))
        .pipe(Effect.orElseSucceed(() => false));
      if (commandExists) installations.push(decoded.value.installation);
    }
    return { installations };
  }).pipe(Effect.mapError(() => fail("activation_failed", "Could not inspect installed agents.")));

  const executeDownloadRequest = (
    url: string,
    redirects = 0,
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, AgentInstallerError> =>
    Effect.gen(function* () {
      if (!isHttpsUrl(url)) {
        return yield* fail("download_failed", "Agent downloads and redirects must use HTTPS.");
      }
      const response = yield* rawHttpClient
        .execute(HttpClientRequest.get(url))
        .pipe(
          Effect.mapError(() => fail("download_failed", "Could not download the agent archive.")),
        );
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        if (redirects >= MAX_REDIRECTS) {
          return yield* fail("download_failed", "Agent download exceeded the redirect limit.");
        }
        const redirected = new URL(response.headers.location, url).toString();
        return yield* executeDownloadRequest(redirected, redirects + 1);
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* fail(
          "download_failed",
          `Agent archive download returned HTTP ${response.status}.`,
        );
      }
      return response;
    });

  const download = (input: {
    readonly url: string;
    readonly destination: string;
    readonly expectedSha256: string;
    readonly reportProgress: (event: AgentInstallProgressEvent) => Effect.Effect<void>;
  }) =>
    Effect.gen(function* () {
      const response = yield* executeDownloadRequest(input.url);
      const totalBytes = parseContentLength(response.headers["content-length"]);
      if (totalBytes !== undefined && totalBytes > MAX_DOWNLOAD_BYTES) {
        return yield* fail(
          "download_too_large",
          "Agent archive exceeds the 512 MiB download limit.",
        );
      }

      const hash = createHash("sha256");
      let bytesDownloaded = 0;
      let nextProgressAt = 0;
      yield* response.stream.pipe(
        Stream.mapEffect((chunk) => {
          bytesDownloaded += chunk.byteLength;
          if (bytesDownloaded > MAX_DOWNLOAD_BYTES) {
            return Effect.fail(
              fail("download_too_large", "Agent archive exceeds the 512 MiB download limit."),
            );
          }
          hash.update(chunk);
          if (bytesDownloaded < nextProgressAt) return Effect.succeed(chunk);
          nextProgressAt = bytesDownloaded + 1024 * 1024;
          return input
            .reportProgress({
              type: "progress",
              stage: "downloading",
              bytesDownloaded,
              ...(totalBytes === undefined ? {} : { totalBytes }),
            })
            .pipe(Effect.as(chunk));
        }),
        Stream.run(fs.sink(input.destination)),
        Effect.mapError((error) =>
          isAgentInstallerError(error)
            ? error
            : fail("download_failed", "Could not save the agent archive."),
        ),
      );
      const actualSha256 = hash.digest("hex");
      if (actualSha256 !== input.expectedSha256) {
        return yield* fail(
          "checksum_mismatch",
          "Downloaded agent archive did not match the publisher's SHA-256 checksum.",
        );
      }
      return { bytesDownloaded, actualSha256 };
    });

  const install: AgentInstallerShape["install"] = (input, reportProgress = () => Effect.void) =>
    Effect.gen(function* () {
      if (yield* Ref.getAndSet(inFlight, true)) {
        return yield* fail("install_in_progress", "Another agent installation is already running.");
      }
      return yield* Effect.gen(function* () {
        yield* reportProgress({ type: "progress", stage: "revalidating" });
        const resolvedPlan = yield* resolvePlanInternal(input.agentId, true);
        const { plan } = resolvedPlan;
        if (plan.planId !== input.planId) {
          return yield* fail(
            "stale_plan",
            "The registry entry changed after confirmation. Review the new installation plan.",
          );
        }
        if (!plan.canInstall || plan.sha256 === undefined) {
          return yield* fail(
            "unsafe_distribution",
            "This distribution does not pass the secure binary installation gate.",
          );
        }
        if (plan.archiveFormat === "unsupported") {
          return yield* fail("unsupported_archive", "This archive format is not supported.");
        }
        const archiveFormat = plan.archiveFormat;
        if (plan.requiresPublisherAcknowledgement && !input.acknowledgeUnverifiedPublisher) {
          return yield* fail(
            "consent_required",
            "Confirm that registry membership does not verify the publisher before installing.",
          );
        }
        if (!isSafeArchiveRelativePath(plan.command)) {
          return yield* fail("command_invalid", "The registry command path is unsafe.");
        }

        const storageKey = storageKeyFor(plan.agentId);
        const versionKey = versionKeyFor(plan.version, plan.sha256);
        const agentVersionsDir = path.join(versionsDir, storageKey);
        const finalVersionDir = path.join(agentVersionsDir, versionKey);
        const finalCommandPath = path.join(
          finalVersionDir,
          ...plan.command.replaceAll("\\", "/").split("/"),
        );
        yield* fs
          .makeDirectory(agentVersionsDir, { recursive: true })
          .pipe(
            Effect.mapError(() =>
              fail("activation_failed", "Could not prepare the agent directory."),
            ),
          );

        let manifest: ActiveAgentManifest | undefined;
        if (yield* fs.exists(finalVersionDir)) {
          const candidate = yield* readManifest(path.join(finalVersionDir, ".agent-install.json"));
          if (
            candidate.installation.agentId !== plan.agentId ||
            candidate.installation.sha256 !== plan.sha256 ||
            !(yield* fs.exists(finalCommandPath))
          ) {
            return yield* fail(
              "activation_failed",
              "An incompatible installation already occupies the target version directory.",
            );
          }
          manifest = candidate;
        } else {
          const stagingDir = yield* fs.makeTempDirectory({
            directory: agentVersionsDir,
            prefix: ".staging-",
          });
          manifest = yield* Effect.gen(function* () {
            const archivePath = path.join(stagingDir, "archive.download");
            const payloadDir = path.join(stagingDir, "payload");
            yield* reportProgress({ type: "progress", stage: "downloading", bytesDownloaded: 0 });
            yield* download({
              url: plan.archiveUrl,
              destination: archivePath,
              expectedSha256: plan.sha256!,
              reportProgress,
            });
            yield* reportProgress({ type: "progress", stage: "verifying" });
            yield* reportProgress({ type: "progress", stage: "extracting" });
            yield* extractAgentArchive({
              format: archiveFormat,
              archivePath,
              destination: payloadDir,
              command: plan.command,
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
              Effect.mapError((error) =>
                error instanceof AgentArchiveError
                  ? fail("archive_invalid", error.message)
                  : fail("archive_invalid", "Could not extract the agent archive."),
              ),
            );

            const stagedRoot = yield* fs
              .realPath(payloadDir)
              .pipe(
                Effect.mapError(() =>
                  fail("command_invalid", "Could not resolve the staged agent directory."),
                ),
              );
            const stagedCommand = path.join(
              payloadDir,
              ...plan.command.replaceAll("\\", "/").split("/"),
            );
            const commandExists = yield* fs.exists(stagedCommand);
            if (!commandExists) {
              return yield* fail(
                "command_invalid",
                `The extracted archive does not contain '${plan.command}'.`,
              );
            }
            const realCommand = yield* fs
              .realPath(stagedCommand)
              .pipe(
                Effect.mapError(() =>
                  fail("command_invalid", "Could not resolve the installed command."),
                ),
              );
            const relativeCommand = path.relative(stagedRoot, realCommand);
            if (
              !relativeCommand ||
              relativeCommand.startsWith("..") ||
              path.isAbsolute(relativeCommand)
            ) {
              return yield* fail(
                "command_invalid",
                "The installed command resolves outside the staged agent directory.",
              );
            }
            const commandInfo = yield* fs
              .stat(realCommand)
              .pipe(
                Effect.mapError(() =>
                  fail("command_invalid", "Could not inspect the installed command."),
                ),
              );
            if (commandInfo.type !== "File") {
              return yield* fail("command_invalid", "The installed command is not a regular file.");
            }
            if (globalThis.process.platform !== "win32") {
              yield* fs.chmod(realCommand, 0o755).pipe(Effect.ignore);
            }

            const installedAt = DateTime.formatIso(yield* DateTime.now);
            const installation: AgentInstallation = {
              agentId: plan.agentId,
              displayName: plan.displayName,
              version: plan.version,
              platformTriple: plan.platformTriple,
              installedAt,
              trust: plan.trust,
              sourceUrl: plan.archiveUrl,
              sha256: plan.sha256!,
              command: plan.command,
              args: plan.args,
            };
            const nextManifest: ActiveAgentManifest = {
              schemaVersion: ACTIVE_MANIFEST_VERSION,
              installation,
              relativeCommand: plan.command,
              environment: resolvedPlan.environment,
              storageKey,
              versionKey,
            };
            const encodedManifest = yield* encodeActiveAgentManifest(nextManifest).pipe(
              Effect.mapError(() =>
                fail("activation_failed", "Could not encode agent installation metadata."),
              ),
            );
            yield* fs.writeFileString(
              path.join(payloadDir, ".agent-install.json"),
              `${encodedManifest}\n`,
            );
            yield* reportProgress({ type: "progress", stage: "activating" });
            yield* fs
              .rename(payloadDir, finalVersionDir)
              .pipe(
                Effect.mapError(() =>
                  fail("activation_failed", "Could not publish the installed agent."),
                ),
              );
            return nextManifest;
          }).pipe(
            Effect.ensuring(
              fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.ignore),
            ),
          );
        }

        yield* reportProgress({ type: "progress", stage: "activating" });
        yield* fs
          .makeDirectory(activeDir, { recursive: true })
          .pipe(
            Effect.mapError(() =>
              fail("activation_failed", "Could not prepare agent activation metadata."),
            ),
          );
        const encodedManifest = yield* encodeActiveAgentManifest(manifest).pipe(
          Effect.mapError(() =>
            fail("activation_failed", "Could not encode agent activation metadata."),
          ),
        );
        yield* writeFileStringAtomically({
          filePath: activeManifestPath(plan.agentId),
          contents: `${encodedManifest}\n`,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError(() =>
            fail("activation_failed", "Could not activate the installed agent."),
          ),
        );
        yield* Effect.logInfo("Agent installation activated.", {
          agentId: plan.agentId,
          version: plan.version,
          sha256: plan.sha256,
          archiveHost: plan.archiveHost,
        });
        yield* reportProgress({ type: "complete", installation: manifest.installation });
        return manifest.installation;
      }).pipe(
        Effect.mapError((error) =>
          isAgentInstallerError(error)
            ? error
            : fail("activation_failed", "The agent installation transaction failed."),
        ),
        Effect.ensuring(Ref.set(inFlight, false)),
      );
    });

  const uninstall: AgentInstallerShape["uninstall"] = (input) =>
    Effect.gen(function* () {
      if (!input.confirm) {
        return yield* fail("consent_required", "Confirm the agent uninstall operation.");
      }
      if (yield* Ref.getAndSet(inFlight, true)) {
        return yield* fail("install_in_progress", "Another agent installation is already running.");
      }
      return yield* Effect.gen(function* () {
        const filePath = activeManifestPath(input.agentId);
        if (!(yield* fs.exists(filePath))) {
          return yield* fail("not_installed", `Agent '${input.agentId}' is not installed.`);
        }
        const manifest = yield* readManifest(filePath);
        const agentVersionsDir = path.join(versionsDir, manifest.storageKey);
        yield* fs
          .remove(agentVersionsDir, { recursive: true, force: true })
          .pipe(
            Effect.mapError(() =>
              fail("uninstall_failed", "Could not remove the installed agent files."),
            ),
          );
        yield* fs
          .remove(filePath, { force: true })
          .pipe(
            Effect.mapError(() =>
              fail("uninstall_failed", "Could not remove agent activation metadata."),
            ),
          );
        yield* Effect.logInfo("Agent installation removed.", { agentId: input.agentId });
        return { agentId: input.agentId, removed: true } satisfies AgentUninstallResult;
      }).pipe(
        Effect.mapError((error) =>
          isAgentInstallerError(error)
            ? error
            : fail("uninstall_failed", "The agent uninstall transaction failed."),
        ),
        Effect.ensuring(Ref.set(inFlight, false)),
      );
    });

  return AgentInstaller.of({
    getPlan: (agentId) =>
      resolvePlanInternal(agentId, false).pipe(Effect.map((resolved) => resolved.plan)),
    list,
    install,
    uninstall,
  });
});

export const layer = Layer.effect(AgentInstaller, make());
