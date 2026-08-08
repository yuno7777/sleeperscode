// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const repositoryRoot = NodePath.resolve(__dirname, "../../../../../");
const defaultWindowsLauncherPath = NodePath.join(
  repositoryRoot,
  "target",
  "debug",
  "provider-mock-launcher.exe",
);

let windowsLauncherBuild: Promise<string> | undefined;

async function fileExists(path: string): Promise<boolean> {
  try {
    await NodeFSP.access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureWindowsLauncher(): Promise<string> {
  const configured = process.env.T3_PROVIDER_MOCK_LAUNCHER_PATH;
  const launcherPath = configured ? NodePath.resolve(configured) : defaultWindowsLauncherPath;
  if (await fileExists(launcherPath)) return launcherPath;
  if (configured) {
    throw new Error(`Configured provider mock launcher does not exist: ${launcherPath}`);
  }

  windowsLauncherBuild ??= new Promise<string>((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "cargo",
      ["build", "--locked", "-p", "t3-runtime-sidecar", "--bin", "provider-mock-launcher"],
      {
        cwd: repositoryRoot,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(launcherPath);
      else
        reject(new Error(`provider mock launcher build failed (${signal ?? code ?? "unknown"})`));
    });
  });
  return windowsLauncherBuild;
}

export async function makeProviderMockLauncher(input: {
  readonly prefix: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly initialDelayMs?: number;
  readonly argvLogPath?: string;
  readonly childPidLogPath?: string;
}): Promise<string> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), input.prefix));
  if (process.platform === "win32") {
    const source = await ensureWindowsLauncher();
    const launcher = NodePath.join(directory, "provider-mock-launcher.exe");
    await NodeFSP.copyFile(source, launcher);
    await NodeFSP.writeFile(
      NodePath.join(directory, "provider-mock-launcher.json"),
      `${JSON.stringify({
        command: input.command,
        args: input.args,
        env: input.env ?? {},
        initialDelayMs: input.initialDelayMs ?? 0,
        ...(input.argvLogPath ? { argvLogPath: input.argvLogPath } : {}),
        ...(input.childPidLogPath ? { childPidLogPath: input.childPidLogPath } : {}),
      })}\n`,
      "utf8",
    );
    return launcher;
  }

  const launcher = NodePath.join(directory, "provider-mock-launcher.sh");
  const envExports = Object.entries(input.env ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const argvLog = input.argvLogPath
    ? `printf '%s\\t' "$@" >> ${JSON.stringify(input.argvLogPath)}\nprintf '\\n' >> ${JSON.stringify(input.argvLogPath)}`
    : "";
  const delay = input.initialDelayMs
    ? `sleep ${JSON.stringify(String(input.initialDelayMs / 1000))}`
    : "";
  await NodeFSP.writeFile(
    launcher,
    `#!/bin/sh
${envExports}
${argvLog}
${delay}
exec ${JSON.stringify(input.command)} ${input.args.map((arg) => JSON.stringify(arg)).join(" ")} "$@"
`,
    "utf8",
  );
  await NodeFSP.chmod(launcher, 0o755);
  return launcher;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForLoggedChildPids(
  path: string,
  expected: number,
  attempts = 200,
): Promise<ReadonlyArray<number>> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const raw = await NodeFSP.readFile(path, "utf8").catch(() => "");
    const pids = raw
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
    if (pids.length >= expected) return pids;
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${expected} provider child PIDs at ${path}`);
}

export async function waitForChildProcessesToExit(
  pids: ReadonlyArray<number>,
  attempts = 200,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (pids.every((pid) => !isProcessAlive(pid))) return;
    await delay(10);
  }
  throw new Error(`Provider child processes remained alive: ${pids.join(", ")}`);
}
