import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The native finder is a dependency of apps/server, not of scripts, so load it from
// there rather than adding a duplicate dependency for a benchmark. Its exports map
// is import-only, so read the entry point out of its manifest instead of resolving.
const packageDirectory = path.join(
  repositoryRoot,
  "apps",
  "server",
  "node_modules",
  "@ff-labs",
  "fff-node",
);
const manifest = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
const entryPoint = manifest.exports?.["."]?.import ?? manifest.main;
const { FileFinder } = await import(pathToFileURL(path.join(packageDirectory, entryPoint)).href);

function numericArgument(name, fallback) {
  const argument = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  const parsed = Number(argument?.slice(name.length + 3) ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name}: ${argument}. Expected a positive number.`);
  }
  return parsed;
}

const repeat = numericArgument("repeat", 3);
const targetArgument = process.argv.slice(2).find((value) => value.startsWith("--path="));
const target = path.resolve(targetArgument?.slice("--path=".length) ?? repositoryRoot);

/** Directories the roadmap calls out as not worth scanning. */
const excluded = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "target",
  "coverage",
  ".turbo",
  ".cache",
]);

async function nodeWalk(root, { skipExcluded }) {
  let files = 0;
  let directories = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipExcluded && excluded.has(entry.name)) continue;
        directories += 1;
        stack.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        files += 1;
      }
    }
  }
  return { files, directories };
}

/**
 * Mirrors the two index variants in `apps/server/src/workspace/WorkspaceSearchIndex.ts`:
 * path-only for the file tree and pickers, content for on-demand content search.
 */
async function nativeIndex(root, { content }) {
  const created = FileFinder.create({
    basePath: root,
    disableMmapCache: true,
    disableContentIndexing: !content,
    aiMode: false,
    enableFsRootScanning: true,
    enableHomeDirScanning: true,
  });
  if (!created.ok) throw new Error(`FileFinder.create failed: ${created.error}`);
  const finder = created.value;
  const ready = await finder.waitForIndexReady(60_000);
  if (!ready.ok) throw new Error(`waitForIndexReady failed: ${ready.error}`);
  if (!ready.value) throw new Error("Native index did not become ready within 60 s.");
  return finder;
}

const scenarios = [
  {
    name: "node walk, exclusions applied",
    run: () => nodeWalk(target, { skipExcluded: true }),
  },
  {
    name: "node walk, no exclusions",
    run: () => nodeWalk(target, { skipExcluded: false }),
  },
  {
    name: "native index, path only",
    run: async () => {
      await nativeIndex(target, { content: false });
      return {};
    },
  },
  {
    name: "native index, with content",
    run: async () => {
      await nativeIndex(target, { content: true });
      return {};
    },
  },
];

const onlyArgument = process.argv.slice(2).find((value) => value.startsWith("--only="));

// Each scenario runs in its own process. Running them in one process let an
// exhaustive Node walk starve the native index of I/O badly enough that a scan
// which takes about 120 ms alone did not finish inside 60 seconds.
if (onlyArgument) {
  const name = onlyArgument.slice("--only=".length);
  const scenario = scenarios.find((candidate) => candidate.name === name);
  if (!scenario) throw new Error(`Unknown scenario: ${name}`);
  const startedAt = performance.now();
  const result = await scenario.run();
  process.stdout.write(
    `${JSON.stringify({ elapsedMs: performance.now() - startedAt, ...result })}\n`,
  );
  process.exit(0);
}

const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const runChild = promisify(execFile);
const selfPath = fileURLToPath(import.meta.url);

const samples = new Map(scenarios.map((scenario) => [scenario.name, []]));
const counts = {};

// Scenarios still alternate across iterations so ambient load cannot favour
// whichever one happened to run first.
for (let iteration = 0; iteration < repeat; iteration += 1) {
  const orderedScenarios = iteration % 2 === 0 ? scenarios : [...scenarios].reverse();
  for (const scenario of orderedScenarios) {
    const { stdout } = await runChild(
      process.execPath,
      [selfPath, `--path=${target}`, `--only=${scenario.name}`],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim().split("\n").at(-1));
    samples.get(scenario.name).push(parsed.elapsedMs);
    if (parsed.files !== undefined) {
      counts[scenario.name] = { files: parsed.files, directories: parsed.directories };
    }
  }
}

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const results = scenarios.map((scenario) => {
  const values = samples.get(scenario.name);
  const sorted = [...values].sort((left, right) => left - right);
  return {
    scenario: scenario.name,
    meanMs: mean(values),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    ...(counts[scenario.name] ?? {}),
  };
});

process.stdout.write(`${JSON.stringify({ target, repeat, results }, null, 2)}\n`);
