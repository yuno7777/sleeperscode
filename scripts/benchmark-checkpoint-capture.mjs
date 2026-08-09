import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

/**
 * Staging thousands of files on Windows emits a line-ending warning per file, so
 * every invocation needs a generous buffer even though the output is discarded.
 */
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
if (sizes.some((size) => !Number.isSafeInteger(size) || size <= 0)) {
  throw new Error("Invalid --sizes. Expected positive integers.");
}

/**
 * Synthetic repositories only. The capture sequence writes tree and commit objects
 * and a ref, so pointing it at a real repository would leave objects behind in it.
 */
async function makeRepository(fileCount) {
  const root = await mkdtemp(path.join(os.tmpdir(), `t3-checkpoint-${fileCount}-`));
  const body = Array.from({ length: 40 }, (_, line) => `export const v${line} = ${line};`).join(
    "\n",
  );
  for (let index = 0; index < fileCount; index += 1) {
    const directory = path.join(root, `pkg${Math.floor(index / 100)}`);
    if (index % 100 === 0) await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `module${index}.ts`), body, "utf8");
  }
  await run(["init", "--quiet"], { cwd: root });
  await run(["config", "user.email", "bench@example.invalid"], { cwd: root });
  await run(["config", "user.name", "bench"], { cwd: root });
  // Keeps Windows line-ending conversion out of the measurement.
  await run(["config", "core.autocrlf", "false"], { cwd: root });
  await run(["add", "-A"], { cwd: root });
  await run(["commit", "--quiet", "-m", "base"], { cwd: root });
  // A dirty worktree is the realistic case: a checkpoint runs after an agent turn.
  await writeFile(path.join(root, "pkg0", "module0.ts"), `${body}\n// touched\n`, "utf8");
  return root;
}

async function timed(cwd, args, env) {
  const startedAt = performance.now();
  await run(args, { cwd, env });
  return performance.now() - startedAt;
}

/**
 * Mirrors GitVcsDriver.checkpoints.captureCheckpoint step for step.
 *
 * `indexPath` and `skipReadTree` isolate the cost of seeding and reusing an
 * index. The production implementation can then be compared with the variant
 * that matches its current strategy.
 */
async function captureCheckpoint(root, { indexPath, skipReadTree = false } = {}) {
  const checkpointRef = `refs/t3-benchmark/${randomUUID()}`;
  const tempIndex = indexPath ?? path.join(root, ".git", `t3-checkpoint-index-${randomUUID()}`);
  const env = {
    ...process.env,
    GIT_INDEX_FILE: tempIndex,
    GIT_AUTHOR_NAME: "T3 Code",
    GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
    GIT_COMMITTER_NAME: "T3 Code",
    GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
  };

  const steps = {};
  steps["rev-parse --git-common-dir"] = await timed(root, ["rev-parse", "--git-common-dir"], env);
  steps["rev-parse --verify HEAD"] = await timed(root, ["rev-parse", "--verify", "HEAD"], env);
  steps["read-tree HEAD"] = skipReadTree ? 0 : await timed(root, ["read-tree", "HEAD"], env);
  steps["add -A -- ."] = await timed(root, ["add", "-A", "--", "."], env);

  const startedWriteTree = performance.now();
  const { stdout: treeOid } = await run(["write-tree"], { cwd: root, env });
  steps["write-tree"] = performance.now() - startedWriteTree;

  const startedCommitTree = performance.now();
  const { stdout: commitOid } = await run(
    ["commit-tree", treeOid.trim(), "-m", "t3 checkpoint benchmark"],
    { cwd: root, env },
  );
  steps["commit-tree"] = performance.now() - startedCommitTree;

  steps["update-ref"] = await timed(root, ["update-ref", checkpointRef, commitOid.trim()], env);

  await run(["update-ref", "-d", checkpointRef], { cwd: root }).catch(() => undefined);
  if (!indexPath) await rm(tempIndex, { force: true }).catch(() => undefined);
  return steps;
}

const stepOrder = [
  "rev-parse --git-common-dir",
  "rev-parse --verify HEAD",
  "read-tree HEAD",
  "add -A -- .",
  "write-tree",
  "commit-tree",
  "update-ref",
];

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const results = [];

for (const size of sizes) {
  const root = await makeRepository(size);
  const variants = [
    { name: "fresh index, read-tree", launches: 7, options: () => ({}) },
    {
      name: "reused index, read-tree each time",
      launches: 7,
      indexPath: path.join(root, ".git", "t3-checkpoint-index-read-tree"),
      options() {
        return { indexPath: this.indexPath };
      },
    },
    {
      name: "reused index, no read-tree",
      launches: 6,
      indexPath: path.join(root, ".git", "t3-checkpoint-index-no-read-tree"),
      options(iteration) {
        return { indexPath: this.indexPath, skipReadTree: iteration > 0 };
      },
    },
  ];
  try {
    const runsByVariant = new Map(variants.map((variant) => [variant.name, []]));
    for (const variant of variants) {
      if (variant.indexPath) await rm(variant.indexPath, { force: true }).catch(() => undefined);
      // One warmup so first-touch costs are not counted, and so the reused-index
      // variants have an index to reuse.
      await captureCheckpoint(root, variant.options(0));
    }
    for (let iteration = 0; iteration < repeat; iteration += 1) {
      const ordered = iteration % 2 === 0 ? variants : [...variants].reverse();
      for (const variant of ordered) {
        runsByVariant
          .get(variant.name)
          .push(await captureCheckpoint(root, variant.options(iteration + 1)));
      }
    }
    for (const variant of variants) {
      const runs = runsByVariant.get(variant.name);
      const steps = stepOrder.map((step) => ({
        step,
        meanMs: mean(runs.map((entry) => entry[step])),
      }));
      results.push({
        files: size,
        variant: variant.name,
        launches: variant.launches,
        steps,
        totalMeanMs: steps.reduce((total, entry) => total + entry.meanMs, 0),
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

process.stdout.write(`${JSON.stringify({ repeat, results }, null, 2)}\n`);
