# Source build and verification

This runbook is for contributors building Sleepers Code from a clean checkout. It records the
supported toolchain, safe local-state boundary, focused verification commands, and the difference
between a source build and a qualified release.

## Prerequisites

- Git
- Node.js 24 (the exact supported range is in the root `package.json`)
- [Vite+](https://github.com/voidzero-dev/vite-plus), installed as `vp`
- Rust and Cargo only when changing or building native helpers
- Platform toolchains required by Electron or React Native for the surface being changed

Install Vite+ using its official instructions. On Windows, a contributor can use the published
PowerShell installer; macOS and Linux use the published shell installer. Do not copy install commands
from untrusted mirrors.

## Clean checkout

```bash
git clone https://github.com/yuno7777/sleeperscode.git
cd sleeperscode
vp i
vp run audit:open-source
```

`vp i` uses the committed lockfile and workspace policy. Investigate any unexpected manifest or lock
change before continuing.

## Development state

```bash
vp run dev
```

The development runner prints the actual URL and pairing information. Repository worktrees default to
their own ignored `.t3` directory. Never start a development server against writable state belonging
to a live installation. Copy test data into the worktree when realistic fixtures are required.

## Focused verification

Use checks proportional to the change:

```bash
vp test run path/to/changed.test.ts
vp lint path/to/changed.ts --report-unused-disable-directives
tsgo --noEmit -p path/to/affected/tsconfig.json
```

Native changes normally add:

```bash
cargo fmt --check
cargo check --locked --workspace
cargo test --locked --workspace
```

Do not replace focused evidence with an unreviewed wall of repository-wide output. CI owns the broad
matrix; contributors should identify the exact affected packages, tests, and surfaces.

## Production source build

```bash
vp run build:desktop
```

This builds the server, web client, and Electron desktop sources. It does not prove a release is safe
to publish. Windows packaging, WSL native inputs, signing, clean-machine launch, upgrade, and uninstall
have separate gates documented in [release operations](./release.md) and the
[Windows portable guide](../user/portable-windows.md).

## Current verification record

On 2026-08-15, the supported bundled Node 24 runtime completed the production web/server build from
`main`. The refreshed Windows x64 portable artifact was independently hashed, matched
`SHA256SUMS.txt`, opened a responsive Electron window, and served HTTP 200 on its loopback server.
Clean-machine independence, signing, upgrade, uninstall, and every live provider remain explicitly
unverified until their dedicated gates run.

The measured artifact and runtime evidence lives in [performance results](../performance-results.md)
and the canonical [engineering roadmap](../sleepers-code-roadmap.md).
