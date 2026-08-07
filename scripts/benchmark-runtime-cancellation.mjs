import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";

if (process.platform !== "win32") {
  throw new Error("the process-tree cancellation benchmark currently requires Windows");
}

const executableSuffix = ".exe";
const sidecarPath = resolve(
  process.argv[2] ?? `target/release/t3-runtime-sidecar${executableSuffix}`,
);
const fixturePath = resolve(process.argv[3] ?? `target/release/runtime-fixture${executableSuffix}`);
const iterations = Number.parseInt(process.argv[4] ?? "20", 10);
if (!Number.isSafeInteger(iterations) || iterations < 1) {
  throw new Error("iterations must be a positive integer");
}

const percentile = (sorted, value) => sorted[Math.ceil(sorted.length * value) - 1];
const summarize = (samples) => {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: samples.length,
    meanMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    medianMs: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    p95Ms: percentile(sorted, 0.95),
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    rawMs: samples,
  };
};

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const processIsAlive = (processId) => {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
};

const waitForPids = async (pidFile) => {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const raw = await readFile(pidFile, "utf8").catch(() => "");
    const processIds = raw.split(/\r?\n/u).filter(Boolean).map(Number);
    if (processIds.length >= 3) return processIds;
    await sleep(5);
  }
  throw new Error(`fixture tree did not become ready: ${pidFile}`);
};

const waitForExit = async (processIds) => {
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    if (processIds.every((processId) => !processIsAlive(processId))) return;
    await sleep(5);
  }
  throw new Error(`descendants survived cancellation: ${processIds.join(", ")}`);
};

const temporaryDirectory = await mkdtemp(join(tmpdir(), "sleepers-cancellation-benchmark-"));
const sidecar = spawn(sidecarPath, [], {
  cwd: dirname(sidecarPath),
  stdio: ["pipe", "pipe", "inherit"],
  windowsHide: true,
});
const lines = createInterface({ input: sidecar.stdout });
const requests = new Map();
let helloResolve;
let helloReject;
const hello = new Promise((resolveHello, rejectHello) => {
  helloResolve = resolveHello;
  helloReject = rejectHello;
});

lines.on("line", (line) => {
  const event = JSON.parse(line);
  if (event.type === "hello") {
    helloResolve(event);
    return;
  }
  const request = requests.get(event.requestId);
  if (!request) return;
  if (event.type === "processStarted") request.started(event);
  if (event.type === "processCompleted") {
    requests.delete(event.requestId);
    request.completed(event);
  }
  if (event.type === "error") {
    requests.delete(event.requestId);
    request.failed(new Error(`${event.code}: ${event.message}`));
  }
});
sidecar.once("error", helloReject);

const write = (message) => sidecar.stdin.write(`${JSON.stringify(message)}\n`);

const runSample = async (requestId) => {
  const pidFile = join(temporaryDirectory, `${requestId}.txt`);
  let startedResolve;
  let completedResolve;
  let failedReject;
  const started = new Promise((resolveStarted) => {
    startedResolve = resolveStarted;
  });
  const completed = new Promise((resolveCompleted, rejectCompleted) => {
    completedResolve = resolveCompleted;
    failedReject = rejectCompleted;
  });
  requests.set(requestId, {
    started: startedResolve,
    completed: completedResolve,
    failed: failedReject,
  });
  write({
    version: 1,
    type: "run",
    requestId,
    command: fixturePath,
    args: ["--tree-depth", "2", "--pid-file", pidFile],
    cwd: null,
    env: null,
    stdin: null,
    timeoutMs: 30_000,
    maxOutputBytes: 4096,
    outputMode: "error",
    truncatedMarker: "",
  });
  await started;
  const processIds = await waitForPids(pidFile);
  const cancellationStarted = performance.now();
  write({ version: 1, type: "cancel", requestId });
  const result = await completed;
  if (!result.cancelled) throw new Error(`request ${requestId} was not cancelled`);
  await waitForExit(processIds);
  return performance.now() - cancellationStarted;
};

try {
  await hello;
  for (let index = 0; index < 3; index += 1) {
    await runSample(`warmup-${index}`);
  }
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    samples.push(await runSample(`measured-${index}`));
  }
  console.log(
    JSON.stringify(
      {
        sidecar: basename(sidecarPath),
        fixture: basename(fixturePath),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        methodology:
          "3 warmups; cancel a ready parent-child-grandchild tree through one warm release sidecar",
        cancellation: summarize(samples),
      },
      null,
      2,
    ),
  );
} finally {
  write({ version: 1, type: "shutdown" });
  sidecar.stdin.end();
  await new Promise((resolveExit) => sidecar.once("exit", resolveExit));
  await rm(temporaryDirectory, { recursive: true, force: true });
}
