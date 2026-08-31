import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const run = NodeUtil.promisify(NodeChildProcess.execFile);
const repositoryRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);

function numericArgument(name, fallback) {
  const argument = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  const parsed = Number(argument?.slice(name.length + 3) ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name}: ${argument}. Expected a positive number.`);
  }
  return parsed;
}

const repeat = numericArgument("repeat", 20);
const warmups = numericArgument("warmups", 3);
const reposArgument = process.argv.slice(2).find((value) => value.startsWith("--repos="));

/**
 * Operations taken from the real call sites in `apps/server/src/vcs/GitVcsDriverCore.ts`.
 * `version` is not a repository operation: it is the process-launch floor, so
 * every other row can be split into launch cost and Git's own work.
 */
const operations = [
  { name: "version (launch floor)", args: ["--version"] },
  { name: "rev-parse --git-common-dir", args: ["rev-parse", "--git-common-dir"] },
  { name: "rev-parse --abbrev-ref HEAD", args: ["rev-parse", "--abbrev-ref", "HEAD"] },
  { name: "status --porcelain=2 --branch", args: ["status", "--porcelain=2", "--branch"] },
  { name: "diff HEAD --numstat", args: ["diff", "HEAD", "--numstat"] },
  { name: "remote", args: ["remote"] },
];

/** A small repository with one commit, so repository size can be varied. */
async function makeSmallRepository() {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-git-bench-"));
  await run("git", ["init", "--quiet"], { cwd: directory });
  await run("git", ["config", "user.email", "bench@example.invalid"], { cwd: directory });
  await run("git", ["config", "user.name", "bench"], { cwd: directory });
  await NodeFSP.writeFile(NodePath.join(directory, "README.md"), "benchmark fixture\n", "utf8");
  await run("git", ["add", "."], { cwd: directory });
  await run("git", ["commit", "--quiet", "-m", "fixture"], { cwd: directory });
  return directory;
}

async function timeOnce(cwd, args) {
  const startedAt = performance.now();
  await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return performance.now() - startedAt;
}

async function resolveMetadataLegacy(cwd) {
  const commonDir = await run("git", ["rev-parse", "--git-common-dir"], { cwd });
  const [worktreeRoot, branch] = await Promise.all([
    run("git", ["rev-parse", "--show-toplevel"], { cwd }),
    run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd }),
  ]);
  return {
    commonDir: commonDir.stdout.trim(),
    worktreeRoot: worktreeRoot.stdout.trim(),
    branch: branch.stdout.trim(),
  };
}

async function resolveMetadataCoalesced(cwd) {
  const result = await run(
    "git",
    ["rev-parse", "--git-common-dir", "--git-dir", "--show-toplevel"],
    { cwd },
  );
  const [commonDir, gitDir, worktreeRoot, ...unexpected] = result.stdout
    .trimEnd()
    .split(/\r?\n/g)
    .map((value) => value.trim());
  if (unexpected.length > 0 || !commonDir || !gitDir || !worktreeRoot) {
    throw new Error("Coalesced Git metadata output was not the expected three lines.");
  }
  const head = (await NodeFSP.readFile(NodePath.resolve(cwd, gitDir, "HEAD"), "utf8")).trim();
  const branchPrefix = "ref: refs/heads/";
  if (!head.startsWith(branchPrefix)) {
    throw new Error("Benchmark repositories must have a symbolic branch HEAD.");
  }
  return {
    commonDir,
    worktreeRoot,
    branch: head.slice(branchPrefix.length),
  };
}

async function timeMetadata(cwd, resolver) {
  const startedAt = performance.now();
  const metadata = await resolver(cwd);
  return { elapsedMs: performance.now() - startedAt, metadata };
}

function statistics(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return {
    count: sorted.length,
    meanMs: samples.reduce((total, value) => total + value, 0) / samples.length,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

const smallRepository = await makeSmallRepository();
const repositories = reposArgument
  ? reposArgument
      .slice("--repos=".length)
      .split(",")
      .map((value) => ({ label: value, path: NodePath.resolve(value) }))
  : [
      { label: "this monorepo", path: repositoryRoot },
      { label: "single-commit fixture", path: smallRepository },
    ];

const samples = new Map();
const key = (repository, operation) => `${repository.label}\0${operation.name}`;
const measurements = repositories.flatMap((repository) =>
  operations.map((operation) => ({ repository, operation })),
);
const metadataSamples = new Map(
  repositories.map((repository) => [repository.label, { legacy: [], coalesced: [] }]),
);
for (const repository of repositories) {
  for (const operation of operations) {
    samples.set(key(repository, operation), []);
    for (let index = 0; index < warmups; index += 1) {
      await timeOnce(repository.path, operation.args);
    }
  }
  for (let index = 0; index < warmups; index += 1) {
    const legacy = await resolveMetadataLegacy(repository.path);
    const coalesced = await resolveMetadataCoalesced(repository.path);
    if (JSON.stringify(legacy) !== JSON.stringify(coalesced)) {
      throw new Error(`Git metadata resolvers disagreed for ${repository.label}.`);
    }
  }
}

// Every repository and operation pair alternates within an iteration so ambient
// load cannot favour whichever one happened to run first.
try {
  for (let iteration = 0; iteration < repeat; iteration += 1) {
    const ordered = iteration % 2 === 0 ? measurements : measurements.toReversed();
    for (const { repository, operation } of ordered) {
      samples.get(key(repository, operation)).push(await timeOnce(repository.path, operation.args));
    }
    for (const repository of repositories) {
      const repositorySamples = metadataSamples.get(repository.label);
      const orderedResolvers =
        iteration % 2 === 0
          ? [
              ["legacy", resolveMetadataLegacy],
              ["coalesced", resolveMetadataCoalesced],
            ]
          : [
              ["coalesced", resolveMetadataCoalesced],
              ["legacy", resolveMetadataLegacy],
            ];
      for (const [label, resolver] of orderedResolvers) {
        const result = await timeMetadata(repository.path, resolver);
        repositorySamples[label].push(result.elapsedMs);
      }
    }
  }
} finally {
  await NodeFSP.rm(smallRepository, { recursive: true, force: true }).catch(() => undefined);
}

const results = repositories.flatMap((repository) => {
  const floor = statistics(samples.get(key(repository, operations[0]))).meanMs;
  return operations.map((operation) => {
    const stats = statistics(samples.get(key(repository, operation)));
    return {
      repository: repository.label,
      operation: operation.name,
      ...stats,
      // What is left after the launch floor is Git's own work on the repository.
      repositoryWorkMs: Math.max(0, stats.meanMs - floor),
      launchSharePercent: stats.meanMs > 0 ? Math.min(100, (floor / stats.meanMs) * 100) : 0,
    };
  });
});
const metadataResolution = repositories.map((repository) => {
  const repositorySamples = metadataSamples.get(repository.label);
  const legacy = statistics(repositorySamples.legacy);
  const coalesced = statistics(repositorySamples.coalesced);
  return {
    repository: repository.label,
    legacy,
    coalesced,
    meanImprovementPercent:
      legacy.meanMs > 0 ? Math.max(0, (1 - coalesced.meanMs / legacy.meanMs) * 100) : 0,
  };
});

process.stdout.write(
  `${JSON.stringify(
    {
      repeat,
      warmups,
      repositories: repositories.map((entry) => entry.label),
      results,
      metadataResolution,
    },
    null,
    2,
  )}\n`,
);
