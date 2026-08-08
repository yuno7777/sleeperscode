import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Loaded from apps/server, which owns the dependency. Its exports map is
// import-only, so the entry point comes from the manifest.
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

/** Mirrors WORKSPACE_INDEX_SCAN_TIMEOUT_MS in WorkspaceSearchIndex.ts. */
const PRODUCTION_TIMEOUT_MS = 15_000;
const MEASUREMENT_TIMEOUT_MS = 180_000;

function numericArgument(name, fallback) {
  const argument = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  const parsed = Number(argument?.slice(name.length + 3) ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name}: ${argument}. Expected a positive number.`);
  }
  return parsed;
}

const repeat = numericArgument("repeat", 3);
const sizesArgument = process.argv.slice(2).find((value) => value.startsWith("--sizes="));
const sizes = (sizesArgument?.slice("--sizes=".length) ?? "1000,5000,15000,30000")
  .split(",")
  .map(Number);
if (sizes.some((size) => !Number.isSafeInteger(size) || size <= 0)) {
  throw new Error("Invalid --sizes. Expected positive integers.");
}

/**
 * A synthetic source tree of `fileCount` text files spread over directories, so
 * index time can be related to file count rather than to one repository.
 */
async function makeSyntheticRepository(fileCount) {
  const root = await mkdtemp(path.join(os.tmpdir(), `t3-content-${fileCount}-`));
  const perDirectory = 100;
  const body = Array.from(
    { length: 40 },
    (_, line) => `export const value${line} = "searchable token ${line}";`,
  ).join("\n");
  for (let index = 0; index < fileCount; index += 1) {
    const directory = path.join(root, `pkg${Math.floor(index / perDirectory)}`);
    if (index % perDirectory === 0) await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `module${index}.ts`), body, "utf8");
  }
  return root;
}

async function measureContentIndex(root) {
  const created = FileFinder.create({
    basePath: root,
    disableMmapCache: true,
    disableContentIndexing: false,
    aiMode: false,
    enableFsRootScanning: true,
    enableHomeDirScanning: true,
  });
  if (!created.ok) throw new Error(`FileFinder.create failed: ${created.error}`);
  const finder = created.value;
  const startedAt = performance.now();
  const ready = await finder.waitForIndexReady(MEASUREMENT_TIMEOUT_MS);
  const elapsedMs = performance.now() - startedAt;
  try {
    finder.destroy();
  } catch {}
  if (!ready.ok) throw new Error(`waitForIndexReady failed: ${ready.error}`);
  return { elapsedMs, ready: ready.value === true };
}

const onlyArgument = process.argv.slice(2).find((value) => value.startsWith("--only="));
if (onlyArgument) {
  // Child mode: one measurement per process, so a previous index cannot compete
  // for I/O with the one being timed.
  const target = onlyArgument.slice("--only=".length);
  process.stdout.write(`${JSON.stringify(await measureContentIndex(target))}\n`);
  process.exit(0);
}

const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const runChild = promisify(execFile);
const selfPath = fileURLToPath(import.meta.url);

const targets = [];
for (const size of sizes) {
  targets.push({
    label: `${size.toLocaleString()} synthetic files`,
    path: await makeSyntheticRepository(size),
  });
}
targets.push({ label: "this monorepo", path: repositoryRoot });

const samples = new Map(targets.map((target) => [target.label, []]));
try {
  for (let iteration = 0; iteration < repeat; iteration += 1) {
    for (const target of targets) {
      const { stdout } = await runChild(process.execPath, [selfPath, `--only=${target.path}`], {
        maxBuffer: 16 * 1024 * 1024,
      });
      samples.get(target.label).push(JSON.parse(stdout.trim().split("\n").at(-1)));
    }
  }
} finally {
  for (const target of targets) {
    if (target.path !== repositoryRoot) {
      await rm(target.path, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const results = targets.map((target) => {
  const values = samples.get(target.label).map((entry) => entry.elapsedMs);
  const sorted = [...values].sort((left, right) => left - right);
  return {
    target: target.label,
    meanMs: mean(values),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    // The first measurement of each target is the coldest one available without
    // dropping the OS cache, which is not something a benchmark should do.
    firstMs: values[0],
    exceedsProductionTimeout: sorted[sorted.length - 1] > PRODUCTION_TIMEOUT_MS,
  };
});

process.stdout.write(
  `${JSON.stringify({ repeat, productionTimeoutMs: PRODUCTION_TIMEOUT_MS, results }, null, 2)}\n`,
);
