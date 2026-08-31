<p align="center">
  <img src="./apps/web/public/sleepers-mark.svg" width="112" alt="Sleepers Code" />
</p>

<h1 align="center">Sleepers Code</h1>

<p align="center">
  A local-first workspace for running and managing coding agents.
</p>

<p align="center">
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-818CF8?style=flat-square" /></a>
  <img alt="Windows x64" src="https://img.shields.io/badge/platform-Windows%20x64-111827?style=flat-square" />
  <img alt="Alpha" src="https://img.shields.io/badge/status-alpha-A78BFA?style=flat-square" />
</p>

Sleepers Code is an open-source fork of [T3 Code](https://github.com/pingdotgg/t3code). It gives you
one place to run coding agents on your own machine, follow their work, return to earlier threads, and
connect from another device when you need to.

## Get started

The Windows x64 alpha build is available on the [releases page](https://github.com/yuno7777/sleeperscode/releases).

| File                                    | Use it when                                                           |
| :-------------------------------------- | :-------------------------------------------------------------------- |
| `Sleepers-Code-0.0.32-x64.exe`          | You want the normal Windows installer.                                |
| `Sleepers-Code-0.0.32-x64-portable.exe` | You want a portable build that keeps its state beside the executable. |

The builds are unsigned alpha software, so Windows SmartScreen may ask for confirmation. Verify a
download with the included `SHA256SUMS.txt` file. Clean-machine installation, upgrades, and uninstall
flows still need broader testing.

## What it does

- Runs Codex, Claude Code, Cursor, Grok Build, OpenCode, and Antigravity through their own CLIs.
- Keeps projects, threads, checkpoints, diffs, and provider sessions available after a restart.
- Works from the web app, Electron desktop app, and mobile client.
- Supports local connections and the existing remote, relay, tailnet, and WSL workflows.
- Shows provider availability and usage where a provider exposes trustworthy local data.
- Discovers local coding models through Ollama, LM Studio, or one OpenAI-compatible local endpoint.
- Includes optional Rust helpers for process handling and resource telemetry, with the established Node
  path retained as the safe fallback.

Each provider remains independent. Install and sign in to the provider CLIs you want to use. Sleepers
Code does not bundle proprietary provider software or subscriptions.

## Run from source

You need Git, Node.js 24.13.1 or newer, [Vite+](https://viteplus.dev/guide/), and at least one signed-in
provider CLI.

```bash
git clone https://github.com/yuno7777/sleeperscode.git
cd sleeperscode
vp i
vp run dev
```

The development runner prints a local URL and pairing URL. Opening the local URL on the same machine
does not require a session key. Remote clients still use pairing.

For desktop development:

```bash
vp run dev:desktop
```

For a focused desktop build:

```bash
vp run build:desktop
```

## Providers

| Provider    | Default command |
| :---------- | :-------------- |
| Codex       | `codex`         |
| Claude Code | `claude`        |
| Cursor      | `cursor-agent`  |
| Grok Build  | `grok`          |
| OpenCode    | `opencode`      |
| Antigravity | `agy`           |

You can set a command name or an absolute server-side path for each provider in Settings. For local
models and provider-specific setup, start with the [provider guide](./docs/provider-path-discovery.md).

## How it fits together

```text
You
  |
  v
Sleepers Code client
  |
  v
Local server and provider adapters
  |
  +--> coding-agent CLIs
  +--> Git, files, terminal, browser, MCP
  |
  v
Threads, checkpoints, usage, and connected clients
```

## Documentation

- [Attention queue](./docs/user/attention.md)

- [Install and first run](./docs/user/install.md)
- [Portable Windows build](./docs/user/portable-windows.md)
- [Remote access](./docs/user/remote-access.md)
- [Provider executable discovery](./docs/provider-path-discovery.md)
- [Antigravity provider](./docs/user/providers-antigravity.md)
- [Local coding models](./docs/user/local-models.md)
- [Architecture overview](./docs/internals/overview.md)
- [Sleepers Code roadmap](./docs/sleepers-code-roadmap.md)

## Compatibility and license

Sleepers Code keeps internal IDs, commands, data paths, and wire contracts compatible with T3 Code
where that protects existing data and remote workflows. Product-facing screens use the Sleepers Code
identity.

Licensed under [MIT](./LICENSE). The upstream notice is preserved in [NOTICE.md](./NOTICE.md).
