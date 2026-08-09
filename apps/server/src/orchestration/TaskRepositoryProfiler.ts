import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type {
  TaskRepositoryEvidence,
  TaskRepositoryFramework,
  TaskRepositoryLanguage,
  TaskRepositoryMarker,
  TaskRepositoryTestRunner,
} from "@t3tools/contracts";

const EVIDENCE_VERSION = 1 as const;
const CACHE_TTL_MS = 5 * 60 * 1_000;
const CACHE_CAPACITY = 32;
const MANIFEST_MAX_BYTES = 128 * 1_024;

type MarkerDefinition = {
  readonly marker: TaskRepositoryMarker;
  readonly files: ReadonlyArray<string>;
  readonly languages?: ReadonlyArray<TaskRepositoryLanguage>;
  readonly testRunners?: ReadonlyArray<TaskRepositoryTestRunner>;
};

const markerDefinitions: ReadonlyArray<MarkerDefinition> = [
  { marker: "package-json", files: ["package.json"], languages: ["javascript"] },
  { marker: "tsconfig-json", files: ["tsconfig.json"], languages: ["typescript"] },
  { marker: "pnpm-workspace", files: ["pnpm-workspace.yaml"] },
  { marker: "turbo-json", files: ["turbo.json"] },
  { marker: "cargo-toml", files: ["Cargo.toml"], languages: ["rust"], testRunners: ["cargo"] },
  {
    marker: "pyproject-toml",
    files: ["pyproject.toml"],
    languages: ["python"],
  },
  { marker: "requirements-txt", files: ["requirements.txt"], languages: ["python"] },
  { marker: "go-mod", files: ["go.mod"], languages: ["go"], testRunners: ["go-test"] },
  { marker: "pom-xml", files: ["pom.xml"], languages: ["java"] },
  {
    marker: "gradle",
    files: ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"],
    languages: ["java", "kotlin"],
    testRunners: ["gradle"],
  },
  {
    marker: "package-swift",
    files: ["Package.swift"],
    languages: ["swift"],
    testRunners: ["swift-test"],
  },
  {
    marker: "dotnet",
    files: ["global.json", "Directory.Build.props"],
    languages: ["dotnet"],
    testRunners: ["dotnet-test"],
  },
  { marker: "cmake", files: ["CMakeLists.txt"], languages: ["cpp"] },
  { marker: "pubspec-yaml", files: ["pubspec.yaml"], languages: ["dart"] },
  { marker: "gemfile", files: ["Gemfile"], languages: ["ruby"] },
  { marker: "composer-json", files: ["composer.json"], languages: ["php"] },
];

const packageFrameworkPatterns: ReadonlyArray<
  readonly [TaskRepositoryFramework, ReadonlyArray<RegExp>]
> = [
  ["react", [/"react"\s*:/]],
  ["next", [/"next"\s*:/]],
  ["vue", [/"vue"\s*:/]],
  ["svelte", [/"svelte"\s*:/, /"@sveltejs\//]],
  ["vite", [/"vite"\s*:/, /"@vitejs\//]],
  ["expo", [/"expo"\s*:/]],
  ["electron", [/"electron"\s*:/]],
  ["tauri", [/"@tauri-apps\//, /\btauri\b/]],
  ["effect", [/"effect"\s*:/]],
  ["express", [/"express"\s*:/]],
  ["fastify", [/"fastify"\s*:/]],
];

const packageTestRunnerPatterns: ReadonlyArray<
  readonly [TaskRepositoryTestRunner, ReadonlyArray<RegExp>]
> = [
  ["vitest", [/"vitest"\s*:/]],
  ["jest", [/"jest"\s*:/]],
  ["playwright", [/"@playwright\/test"\s*:/, /"playwright"\s*:/]],
  ["cypress", [/"cypress"\s*:/]],
];

interface CacheEntry {
  readonly expiresAt: number;
  readonly evidence: TaskRepositoryEvidence;
}

const evidenceCache = new Map<string, CacheEntry>();

const unique = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(values)];

const emptyEvidence = (limited: boolean): TaskRepositoryEvidence => ({
  version: EVIDENCE_VERSION,
  source: "root-markers",
  markers: [],
  languages: [],
  frameworks: [],
  testRunners: [],
  workspace: "unknown",
  limited,
});

export const collectTaskRepositoryEvidence = Effect.fn(
  "TaskRepositoryProfiler.collectTaskRepositoryEvidence",
)(function* (cwd: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rootInfo = yield* fileSystem.stat(cwd).pipe(Effect.result);
  if (rootInfo._tag === "Failure" || rootInfo.success.type !== "Directory") {
    return emptyEvidence(true);
  }

  let limited = false;
  const presentDefinitions: MarkerDefinition[] = [];
  for (const definition of markerDefinitions) {
    let present = false;
    for (const relativePath of definition.files) {
      const result = yield* fileSystem.exists(path.join(cwd, relativePath)).pipe(Effect.result);
      if (result._tag === "Failure") {
        limited = true;
      } else if (result.success) {
        present = true;
        break;
      }
    }
    if (present) presentDefinitions.push(definition);
  }

  const presentMarkers = presentDefinitions.map((definition) => definition.marker);
  const readBoundedManifest = (relativePath: string) =>
    Effect.gen(function* () {
      const absolutePath = path.join(cwd, relativePath);
      const info = yield* fileSystem.stat(absolutePath);
      if (info.type !== "File" || info.size > BigInt(MANIFEST_MAX_BYTES)) {
        return { text: "", limited: true } as const;
      }
      return {
        text: (yield* fileSystem.readFileString(absolutePath)).toLowerCase(),
        limited: false,
      } as const;
    }).pipe(Effect.catchCause(() => Effect.succeed({ text: "", limited: true } as const)));

  const packageManifest = presentMarkers.includes("package-json")
    ? yield* readBoundedManifest("package.json")
    : { text: "", limited: false };
  const cargoManifest = presentMarkers.includes("cargo-toml")
    ? yield* readBoundedManifest("Cargo.toml")
    : { text: "", limited: false };
  const pyprojectManifest = presentMarkers.includes("pyproject-toml")
    ? yield* readBoundedManifest("pyproject.toml")
    : { text: "", limited: false };
  limited ||= packageManifest.limited || cargoManifest.limited || pyprojectManifest.limited;

  const frameworks = packageFrameworkPatterns.flatMap(([framework, patterns]) =>
    patterns.some((pattern) => pattern.test(packageManifest.text)) ? [framework] : [],
  );
  const packageTestRunners = packageTestRunnerPatterns.flatMap(([runner, patterns]) =>
    patterns.some((pattern) => pattern.test(packageManifest.text)) ? [runner] : [],
  );
  const pyprojectTestRunners = /\bpytest\b|\[tool\.pytest\./.test(pyprojectManifest.text)
    ? (["pytest"] as const)
    : [];
  const languages = unique(presentDefinitions.flatMap((definition) => definition.languages ?? []));
  const testRunners = unique<TaskRepositoryTestRunner>([
    ...presentDefinitions.flatMap((definition) => definition.testRunners ?? []),
    ...packageTestRunners,
    ...pyprojectTestRunners,
  ]);
  const monorepo =
    presentMarkers.includes("pnpm-workspace") ||
    presentMarkers.includes("turbo-json") ||
    /"workspaces"\s*:/.test(packageManifest.text) ||
    /^\s*\[workspace\]/m.test(cargoManifest.text);

  return {
    version: EVIDENCE_VERSION,
    source: "root-markers",
    markers: presentMarkers,
    languages,
    frameworks,
    testRunners,
    workspace: monorepo ? "monorepo" : presentMarkers.length > 0 ? "single-package" : "unknown",
    limited,
  } satisfies TaskRepositoryEvidence;
});

export const getTaskRepositoryEvidence = Effect.fn(
  "TaskRepositoryProfiler.getTaskRepositoryEvidence",
)(function* (cwd: string) {
  const path = yield* Path.Path;
  const normalizedCwd = path.resolve(cwd);
  const now = yield* Clock.currentTimeMillis;
  const cached = evidenceCache.get(normalizedCwd);
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.evidence;
  }

  const evidence = yield* collectTaskRepositoryEvidence(normalizedCwd).pipe(
    Effect.catchCause(() => Effect.succeed(emptyEvidence(true))),
  );
  evidenceCache.delete(normalizedCwd);
  evidenceCache.set(normalizedCwd, { expiresAt: now + CACHE_TTL_MS, evidence });
  while (evidenceCache.size > CACHE_CAPACITY) {
    const oldest = evidenceCache.keys().next().value;
    if (oldest === undefined) break;
    evidenceCache.delete(oldest);
  }
  return evidence;
});
