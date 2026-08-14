#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

export class ReleasePackageManifestError extends Schema.TaggedErrorClass<ReleasePackageManifestError>()(
  "ReleasePackageManifestError",
  {
    operation: Schema.Literals(["read", "decode", "encode", "write"]),
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} release package manifest '${this.filePath}'.`;
  }
}

export class ReleaseGitHubOutputConfigurationError extends Schema.TaggedErrorClass<ReleaseGitHubOutputConfigurationError>()(
  "ReleaseGitHubOutputConfigurationError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to resolve GITHUB_OUTPUT for release package version output.";
  }
}

export class ReleaseGitHubOutputWriteError extends Schema.TaggedErrorClass<ReleaseGitHubOutputWriteError>()(
  "ReleaseGitHubOutputWriteError",
  {
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to append release package version output to '${this.filePath}'.`;
  }
}

export class InvalidReleaseVersionError extends Schema.TaggedErrorClass<InvalidReleaseVersionError>()(
  "InvalidReleaseVersionError",
  { version: Schema.String },
) {
  override get message(): string {
    return `Release version '${this.version}' is not exact semantic version syntax.`;
  }
}

const SEMVER_NUMBER = "(?:0|[1-9]\\d*)";
const SEMVER_PRERELEASE = `(?:${SEMVER_NUMBER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const EXACT_RELEASE_VERSION = new RegExp(
  `^${SEMVER_NUMBER}\\.${SEMVER_NUMBER}\\.${SEMVER_NUMBER}(?:-${SEMVER_PRERELEASE}(?:\\.${SEMVER_PRERELEASE})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

export function isExactReleaseVersion(version: string): boolean {
  return EXACT_RELEASE_VERSION.test(version);
}

export const releasePackageFiles = [
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
] as const;

export const releaseCargoPackageFiles = [
  "crates/runtime-protocol/Cargo.toml",
  "crates/runtime-sidecar/Cargo.toml",
  "native/resource-monitor/Cargo.toml",
] as const;

export const releaseCargoLockPackages = [
  {
    filePath: "Cargo.lock",
    packageNames: ["t3-runtime-protocol", "t3-runtime-sidecar"],
  },
  {
    filePath: "native/resource-monitor/Cargo.lock",
    packageNames: ["t3-resource-monitor"],
  },
] as const;

interface UpdateReleasePackageVersionsOptions {
  readonly rootDir?: string | undefined;
}

const PackageJsonSchema = Schema.Record(Schema.String, Schema.Unknown);
const PackageJsonPrettyJson = fromJsonStringPretty(PackageJsonSchema);
const decodePackageJson = Schema.decodeUnknownEffect(PackageJsonPrettyJson);
const encodePackageJson = Schema.encodeEffect(PackageJsonPrettyJson);

export function updateCargoPackageVersionText(contents: string, version: string) {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  let inPackageSection = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*\[package\]\s*$/.test(line)) {
      inPackageSection = true;
      continue;
    }
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      if (inPackageSection) break;
      continue;
    }
    if (!inPackageSection) continue;

    const match = /^(\s*version\s*=\s*)"([^"]*)"(\s*(?:#.*)?)$/.exec(line);
    if (!match) continue;

    if (match[2] === version) {
      return { changed: false, contents };
    }
    lines[index] = `${match[1]}"${version}"${match[3]}`;
    return { changed: true, contents: lines.join(newline) };
  }

  throw new Error("Cargo manifest is missing a double-quoted [package].version field.");
}

export function updateCargoLockPackageVersionsText(
  contents: string,
  packageNames: ReadonlyArray<string>,
  version: string,
) {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const targets = new Set(packageNames);
  const found = new Set<string>();
  let packageName: string | undefined;
  let versionLineIndex: number | undefined;
  let changed = false;

  const updatePackageBlock = () => {
    if (!packageName || !targets.has(packageName) || versionLineIndex === undefined) return;
    found.add(packageName);
    const line = lines[versionLineIndex]!;
    const match = /^(\s*version\s*=\s*)"([^"]*)"(\s*(?:#.*)?)$/.exec(line);
    if (!match || match[2] === version) return;
    lines[versionLineIndex] = `${match[1]}"${version}"${match[3]}`;
    changed = true;
  };

  for (let index = 0; index <= lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || /^\s*\[\[package\]\]\s*$/.test(line)) {
      updatePackageBlock();
      packageName = undefined;
      versionLineIndex = undefined;
      continue;
    }
    const name = /^\s*name\s*=\s*"([^"]+)"\s*$/.exec(line)?.[1];
    if (name) packageName = name;
    if (/^\s*version\s*=\s*"[^"]*"\s*(?:#.*)?$/.test(line)) versionLineIndex = index;
  }

  const missing = packageNames.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`Cargo lockfile is missing package entries: ${missing.join(", ")}.`);
  }

  return { changed, contents: changed ? lines.join(newline) : contents };
}

export const updateReleasePackageVersions = Effect.fn("updateReleasePackageVersions")(function* (
  version: string,
  options: UpdateReleasePackageVersionsOptions = {},
) {
  if (!isExactReleaseVersion(version)) {
    return yield* new InvalidReleaseVersionError({ version });
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  let changed = false;

  for (const relativePath of releasePackageFiles) {
    const filePath = path.join(rootDir, relativePath);
    const packageJsonText = yield* fs.readFileString(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new ReleasePackageManifestError({
            operation: "read",
            filePath,
            cause,
          }),
      ),
    );
    const packageJson = yield* decodePackageJson(packageJsonText).pipe(
      Effect.mapError(
        (cause) =>
          new ReleasePackageManifestError({
            operation: "decode",
            filePath,
            cause,
          }),
      ),
    );
    if (packageJson.version === version) {
      continue;
    }

    const packageJsonString = yield* encodePackageJson({ ...packageJson, version }).pipe(
      Effect.mapError(
        (cause) =>
          new ReleasePackageManifestError({
            operation: "encode",
            filePath,
            cause,
          }),
      ),
    );
    yield* fs.writeFileString(filePath, `${packageJsonString}\n`).pipe(
      Effect.mapError(
        (cause) =>
          new ReleasePackageManifestError({
            operation: "write",
            filePath,
            cause,
          }),
      ),
    );
    changed = true;
  }

  for (const relativePath of releaseCargoPackageFiles) {
    const filePath = path.join(rootDir, relativePath);
    const cargoTomlText = yield* fs.readFileString(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new ReleasePackageManifestError({
            operation: "read",
            filePath,
            cause,
          }),
      ),
    );
    const updated = yield* Effect.try({
      try: () => updateCargoPackageVersionText(cargoTomlText, version),
      catch: (cause) =>
        new ReleasePackageManifestError({
          operation: "decode",
          filePath,
          cause,
        }),
    });
    if (!updated.changed) continue;

    yield* fs.writeFileString(filePath, updated.contents).pipe(
      Effect.mapError(
        (cause) =>
          new ReleasePackageManifestError({
            operation: "write",
            filePath,
            cause,
          }),
      ),
    );
    changed = true;
  }

  for (const lockPackage of releaseCargoLockPackages) {
    const filePath = path.join(rootDir, lockPackage.filePath);
    const cargoLockText = yield* fs.readFileString(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new ReleasePackageManifestError({
            operation: "read",
            filePath,
            cause,
          }),
      ),
    );
    const updated = yield* Effect.try({
      try: () =>
        updateCargoLockPackageVersionsText(cargoLockText, lockPackage.packageNames, version),
      catch: (cause) =>
        new ReleasePackageManifestError({
          operation: "decode",
          filePath,
          cause,
        }),
    });
    if (!updated.changed) continue;

    yield* fs.writeFileString(filePath, updated.contents).pipe(
      Effect.mapError(
        (cause) =>
          new ReleasePackageManifestError({
            operation: "write",
            filePath,
            cause,
          }),
      ),
    );
    changed = true;
  }

  return { changed };
});

const writeGithubOutput = Effect.fn("writeGithubOutput")(function* (changed: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const githubOutputPath = yield* Config.nonEmptyString("GITHUB_OUTPUT").pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseGitHubOutputConfigurationError({
          cause,
        }),
    ),
  );
  yield* fs.writeFileString(githubOutputPath, `changed=${changed}\n`, { flag: "a" }).pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseGitHubOutputWriteError({
          filePath: githubOutputPath,
          cause,
        }),
    ),
  );
});

export const updateReleasePackageVersionsCommand = Command.make(
  "update-release-package-versions",
  {
    version: Argument.string("version").pipe(
      Argument.withDescription("Release version to write into every product and native manifest."),
    ),
    root: Flag.string("root").pipe(
      Flag.withDescription("Workspace root used to resolve the release package manifests."),
      Flag.optional,
    ),
    githubOutput: Flag.boolean("github-output").pipe(
      Flag.withDescription("Append changed=<boolean> to GITHUB_OUTPUT."),
      Flag.withDefault(false),
    ),
  },
  ({ version, root, githubOutput }) =>
    updateReleasePackageVersions(version, {
      rootDir: Option.getOrUndefined(root),
    }).pipe(
      Effect.tap(({ changed }) =>
        changed ? Effect.void : Console.log("All release manifest versions already match."),
      ),
      Effect.tap(({ changed }) => (githubOutput ? writeGithubOutput(changed) : Effect.void)),
    ),
).pipe(Command.withDescription("Update release package versions across the workspace."));

if (import.meta.main) {
  Command.run(updateReleasePackageVersionsCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
