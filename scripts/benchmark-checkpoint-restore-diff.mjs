import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const run = (args, options) =>
  execFileAsync("git", args, { ...options, maxBuffer: 256 * 1024 * 1024 });

function numericArgument(name, fallback) {
  const argument = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  const parsed = Number(argument?.slice(name.length + 3) ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name}: ${argument}. Expected a positive number.`);
  }
  return parsed;
}

const repeat = numericArgument("repeat", 5);
const sizesArgument = process.argv.slice(2).find((value) => value.startsWith("--sizes="));
const sizes = (sizesArgument?.slice("--sizes=".length) ?? "1000,5000,15000").split(",").map(Number);
if (sizes.some((size) => !Number.isSafeInteger(size) || size <= 1)) {
  throw new Error("Invalid --sizes. Expected integers greater than one.");
}

const fileBody = Array.from(
  { length: 40 },
  (_, line) => `export const value${line} = ${line};`,
).join("\n");

const modulePath = (root, index) =>
  path.join(root, `pkg${Math.floor(index / 100)}`, `module${index}.ts`);

/**
 * Synthetic repositories only. Restore runs `git clean -fd`, so this benchmark
 * must never be pointed at a real checkout.
 */
async function makeRepository(fileCount) {
  const root = await mkdtemp(path.join(os.tmpdir(), `t3-checkpoint-restore-${fileCount}-`));
  for (let index = 0; index < fileCount; index += 1) {
    if (index % 100 === 0) {
      await mkdir(path.dirname(modulePath(root, index)), { recursive: true });
    }
    await writeFile(modulePath(root, index), fileBody, "utf8");
  }

  await run(["init", "--quiet"], { cwd: root });
  await run(["config", "user.email", "bench@example.invalid"], { cwd: root });
  await run(["config", "user.name", "bench"], { cwd: root });
  await run(["config", "core.autocrlf", "false"], { cwd: root });
  await run(["add", "-A"], { cwd: root });
  await run(["commit", "--quiet", "-m", "base"], { cwd: root });
  const { stdout: baseOidOutput } = await run(["rev-parse", "HEAD"], { cwd: root });
  const baseOid = baseOidOutput.trim();

  const modifiedFiles = Math.max(1, Math.floor(fileCount / 100));
  const stride = Math.max(1, Math.floor(fileCount / modifiedFiles));
  for (let index = 0; index < modifiedFiles; index += 1) {
    const fileIndex = Math.min(index * stride, fileCount - 2);
    await writeFile(modulePath(root, fileIndex), `${fileBody}\n// checkpoint ${index}\n`, "utf8");
  }
  const deletedPath = modulePath(root, fileCount - 1);
  await unlink(deletedPath);
  await run(["add", "-A"], { cwd: root });
  await run(["commit", "--quiet", "-m", "checkpoint"], { cwd: root });
  const { stdout: checkpointOidOutput } = await run(["rev-parse", "HEAD"], { cwd: root });
  const checkpointOid = checkpointOidOutput.trim();

  const baseRef = "refs/t3-benchmark/base";
  const checkpointRef = "refs/t3-benchmark/checkpoint";
  await run(["update-ref", baseRef, baseOid], { cwd: root });
  await run(["update-ref", checkpointRef, checkpointOid], { cwd: root });
  await run(["reset", "--hard", "--quiet", baseOid], { cwd: root });

  return {
    root,
    baseRef,
    checkpointRef,
    deletedPath,
    modifiedFiles,
    changedFiles: modifiedFiles + 1,
  };
}

async function timedRun(cwd, args) {
  const startedAt = performance.now();
  const result = await run(args, { cwd });
  return { durationMs: performance.now() - startedAt, result };
}

async function measureDiff(repository) {
  const { durationMs, result } = await timedRun(repository.root, [
    "diff",
    "--patch",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    `${repository.baseRef}^{commit}`,
    `${repository.checkpointRef}^{commit}`,
  ]);
  return { durationMs, outputBytes: Buffer.byteLength(result.stdout) };
}

async function dirtyForRestore(repository) {
  await writeFile(modulePath(repository.root, 0), `${fileBody}\n// later dirty state\n`, "utf8");
  await writeFile(repository.deletedPath, "recreated after checkpoint\n", "utf8");
  await writeFile(path.join(repository.root, "throwaway.txt"), "remove me\n", "utf8");
  await run(["add", "pkg0/module0.ts"], { cwd: repository.root });
}

/** Mirrors GitVcsDriver.checkpoints.restoreCheckpoint step for step. */
async function measureRestore(repository) {
  await dirtyForRestore(repository);
  const steps = {};

  const checkpoint = await timedRun(repository.root, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${repository.checkpointRef}^{commit}`,
  ]);
  steps["rev-parse checkpoint"] = checkpoint.durationMs;
  const checkpointOid = checkpoint.result.stdout.trim();

  steps["restore worktree and index"] = (
    await timedRun(repository.root, [
      "restore",
      "--source",
      checkpointOid,
      "--worktree",
      "--staged",
      "--",
      ".",
    ])
  ).durationMs;
  steps["clean untracked"] = (
    await timedRun(repository.root, ["clean", "-fd", "--", "."])
  ).durationMs;
  steps["rev-parse HEAD"] = (
    await timedRun(repository.root, ["rev-parse", "--verify", "HEAD"])
  ).durationMs;
  steps["reset index"] = (
    await timedRun(repository.root, ["reset", "--quiet", "--", "."])
  ).durationMs;

  const totalMs = Object.values(steps).reduce((total, value) => total + value, 0);
  const [{ stdout: staged }, { stdout: changed }, { stdout: untracked }] = await Promise.all([
    run(["diff", "--cached", "--name-only"], { cwd: repository.root }),
    run(["diff", "--name-only"], { cwd: repository.root }),
    run(["ls-files", "--others", "--exclude-standard"], { cwd: repository.root }),
  ]);
  const changedCount = changed.trim().split("\n").filter(Boolean).length;
  if (staged.trim() || untracked.trim() || changedCount !== repository.changedFiles) {
    throw new Error(
      `Restore verification failed: staged=${JSON.stringify(staged.trim())}, ` +
        `untracked=${JSON.stringify(untracked.trim())}, changed=${changedCount}.`,
    );
  }

  return { totalMs, steps };
}

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};
const summary = (values) => ({
  meanMs: mean(values),
  medianMs: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
});

const results = [];
for (const size of sizes) {
  const repository = await makeRepository(size);
  try {
    await measureDiff(repository);
    await measureRestore(repository);

    const diffRuns = [];
    const restoreRuns = [];
    for (let iteration = 0; iteration < repeat; iteration += 1) {
      if (iteration % 2 === 0) {
        diffRuns.push(await measureDiff(repository));
        restoreRuns.push(await measureRestore(repository));
      } else {
        restoreRuns.push(await measureRestore(repository));
        diffRuns.push(await measureDiff(repository));
      }
    }

    const stepNames = Object.keys(restoreRuns[0].steps);
    results.push({
      files: size,
      changedFiles: repository.changedFiles,
      diff: {
        ...summary(diffRuns.map((run) => run.durationMs)),
        outputBytes: diffRuns[0].outputBytes,
      },
      restore: {
        ...summary(restoreRuns.map((run) => run.totalMs)),
        steps: Object.fromEntries(
          stepNames.map((step) => [
            step,
            { meanMs: mean(restoreRuns.map((run) => run.steps[step])) },
          ]),
        ),
      },
    });
  } finally {
    await rm(repository.root, { recursive: true, force: true }).catch(() => undefined);
  }
}

process.stdout.write(`${JSON.stringify({ repeat, results }, null, 2)}\n`);
