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
const backend = backendArgument?.slice("--backend=".length) ?? "node";
if (backend !== "node" && backend !== "rust") {
  throw new Error(`Unknown runtime backend: ${backend}. Expected node or rust.`);
}
const positionalArguments = argumentsList.filter((argument) => !argument.startsWith("--backend="));
if (positionalArguments.length > 1) {
  throw new Error("Expected at most one resource-monitor path.");
}
const monitorPath = path.resolve(positionalArguments[0] ?? defaultMonitorPath);
const levels = [1, 3, 5, 10];
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

async function measureLevel(concurrency) {
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
      `Concurrency ${concurrency} failed (${testSignal ?? testCode}): ${Buffer.concat(stderr).toString("utf8")}`,
    );
  }
  if (snapshots.length === 0) {
    throw new Error(`Concurrency ${concurrency} produced no resource snapshots.`);
  }

  const totals = snapshots.map((snapshot) => ({
    rssBytes: snapshot.processes.reduce((sum, process) => sum + process.residentBytes, 0),
    cpuPercent: snapshot.processes.reduce((sum, process) => sum + process.cpuPercent, 0),
    processCount: snapshot.processes.length,
  }));
  return {
    concurrency,
    elapsedMs,
    samples: snapshots.length,
    peakRssBytes: Math.max(...totals.map((sample) => sample.rssBytes)),
    peakCpuPercent: Math.max(...totals.map((sample) => sample.cpuPercent)),
    peakProcessCount: Math.max(...totals.map((sample) => sample.processCount)),
  };
}

const results = [];
for (const level of levels) {
  results.push(await measureLevel(level));
}

process.stdout.write(`${JSON.stringify({ backend, monitorPath, results }, null, 2)}\n`);
