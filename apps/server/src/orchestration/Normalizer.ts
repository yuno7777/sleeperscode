import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import {
  type RouterContext,
  type ClientOrchestrationCommand,
  type IsoDateTime,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import { buildRouterContext } from "@t3tools/shared/router";

import { createAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import type { ProviderRegistryShape } from "../provider/Services/ProviderRegistry.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as TaskRepositoryProfiler from "./TaskRepositoryProfiler.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";

type ClientThreadTurnStartCommand = Extract<
  ClientOrchestrationCommand,
  { readonly type: "thread.turn.start" }
>;

type TaskRepositoryRootQuery = Pick<
  ProjectionSnapshotQueryShape,
  "getProjectShellById" | "getThreadShellById"
>;

export const canonicalizeClientCommandTimestamps = (
  command: ClientOrchestrationCommand,
  receivedAt: IsoDateTime,
): ClientOrchestrationCommand => {
  const canonicalCommand =
    "createdAt" in command
      ? {
          ...command,
          createdAt: receivedAt,
        }
      : command;

  if (canonicalCommand.type !== "thread.turn.start" || !canonicalCommand.bootstrap?.createThread) {
    return canonicalCommand;
  }

  return {
    ...canonicalCommand,
    bootstrap: {
      ...canonicalCommand.bootstrap,
      createThread: {
        ...canonicalCommand.bootstrap.createThread,
        createdAt: receivedAt,
      },
    },
  };
};

export const resolveTurnRepositoryRoot = (
  command: ClientThreadTurnStartCommand,
  query: TaskRepositoryRootQuery,
) =>
  Effect.gen(function* () {
    if (command.bootstrap?.prepareWorktree?.projectCwd !== undefined) {
      return command.bootstrap.prepareWorktree.projectCwd;
    }

    const thread = yield* query
      .getThreadShellById(command.threadId)
      .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
    if (Option.isSome(thread) && thread.value.worktreePath !== null) {
      return thread.value.worktreePath;
    }

    const bootstrapWorktree = command.bootstrap?.createThread?.worktreePath;
    if (bootstrapWorktree != null) return bootstrapWorktree;

    const projectId = Option.isSome(thread)
      ? thread.value.projectId
      : command.bootstrap?.createThread?.projectId;
    if (projectId === undefined) return undefined;

    const project = yield* query
      .getProjectShellById(projectId)
      .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
    return Option.isSome(project) ? project.value.workspaceRoot : undefined;
  });

export const readRouterContext = (registry: Pick<ProviderRegistryShape, "getProviders">) =>
  registry.getProviders.pipe(
    Effect.map(buildRouterContext),
    Effect.catchCause(() =>
      Effect.succeed({ version: 1, candidates: [], limited: true } satisfies RouterContext),
    ),
  );

export const normalizeDispatchCommand = (
  command: ClientOrchestrationCommand,
  options?: { readonly routerContext?: RouterContext },
) =>
  Effect.gen(function* () {
    const receivedAt = DateTime.formatIso(yield* DateTime.now);
    const canonicalCommand = canonicalizeClientCommandTimestamps(command, receivedAt);
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

    const normalizeProjectWorkspaceRoot = (workspaceRoot: string) =>
      workspacePaths.normalizeWorkspaceRoot(workspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: cause.message,
            }),
        ),
      );

    const normalizeProjectWorkspaceRootForCreate = (
      workspaceRoot: string,
      createIfMissing: boolean | undefined,
    ) =>
      workspacePaths
        .normalizeWorkspaceRoot(workspaceRoot, {
          createIfMissing: createIfMissing === true,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: cause.message,
              }),
          ),
        );

    if (canonicalCommand.type === "project.create") {
      return {
        ...canonicalCommand,
        workspaceRoot: yield* normalizeProjectWorkspaceRootForCreate(
          canonicalCommand.workspaceRoot,
          canonicalCommand.createWorkspaceRootIfMissing,
        ),
        createWorkspaceRootIfMissing: canonicalCommand.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
    }

    if (
      canonicalCommand.type === "project.meta.update" &&
      canonicalCommand.workspaceRoot !== undefined
    ) {
      return {
        ...canonicalCommand,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(canonicalCommand.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (canonicalCommand.type !== "thread.turn.start") {
      return canonicalCommand as OrchestrationCommand;
    }

    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const repositoryRoot = yield* resolveTurnRepositoryRoot(
      canonicalCommand,
      projectionSnapshotQuery,
    );
    const repositoryEvidence =
      repositoryRoot === undefined
        ? undefined
        : yield* TaskRepositoryProfiler.getTaskRepositoryEvidence(repositoryRoot);
    const routerContext = options?.routerContext ?? {
      version: 1,
      candidates: [],
      limited: true,
    };

    const normalizedAttachments = yield* Effect.forEach(
      canonicalCommand.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed || !parsed.mimeType.startsWith("image/")) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Invalid image attachment payload for '${attachment.name}'.`,
            });
          }

          const bytes = Buffer.from(parsed.base64, "base64");
          if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Image attachment '${attachment.name}' is empty or too large.`,
            });
          }

          const attachmentId = createAttachmentId(canonicalCommand.threadId);
          if (!attachmentId) {
            return yield* new OrchestrationDispatchCommandError({
              message: "Failed to create a safe attachment id.",
            });
          }

          const persistedAttachment = {
            type: "image" as const,
            id: attachmentId,
            name: attachment.name,
            mimeType: parsed.mimeType.toLowerCase(),
            sizeBytes: bytes.byteLength,
          };

          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }

          yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to create attachment directory for '${attachment.name}'.`,
                }),
            ),
          );
          yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to persist attachment '${attachment.name}'.`,
                }),
            ),
          );

          return persistedAttachment;
        }),
      { concurrency: 1 },
    );

    return {
      ...canonicalCommand,
      message: {
        ...canonicalCommand.message,
        attachments: normalizedAttachments,
      },
      ...(repositoryEvidence === undefined ? {} : { repositoryEvidence }),
      routerContext,
    } satisfies OrchestrationCommand;
  });
