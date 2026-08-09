import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
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
const bundledEntry = path.join(repositoryRoot, "apps", "server", "dist", "bin.mjs");
const sourceEntry = path.join(repositoryRoot, "apps", "server", "src", "bin.ts");
const readinessPath = "/.well-known/t3/environment";

function numericArgument(name, fallback) {
  const argument = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  const parsed = Number(argument?.slice(name.length + 3) ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name}: ${argument}. Expected a positive number.`);
  }
  return parsed;
}

const backendArgument = process.argv.slice(2).find((value) => value.startsWith("--backend="));
// Startup time drifts with ambient machine load by more than the difference
// between backends, so a comma-separated list is measured interleaved rather
// than as two separate invocations.
const backends = (backendArgument?.slice("--backend=".length) ?? "node").split(",");
for (const candidate of backends) {
  if (candidate !== "node" && candidate !== "rust") {
    throw new Error(`Unknown runtime backend: ${candidate}. Expected node or rust.`);
  }
}
const entryArgument = process.argv.slice(2).find((value) => value.startsWith("--entry="));
const entryKinds = (entryArgument?.slice("--entry=".length) ?? "bundle").split(",");
for (const candidate of entryKinds) {
  if (candidate !== "bundle" && candidate !== "source") {
    throw new Error(`Unknown entry: ${candidate}. Expected bundle or source.`);
  }
}
const entryPath = (kind) => (kind === "bundle" ? bundledEntry : sourceEntry);
// Every backend and entry combination is one variant, and all variants alternate
// within an iteration so ambient load cannot favour one of them.
const variants = backends.flatMap((backend) =>
  entryKinds.map((entryKind) => ({ backend, entryKind, key: `${backend}/${entryKind}` })),
);
const repeat = numericArgument("repeat", 3);
const idleSeconds = numericArgument("idle-seconds", 10);
const sampleIntervalMs = numericArgument("sample-interval-ms", 250);
const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
if (positional.length > 1) {
  throw new Error("Expected at most one resource-monitor path.");
}
const monitorPath = path.resolve(positional[0] ?? defaultMonitorPath);

await access(monitorPath).catch(() => {
  throw new Error(
    `Resource monitor not found at ${monitorPath}. Run pnpm build:resource-monitor first.`,
  );
});
for (const kind of entryKinds) {
  await access(entryPath(kind)).catch(() => {
    throw new Error(
      `Server entry not found at ${entryPath(kind)}. Run pnpm build:desktop first, or pass ` +
        `--entry=source to measure the unbundled TypeScript path.`,
    );
  });
}

/** Reserves an ephemeral port and releases it so the server can bind it. */
async function reservePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  probe.close();
  await once(probe, "close");
  return port;
}

async function waitUntilServing(url, deadlineMs) {
  const startedAt = performance.now();
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      // Any answer proves the HTTP listener is up; the route may require pairing.
      if (response.status < 500) {
        await response.arrayBuffer().catch(() => undefined);
        return performance.now() - startedAt;
      }
    } catch {}
    if (performance.now() - startedAt > deadlineMs) {
      throw new Error(`Server did not answer ${url} within ${deadlineMs} ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function writeCommand(child, command) {
  child.stdin.write(`${JSON.stringify(command)}\n`);
}

async function sampleIdle(rootPid, seconds) {
  const monitor = spawn(monitorPath, [], {
    cwd: repositoryRoot,
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const snapshots = [];
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
    rootPid,
    sampleIntervalMs,
    externalProcesses: [],
  });
  writeCommand(monitor, { version: 2, type: "setStreaming", enabled: true });
  await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
  writeCommand(monitor, { version: 2, type: "shutdown" });
  await once(monitor, "exit");
  lines.close();

  if (snapshots.length === 0) {
    throw new Error("Idle sampling produced no resource snapshots.");
  }
  const totals = snapshots.map((snapshot) => ({
    rssBytes: snapshot.processes.reduce((sum, entry) => sum + entry.residentBytes, 0),
    cpuPercent: snapshot.processes.reduce((sum, entry) => sum + entry.cpuPercent, 0),
    processCount: snapshot.processes.length,
  }));
  // The startup transient is far above the settled figure, so keep the breakdown
  // of whichever sample produced the peak.
  const peakIndex = totals.reduce(
    (best, sample, index) => (sample.rssBytes > totals[best].rssBytes ? index : best),
    0,
  );
  const peakBreakdown = [...snapshots[peakIndex].processes]
    .sort((left, right) => right.residentBytes - left.residentBytes)
    .slice(0, 5)
    .map((entry) => ({
      pid: entry.pid,
      name: entry.name,
      residentBytes: entry.residentBytes,
      command: entry.command.slice(0, 160),
    }));
  const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
  // Answering HTTP is not the same as being settled, so report the tail of the
  // window separately from the whole window.
  const tail = totals.slice(Math.floor(totals.length / 2));
  return {
    samples: snapshots.length,
    meanRssBytes: mean(totals.map((sample) => sample.rssBytes)),
    peakRssBytes: Math.max(...totals.map((sample) => sample.rssBytes)),
    meanCpuPercent: mean(totals.map((sample) => sample.cpuPercent)),
    peakCpuPercent: Math.max(...totals.map((sample) => sample.cpuPercent)),
    tailMeanRssBytes: mean(tail.map((sample) => sample.rssBytes)),
    tailMeanCpuPercent: mean(tail.map((sample) => sample.cpuPercent)),
    peakProcessCount: Math.max(...totals.map((sample) => sample.processCount)),
    peakBreakdown,
  };
}

/**
 * One server lifecycle. `baseDir` is reused across runs to separate a cold first
 * start on an empty state directory from later warm starts.
 */
async function measureRun(baseDir, variant) {
  const port = await reservePort();
  const stderr = [];
  const startedAt = performance.now();
  const server = spawn(
    process.execPath,
    [entryPath(variant.entryKind), "--port", String(port), "--base-dir", baseDir, "--no-browser"],
    {
      cwd: repositoryRoot,
      env: { ...process.env, T3CODE_RUNTIME_BACKEND: variant.backend },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  server.stderr.on("data", (chunk) => stderr.push(chunk));
  let exited = false;
  server.once("exit", () => {
    exited = true;
  });

  try {
    await waitUntilServing(`http://127.0.0.1:${port}${readinessPath}`, 60_000);
    const spawnToServeMs = performance.now() - startedAt;
    const idle = await sampleIdle(server.pid, idleSeconds);
    return { port, spawnToServeMs, idle };
  } catch (error) {
    throw new Error(`${error.message}\n${Buffer.concat(stderr).toString("utf8")}`);
  } finally {
    // Only ever the PID captured at spawn.
    if (!exited) {
      const shutdownAt = performance.now();
      server.kill();
      await once(server, "exit");
      process.stderr.write(`shutdown took ${(performance.now() - shutdownAt).toFixed(1)} ms\n`);
    }
  }
}

const baseDirs = new Map();
for (const variant of variants) {
  baseDirs.set(
    variant.key,
    await mkdtemp(path.join(os.tmpdir(), `t3-startup-${variant.backend}-`)),
  );
}
const runs = [];
try {
  for (let iteration = 1; iteration <= repeat; iteration += 1) {
    const orderedVariants = iteration % 2 === 1 ? variants : [...variants].reverse();
    for (const variant of orderedVariants) {
      runs.push({
        iteration,
        backend: variant.backend,
        entryKind: variant.entryKind,
        state: iteration === 1 ? "cold" : "warm",
        ...(await measureRun(baseDirs.get(variant.key), variant)),
      });
    }
  }
} finally {
  for (const directory of baseDirs.values()) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const summary = variants.map((variant) => {
  const samples = runs.filter(
    (run) => run.backend === variant.backend && run.entryKind === variant.entryKind,
  );
  const warm = samples.filter((run) => run.state === "warm");
  return {
    backend: variant.backend,
    entryKind: variant.entryKind,
    coldSpawnToServeMs: samples[0].spawnToServeMs,
    warmRuns: warm.length,
    meanWarmSpawnToServeMs: warm.length > 0 ? mean(warm.map((run) => run.spawnToServeMs)) : null,
    meanIdleRssBytes: mean(samples.map((run) => run.idle.meanRssBytes)),
    peakIdleRssBytes: Math.max(...samples.map((run) => run.idle.peakRssBytes)),
    meanIdleCpuPercent: mean(samples.map((run) => run.idle.meanCpuPercent)),
    meanSettledRssBytes: mean(samples.map((run) => run.idle.tailMeanRssBytes)),
    meanSettledCpuPercent: mean(samples.map((run) => run.idle.tailMeanCpuPercent)),
    maximumProcessCount: Math.max(...samples.map((run) => run.idle.peakProcessCount)),
  };
});

process.stdout.write(
  `${JSON.stringify(
    { backends, entryKinds, repeat, idleSeconds, monitorPath, runs, summary },
    null,
    2,
  )}\n`,
);
