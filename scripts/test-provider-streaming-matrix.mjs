import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitePlus = path.join(repositoryRoot, "node_modules", "vite-plus", "dist", "bin.js");

const matrix = {
  claude: ["apps/server/src/provider/Layers/ClaudeAdapter.test.ts"],
  codex: [
    "apps/server/src/provider/Layers/CodexAdapter.test.ts",
    "apps/server/src/provider/Layers/CodexSessionRuntime.test.ts",
  ],
  cursor: [
    "apps/server/src/provider/Layers/CursorAdapter.test.ts",
    "apps/server/src/provider/acp/AcpJsonRpcConnection.test.ts",
  ],
  grok: [
    "apps/server/src/provider/Layers/GrokAdapter.test.ts",
    "apps/server/src/provider/acp/AcpJsonRpcConnection.test.ts",
  ],
  opencode: [
    "apps/server/src/provider/Layers/OpenCodeAdapter.test.ts",
    "apps/server/src/provider/opencodeRuntime.cliParsers.test.ts",
  ],
};

const requested = process.argv.slice(2);
if (requested.includes("--list")) {
  for (const [provider, files] of Object.entries(matrix)) {
    process.stdout.write(`${provider}: ${files.join(", ")}\n`);
  }
  process.exit(0);
}

const providers = requested.length === 0 ? Object.keys(matrix) : requested;
const unknown = providers.filter((provider) => !(provider in matrix));
if (unknown.length > 0) {
  process.stderr.write(
    `Unknown provider selection: ${unknown.join(", ")}. Expected one of: ${Object.keys(matrix).join(", ")}.\n`,
  );
  process.exit(2);
}

const files = [...new Set(providers.flatMap((provider) => matrix[provider]))];
const child = spawn(process.execPath, [vitePlus, "test", "run", ...files, "--reporter=dot"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", (error) => {
  process.stderr.write(`Provider streaming matrix failed to start: ${error.message}\n`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Provider streaming matrix terminated by ${signal}.\n`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
