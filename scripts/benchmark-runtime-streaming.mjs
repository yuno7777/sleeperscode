import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = 2;
const MAX_CHUNK_BYTES = 64 * 1024;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const defaultSidecarPath = path.join(
  repositoryRoot,
  "target",
  "release",
  `t3-runtime-sidecar${executableSuffix}`,
);
const defaultFixturePath = path.join(
  repositoryRoot,
  "target",
  "release",
  `runtime-fixture${executableSuffix}`,
);
const argumentsList = process.argv.slice(2);

function readOption(name, fallback) {
  const prefix = `--${name}=`;
  return (
    argumentsList.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback
  );
}

function readPositiveInteger(name, fallback) {
  const value = Number(readOption(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${name}: ${value}. Expected a positive integer.`);
  }
  return value;
}

const levels = readOption("levels", "1,3,5,10").split(",").map(Number);
if (
  levels.length === 0 ||
  levels.some(
    (level, index) => !Number.isSafeInteger(level) || level < 1 || levels.indexOf(level) !== index,
  )
) {
  throw new Error("Invalid levels. Expected unique, positive integers separated by commas.");
}
const repeat = readPositiveInteger("repeat", 3);
const payloadBytes = readPositiveInteger("payload-bytes", 32 * 1024);
const sidecarPath = path.resolve(readOption("sidecar", defaultSidecarPath));
const fixturePath = path.resolve(readOption("fixture", defaultFixturePath));

await Promise.all([
  access(sidecarPath).catch(() => {
    throw new Error(`Runtime sidecar not found at ${sidecarPath}. Run pnpm build:runtime-sidecar.`);
  }),
  access(fixturePath).catch(() => {
    throw new Error(`Runtime fixture not found at ${fixturePath}. Run pnpm build:runtime-sidecar.`);
  }),
]);

class RuntimeSidecar {
  constructor(executable) {
    this.child = spawn(executable, [], {
      cwd: repositoryRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.controls = new Map();
    this.sessions = new Map();
    this.stderr = [];
    this.child.stderr.on("data", (chunk) => this.stderr.push(chunk));
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.lines.on("line", (line) => this.onLine(line));
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      if (!this.closing) {
        this.fail(
          new Error(
            `Runtime sidecar exited early (${signal ?? code}): ${Buffer.concat(this.stderr).toString("utf8")}`,
          ),
        );
      }
    });
  }

  onLine(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      this.fail(new Error(`Runtime sidecar emitted invalid JSON: ${line}`, { cause: error }));
      return;
    }
    if (event.type === "hello") {
      this.resolveReady(event);
      return;
    }
    if (event.type === "controlAccepted") {
      const control = this.controls.get(event.requestId);
      if (control) {
        this.controls.delete(event.requestId);
        control.resolve();
      }
      return;
    }
    const session = this.sessions.get(event.requestId);
    if (event.type === "processStarted" && session) {
      session.resolveStarted();
    } else if (event.type === "processOutput" && session) {
      if (event.stream !== "stdout") {
        session.reject(new Error(`Session ${event.requestId} emitted unexpected stderr output.`));
        return;
      }
      session.output.push(Buffer.from(event.dataBase64, "base64"));
    } else if (event.type === "processExited" && session) {
      this.sessions.delete(event.requestId);
      if (event.exitCode === 0 && !event.stopped)
        session.resolveExited(Buffer.concat(session.output));
      else session.reject(new Error(`Session ${event.requestId} exited with ${event.exitCode}.`));
    } else if (event.type === "error") {
      const pendingControl = event.requestId && this.controls.get(event.requestId);
      const pendingSession = event.requestId && this.sessions.get(event.requestId);
      const error = new Error(`${event.code}: ${event.message}`);
      if (pendingControl) {
        this.controls.delete(event.requestId);
        pendingControl.reject(error);
      }
      if (pendingSession) {
        this.sessions.delete(event.requestId);
        pendingSession.reject(error);
      }
    }
  }

  fail(error) {
    this.rejectReady(error);
    for (const control of this.controls.values()) control.reject(error);
    for (const session of this.sessions.values()) session.reject(error);
    this.controls.clear();
    this.sessions.clear();
  }

  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  waitForControl(message) {
    return new Promise((resolve, reject) => {
      this.controls.set(message.requestId, { resolve, reject });
      this.send(message);
    });
  }

  async runEcho(sessionId, payload) {
    let resolveStarted;
    let resolveExited;
    let reject;
    const started = new Promise((resolve, rejectStarted) => {
      resolveStarted = resolve;
      reject = rejectStarted;
    });
    const exited = new Promise((resolve, rejectExited) => {
      resolveExited = resolve;
      const previousReject = reject;
      reject = (error) => {
        previousReject(error);
        rejectExited(error);
      };
    });
    this.sessions.set(sessionId, { output: [], resolveStarted, resolveExited, reject });
    this.send({
      version: PROTOCOL_VERSION,
      type: "start",
      requestId: sessionId,
      command: fixturePath,
      args: ["--echo-stdin"],
      cwd: repositoryRoot,
      env: null,
    });
    await started;
    for (let offset = 0, chunkIndex = 0; offset < payload.length; chunkIndex += 1) {
      const chunk = payload.subarray(offset, offset + MAX_CHUNK_BYTES);
      offset += chunk.length;
      await this.waitForControl({
        version: PROTOCOL_VERSION,
        type: "write",
        requestId: `${sessionId}-write-${chunkIndex}`,
        sessionId,
        dataBase64: chunk.toString("base64"),
      });
    }
    await this.waitForControl({
      version: PROTOCOL_VERSION,
      type: "closeStdin",
      requestId: `${sessionId}-close`,
      sessionId,
    });
    const output = await exited;
    if (!output.equals(payload)) {
      throw new Error(
        `Session ${sessionId} returned ${output.length} of ${payload.length} exact bytes.`,
      );
    }
  }

  async close() {
    this.closing = true;
    this.send({ version: PROTOCOL_VERSION, type: "shutdown" });
    this.child.stdin.end();
    const [code, signal] = await once(this.child, "exit");
    this.lines.close();
    if (code !== 0 || signal) {
      throw new Error(`Runtime sidecar shutdown failed (${signal ?? code}).`);
    }
  }
}

async function measure(mode, concurrency, iteration, payload) {
  const sidecars = Array.from(
    { length: mode === "shared" ? 1 : concurrency },
    () => new RuntimeSidecar(sidecarPath),
  );
  try {
    await Promise.all(sidecars.map((sidecar) => sidecar.ready));
    await Promise.all(
      sidecars.map((sidecar, index) =>
        sidecar.runEcho(`${mode}-${concurrency}-${iteration}-warmup-${index}`, payload),
      ),
    );
    const startedAt = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        sidecars[mode === "shared" ? 0 : index].runEcho(
          `${mode}-${concurrency}-${iteration}-${index}`,
          payload,
        ),
      ),
    );
    return performance.now() - startedAt;
  } finally {
    await Promise.all(sidecars.map((sidecar) => sidecar.close()));
  }
}

const payload = Buffer.alloc(payloadBytes);
for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
const results = [];
for (let iteration = 1; iteration <= repeat; iteration += 1) {
  for (const concurrency of levels) {
    const modes = iteration % 2 === 0 ? ["dedicated", "shared"] : ["shared", "dedicated"];
    for (const mode of modes) {
      results.push({
        mode,
        concurrency,
        iteration,
        elapsedMs: await measure(mode, concurrency, iteration, payload),
      });
    }
  }
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const summary = levels.flatMap((concurrency) =>
  ["shared", "dedicated"].map((mode) => {
    const samples = results.filter(
      (result) => result.mode === mode && result.concurrency === concurrency,
    );
    return {
      mode,
      concurrency,
      repetitions: samples.length,
      meanElapsedMs: mean(samples.map((sample) => sample.elapsedMs)),
      minimumElapsedMs: Math.min(...samples.map((sample) => sample.elapsedMs)),
      maximumElapsedMs: Math.max(...samples.map((sample) => sample.elapsedMs)),
    };
  }),
);

process.stdout.write(
  `${JSON.stringify(
    {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      sidecarPath,
      fixturePath,
      levels,
      repeat,
      payloadBytes,
      methodology:
        "One exact echo warmup per sidecar; shared sidecar versus one sidecar per concurrent session; alternating mode order.",
      results,
      summary,
    },
    null,
    2,
  )}\n`,
);
