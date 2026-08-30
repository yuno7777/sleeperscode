// @effect-diagnostics nodeBuiltinImport:off - standalone dev launcher needs child process spawning.
/* oxlint-disable t3code/no-global-process-runtime -- Standalone dev launcher uses Node's process APIs. */
import * as NodeChildProcess from "node:child_process";

export function serverDevArgs(platform = process.platform): ReadonlyArray<string> {
  // ponytail: Windows runs a stable non-watching server; add a polling watcher only when it is needed.
  return platform === "win32" ? ["src/bin.ts"] : ["--watch", "src/bin.ts"];
}

if (import.meta.main) {
  const child = NodeChildProcess.spawn(process.execPath, serverDevArgs(), { stdio: "inherit" });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
