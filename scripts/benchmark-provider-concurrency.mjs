import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executableName =
  process.platform === "win32" ? "t3-resource-monitor.exe" : "t3-resource-monitor";
const defaultMonitorPath = path.join(
  repositoryRoot,
  "native",
  "resource-monitor",
  "target",
  "release",
  executableName,
);
const argumentsList = process.argv.slice(2);
const backendArgument = argumentsList.find((argument) => argument.startsWith("--backend="));
// Ambient machine load moves these timings by more than the backends differ, so a
// comma-separated list alternates them inside one invocation instead of relying on
// two separate runs being comparable.
const backends = (backendArgument?.slice("--backend=".length) ?? "node").split(",");
for (const candidate of backends) {
  if (candidate !== "node" && candidate !== "rust") {
    throw new Error(`Unknown runtime backend: ${candidate}. Expected node or rust.`);
  }
}
const repeatArgument = argumentsList.find((argument) => argument.startsWith("--repeat="));
const repeat = Number(repeatArgument?.slice("--repeat=".length) ?? "1");
if (!Number.isSafeInteger(repeat) || repeat < 1) {
  throw new Error(`Invalid repeat count: ${repeat}. Expected a positive integer.`);
}
const supportedLevels = [1, 3, 5, 10];
const levelsArgument = argumentsList.find((argument) => argument.startsWith("--levels="));
const levels = (levelsArgument?.slice("--levels=".length) ?? supportedLevels.join(","))
  .split(",")
  .map(Number);
if (
  levels.length === 0 ||
  levels.some((level, index) => !supportedLevels.includes(level) || levels.indexOf(level) !== index)
) {
  throw new Error(`Invalid concurrency levels. Expected unique values from ${supportedLevels}.`);
}
const positionalArguments = argumentsList.filter(
  (argument) =>
    !argument.startsWith("--backend=") &&
    !argument.startsWith("--repeat=") &&
    !argument.startsWith("--levels="),
);
if (positionalArguments.length > 1) {
  throw new Error("Expected at most one resource-monitor path.");
}
const monitorPath = path.resolve(positionalArguments[0] ?? defaultMonitorPath);
const vitePlus = path.join(repositoryRoot, "node_modules", "vite-plus", "dist", "bin.js");
const stressTest = "apps/server/src/provider/acp/ProviderStreamingStress.test.ts";

await access(monitorPath).catch(() => {
  throw new Error(
    `Resource monitor not found at ${monitorPath}. Run pnpm build:resource-monitor first.`,
  );
});

function writeCommand(child, command) {
  child.stdin.write(`${JSON.stringify(command)}\n`);
}

async function measureLevel(concurrency, backend) {
  const test = spawn(
    process.execPath,
    [
      vitePlus,
      "test",
      "run",
      stressTest,
      "-t",
      `runs ${concurrency} isolated ACP session`,
      "--reporter=dot",
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        T3CODE_RUNTIME_BACKEND: backend,
      },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  const monitor = spawn(monitorPath, [], {
    cwd: repositoryRoot,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const snapshots = [];
  const stderr = [];
  test.stderr.on("data", (chunk) => stderr.push(chunk));
  const lines = readline.createInterface({ input: monitor.stdout });
  lines.on("line", (line) => {
    try {
      const event = JSON.parse(line);
      if (event.type === "snapshot") snapshots.push(event);
    } catch {}
  });

  writeCommand(monitor, {
    version: 2,
    type: "configure",
    rootPid: test.pid,
    sampleIntervalMs: 250,
    externalProcesses: [],
  });
  writeCommand(monitor, { version: 2, type: "setStreaming", enabled: true });
  const startedAt = performance.now();
  const [testCode, testSignal] = await once(test, "exit");
  const elapsedMs = performance.now() - startedAt;
  writeCommand(monitor, { version: 2, type: "shutdown" });
  await once(monitor, "exit");
  lines.close();

  if (testCode !== 0 || testSignal) {
    throw new Error(
      `Concurrency ${concurrency} on ${backend} failed (${testSignal ?? testCode}): ${Buffer.concat(stderr).toString("utf8")}`,
    );
  }
  if (snapshots.length === 0) {
    throw new Error(`Concurrency ${concurrency} on ${backend} produced no resource snapshots.`);
  }

  const totals = snapshots.map((snapshot) => ({
    rssBytes: snapshot.processes.reduce((sum, process) => sum + process.residentBytes, 0),
    cpuPercent: snapshot.processes.reduce((sum, process) => sum + process.cpuPercent, 0),
    processCount: snapshot.processes.length,
  }));
  return {
    concurrency,
    backend,
    elapsedMs,
    samples: snapshots.length,
    peakRssBytes: Math.max(...totals.map((sample) => sample.rssBytes)),
    peakCpuPercent: Math.max(...totals.map((sample) => sample.cpuPercent)),
    peakProcessCount: Math.max(...totals.map((sample) => sample.processCount)),
  };
}

const results = [];
for (let iteration = 1; iteration <= repeat; iteration += 1) {
  for (const level of levels) {
    const orderedBackends = iteration % 2 === 1 ? backends : [...backends].reverse();
    for (const backend of orderedBackends) {
      results.push({ iteration, ...(await measureLevel(level, backend)) });
    }
  }
}

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const summary = levels.flatMap((concurrency) =>
  backends.map((backend) => {
    const samples = results.filter(
      (result) => result.concurrency === concurrency && result.backend === backend,
    );
    return {
      concurrency,
      backend,
      repetitions: samples.length,
      meanElapsedMs: mean(samples.map((sample) => sample.elapsedMs)),
      meanPeakRssBytes: mean(samples.map((sample) => sample.peakRssBytes)),
      maximumPeakRssBytes: Math.max(...samples.map((sample) => sample.peakRssBytes)),
      meanPeakCpuPercent: mean(samples.map((sample) => sample.peakCpuPercent)),
      maximumProcessCount: Math.max(...samples.map((sample) => sample.peakProcessCount)),
    };
  }),
);

process.stdout.write(
  `${JSON.stringify({ backends, repeat, monitorPath, results, summary }, null, 2)}\n`,
);
