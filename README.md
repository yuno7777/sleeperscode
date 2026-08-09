<p align="center">
  <img src="./apps/web/public/sleepers-mark.svg" width="112" alt="Sleepers Code" />
</p>

<h1 align="center">Sleepers Code</h1>

<p align="center">
  <strong>A local-first command center for coding agents.</strong><br />
  One fast, inspectable workspace for Codex, Claude, Cursor, Grok, and OpenCode.
</p>

<p align="center">
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-818CF8?style=flat-square" /></a>
  <img alt="Windows first" src="https://img.shields.io/badge/platform-Windows%20first-111827?style=flat-square" />
  <img alt="Status alpha" src="https://img.shields.io/badge/status-alpha-A78BFA?style=flat-square" />
  <a href="https://github.com/pingdotgg/t3code"><img alt="Upstream compatible" src="https://img.shields.io/badge/upstream-T3%20Code-334155?style=flat-square" /></a>
</p>

Sleepers Code is an open-source fork of T3 Code evolving into an AI software-engineering
orchestrator: providers remain interchangeable, tools stay universal, execution is observable, and
the user remains in control. The React clients and proven Node paths stay intact while measured
runtime bottlenecks move behind small Rust components.

> [!IMPORTANT]
> Sleepers Code is under active alpha development. A Windows x64 NSIS installer now builds locally,
> but it has not completed clean-machine launch, upgrade, uninstall, or signing validation and is not
> a public release. Build from source for this fork; upstream `npx t3`, App Store, package-manager,
> and hosted-app links install T3 Code, not Sleepers Code.

## What works today

- **Five provider integrations** — Codex, Claude Code, Cursor, Grok Build, and OpenCode, using their
  structured SDK, app-server, or ACP transports.
- **Web, desktop, and mobile control surfaces** — the existing remote-ready T3 architecture remains
  compatible across local, LAN, tailnet, relay, and WSL environments.
- **Fast hybrid runtime** — a versioned Rust sidecar handles bounded processes and streaming ACP
  sessions while Node remains the safe default and fallback.
- **Durable work** — threads, checkpoints, diffs, restore flows, provider sessions, and project state
  survive normal restarts.
- **Provider discovery that respects the host** — Windows PATH repair, WinGet/npm/pnpm/user-local
  discovery, safe `.cmd` handling, WSL login-shell paths, and persisted overrides for every provider.
- **Usage visibility** — shared web/mobile dashboards aggregate Claude and Codex token and cost data.
- **Agent Hub discovery** — web, desktop, and mobile distinguish installed, integrated, and routable
  providers while reading the ACP catalog through the connected environment. Installation remains
  security-gated during alpha.
- **Measured decisions** — performance claims live beside their harnesses and limitations; slower
  replacements do not become defaults for architectural aesthetics.

## The direction

```text
User task
   |
   v
Task profile -----> budget and permission policy
   |                         |
   v                         v
Adaptive router -----> provider workers
   |                  Codex / Claude / Cursor / Grok / OpenCode / local
   v                         |
Tool broker <---------------+
   |        filesystem / Git / terminal / browser / MCP
   v
Verification -> checkpoint -> usage and outcome ledger
```

The adaptive router, secure agent installation, broader task-outcome analytics, Tauri migration, and
clean-machine release qualification are roadmap work—not finished features. See the
[canonical engineering tracker](./docs/sleepers-code-roadmap.md) for evidence and blockers rather
than aspirational checkmarks.

## Performance, without spin

All figures below are Windows x64 measurements from this repository's checked-in harnesses.

| Slice                         | Measured result                                                                                 | Product decision                                  |
| :---------------------------- | :---------------------------------------------------------------------------------------------- | :------------------------------------------------ |
| Startup provider probes       | Peak process-tree RSS fell from 1,161.8 MiB to 825.6 MiB in paired four-run bundle measurements | Provider health probes run one provider at a time |
| Session-scoped ACP sidecars   | Mean peak RSS fell 21.2%; mean elapsed time was 2.1% slower across overlapping ranges           | Rust stays opt-in; `auto` stays on Node           |
| Checkpoint capture, 15k files | Cached capture improved from 24.6 s to under one second with matching tree-oid tests            | Keep the project-scoped, HEAD-stamped cache       |

Read [performance results](./docs/performance-results.md) for commands, raw context, and known gaps.
Electron, a live client workload, authenticated provider prompts, and clean-machine installer behavior
are not yet fully measured.

## Run from source

### Requirements

- Git
- Node.js 24.13.1 or newer
- [Vite+](https://viteplus.dev/guide/)
- at least one installed and authenticated provider CLI
- Rust only when building or testing the optional native runtime

Install Vite+:

```powershell
# Windows PowerShell
irm https://vite.plus/ps1 | iex
```

```bash
# macOS or Linux
curl -fsSL https://vite.plus | bash
```

Clone and start an isolated development environment:

```bash
git clone https://github.com/yuno7777/sleeperscode.git
cd sleeperscode
vp i
vp run dev
```

The development runner prints the actual local URL and pairing token. Do not point development at a
live shared `~/.t3/userdata` directory.

Desktop development:

```bash
vp run dev:desktop
```

Focused production build:

```bash
vp run build:desktop
```

Windows x64 alpha installer build:

```powershell
vp run dist:desktop:win:x64
```

The release builder stages production dependencies, Rust helper binaries, Electron assets, the NSIS
installer, differential-update blockmap, and `SHA256SUMS.txt` into `release/`. A complete WSL-capable
local build also needs a Linux x64 `node-pty` prebuild passed through `--wsl-prebuild`; CI builds that
binary on Linux. An unsigned local artifact is for testing, not publication.

Useful native-runtime checks:

```bash
cargo fmt --check
cargo check --locked --workspace
cargo test --locked --workspace
```

## Provider setup

Install and authenticate providers independently; proprietary CLIs are not bundled by this project.

| Provider    | Default command | Integration |
| :---------- | :-------------- | :---------- |
| Codex       | `codex`         | app server  |
| Claude Code | `claude`        | vendor SDK  |
| Cursor      | `cursor-agent`  | ACP         |
| Grok Build  | `grok`          | ACP         |
| OpenCode    | `opencode`      | app server  |

Every provider accepts a command name or absolute **server-side** binary path in Settings. This is
deliberately not a browser file picker: remote and WSL environments must resolve files on the machine
that actually runs the agent. See [provider executable discovery](./docs/provider-path-discovery.md).

## Architecture

- `apps/server` — WebSocket server, event-sourced orchestration, providers, checkpoints
- `apps/web` — React/Vite client used by local web and desktop
- `apps/desktop` — Electron host, local/WSL backends, IPC, previews, packaging
- `apps/mobile` — React Native remote client
- `packages/contracts` — typed wire and settings schemas
- `packages/client-runtime` — shared web/mobile state and connection behavior
- `crates/runtime-sidecar` — optional Rust process and streaming runtime
- `native/resource-monitor` — process-tree resource telemetry

Start with the [internal architecture overview](./docs/internals/overview.md), then read
[`AGENTS.md`](./AGENTS.md) before changing behavior.

## Documentation

- [Install and first run](./docs/user/install.md)
- [Remote access](./docs/user/remote-access.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Source control integrations](./docs/user/source-control.md)
- [Agent Hub](./docs/user/agent-hub.md)
- [Sleepers Code roadmap](./docs/sleepers-code-roadmap.md)
- [Architecture decisions](./docs/decisions/)

## Upstream compatibility

Sleepers Code is derived from [pingdotgg/t3code](https://github.com/pingdotgg/t3code). Internal
package names, the `t3` CLI, URL schemes, app IDs, data-directory names, wire contracts, and hosted T3
endpoints remain unchanged where compatibility or user-data safety depends on them. Product-facing
surfaces use the Sleepers Code identity; upstream merges remain intentional and reviewable.

## License

[MIT](./LICENSE). The upstream copyright and license notice are preserved. Third-party provider CLIs
retain their own licenses and terms and are not redistributed here.

Before contributing, read [CONTRIBUTING.md](./CONTRIBUTING.md). Keep changes focused, measured, and
compatible with web, desktop, mobile, remote environments, and every affected provider.
