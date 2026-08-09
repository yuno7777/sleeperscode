import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import extractZip from "extract-zip";
import * as Tar from "tar";

import type { AgentInstallArchiveFormat } from "@t3tools/contracts";

const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;
const ZIP_SYMLINK_MODE = 0o120000;
const ZIP_FILE_TYPE_MASK = 0o170000;

export class AgentArchiveError extends Error {
  override readonly name = "AgentArchiveError";
}

/** Rejects absolute, drive-qualified, NUL-containing, and parent-traversing paths. */
export function isSafeArchiveRelativePath(value: string): boolean {
  if (!value || value.includes("\0")) return false;
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return false;
  return normalized.split("/").every((segment) => segment !== "..");
}

function assertSafeArchivePath(value: string): void {
  if (!isSafeArchiveRelativePath(value)) {
    throw new AgentArchiveError(`Archive entry uses an unsafe path: ${value}`);
  }
}

function makeExpansionGuard() {
  let entries = 0;
  let bytes = 0;
  return (entryBytes: number) => {
    entries += 1;
    bytes += Math.max(0, entryBytes);
    if (entries > MAX_ARCHIVE_ENTRIES) {
      throw new AgentArchiveError("Archive contains too many entries.");
    }
    if (bytes > MAX_EXTRACTED_BYTES) {
      throw new AgentArchiveError("Archive expands beyond the installation size limit.");
    }
  };
}

const extractZipArchive = (archivePath: string, destination: string) =>
  Effect.tryPromise({
    try: async () => {
      const guard = makeExpansionGuard();
      await extractZip(archivePath, {
        dir: destination,
        onEntry: (entry) => {
          assertSafeArchivePath(entry.fileName);
          const mode = (entry.externalFileAttributes >> 16) & 0xffff;
          if ((mode & ZIP_FILE_TYPE_MASK) === ZIP_SYMLINK_MODE) {
            throw new AgentArchiveError("Symbolic links are not allowed in agent archives.");
          }
          guard(entry.uncompressedSize);
        },
      });
    },
    catch: (cause) =>
      cause instanceof AgentArchiveError
        ? cause
        : new AgentArchiveError(`Could not extract ZIP archive: ${String(cause)}`),
  });

const extractTarGzArchive = (archivePath: string, destination: string) =>
  Effect.tryPromise({
    try: async () => {
      const guard = makeExpansionGuard();
      await Tar.extract({
        file: archivePath,
        cwd: destination,
        gzip: true,
        preservePaths: false,
        strict: true,
        filter: (entryPath, entry) => {
          assertSafeArchivePath(entryPath);
          if (!("type" in entry)) {
            throw new AgentArchiveError("Archive entry metadata is invalid.");
          }
          if (entry.type !== "File" && entry.type !== "OldFile" && entry.type !== "Directory") {
            throw new AgentArchiveError(
              `Archive entry type '${entry.type}' is not allowed for agent installations.`,
            );
          }
          guard(entry.size ?? 0);
          return true;
        },
      });
    },
    catch: (cause) =>
      cause instanceof AgentArchiveError
        ? cause
        : new AgentArchiveError(`Could not extract tar archive: ${String(cause)}`),
  });

export const extractAgentArchive = Effect.fn("agent_installer.extract_archive")(function* (input: {
  readonly format: Exclude<AgentInstallArchiveFormat, "unsupported">;
  readonly archivePath: string;
  readonly destination: string;
  readonly command: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(input.destination, { recursive: true });

  if (input.format === "zip") {
    yield* extractZipArchive(input.archivePath, input.destination);
    return;
  }
  if (input.format === "tar-gz") {
    yield* extractTarGzArchive(input.archivePath, input.destination);
    return;
  }

  if (!isSafeArchiveRelativePath(input.command)) {
    return yield* Effect.fail(new AgentArchiveError("Executable command path is unsafe."));
  }
  const commandPath = path.join(
    input.destination,
    ...input.command.replaceAll("\\", "/").split("/"),
  );
  yield* fs.makeDirectory(path.dirname(commandPath), { recursive: true });
  yield* fs.copyFile(input.archivePath, commandPath);
});
