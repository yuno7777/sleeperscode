import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

const iterations = Number.parseInt(process.argv[3] ?? "20", 10);
const executableName =
  process.platform === "win32" ? "t3-runtime-sidecar.exe" : "t3-runtime-sidecar";
const sidecarPath = resolve(process.argv[2] ?? `target/release/${executableName}`);

if (!Number.isSafeInteger(iterations) || iterations < 1) {
  throw new Error("iterations must be a positive integer");
}
if (!existsSync(sidecarPath)) {
  throw new Error(`runtime sidecar not found at ${sidecarPath}; run pnpm build:runtime-sidecar`);
}

const summarize = (samples) => {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return {
    count: samples.length,
    meanMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    medianMs: median,
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    rawMs: samples,
  };
};

const runDirect = () =>
  new Promise((resolveRun, rejectRun) => {
    const startedAt = performance.now();
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore", windowsHide: true });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code !== 0) rejectRun(new Error(`direct child exited with ${code}`));
      else resolveRun(performance.now() - startedAt);
    });
  });

const sidecar = spawn(sidecarPath, [], {
  stdio: ["pipe", "pipe", "inherit"],
  windowsHide: true,
});
const lines = createInterface({ input: sidecar.stdout });
const pending = new Map();
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
  if (event.type !== "processCompleted" && event.type !== "error") return;
  const request = pending.get(event.requestId);
  if (!request) return;
  pending.delete(event.requestId);
  if (event.type === "error") request.reject(new Error(`${event.code}: ${event.message}`));
  else if (event.exitCode !== 0)
    request.reject(new Error(`sidecar child exited with ${event.exitCode}`));
  else request.resolve(performance.now() - request.startedAt);
});
sidecar.once("error", helloReject);
sidecar.once("exit", (code) => {
  const error = new Error(`runtime sidecar exited early with ${code}`);
  helloReject(error);
  for (const request of pending.values()) request.reject(error);
  pending.clear();
});

const runViaSidecar = (requestId) =>
  new Promise((resolveRun, rejectRun) => {
    pending.set(requestId, {
      resolve: resolveRun,
      reject: rejectRun,
      startedAt: performance.now(),
    });
    sidecar.stdin.write(
      `${JSON.stringify({
        version: 1,
        type: "run",
        requestId,
        command: process.execPath,
        args: ["-e", ""],
        cwd: null,
        env: null,
        stdin: null,
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
        outputMode: "error",
        truncatedMarker: "",
      })}\n`,
    );
  });

try {
  await hello;
  for (let index = 0; index < 3; index += 1) {
    await runDirect();
    await runViaSidecar(`warmup-${index}`);
  }

  const direct = [];
  const hybrid = [];
  for (let index = 0; index < iterations; index += 1) {
    direct.push(await runDirect());
    hybrid.push(await runViaSidecar(`measured-${index}`));
  }

  console.log(
    JSON.stringify(
      {
        sidecarPath,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        methodology: "3 warmups, alternating sequential Node no-op child launches",
        direct: summarize(direct),
        hybridWarmSidecar: summarize(hybrid),
      },
      null,
      2,
    ),
  );
} finally {
  sidecar.stdin.write(`${JSON.stringify({ version: 1, type: "shutdown" })}\n`);
  sidecar.stdin.end();
}
