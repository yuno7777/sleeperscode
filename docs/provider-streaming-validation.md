# Provider streaming validation

Captured on 2026-08-08 on Windows x64. This phase validates the provider boundary on both the
existing Node transport and the opt-in Rust streaming transport.

## Deterministic matrix

Run:

```text
pnpm test:provider-streaming
pnpm test:provider-streaming -- --backend=rust cursor grok
```

The command runs the existing adapter and transport suites for Claude, Codex, Cursor, Grok,
OpenCode, and the shared ACP JSON-RPC runtime. The latest local run passed 212 tests across nine
files in 34.44 seconds under Node 24.14.0. The Rust-selected Cursor/Grok slice passed 59 tests across
four files in 32.39 seconds. The suites use repository-owned mocks and do not read or store provider
credentials.

`--backend=node` and `--backend=rust` make transport selection explicit. Rust currently changes the
shared ACP subprocess transport used by Cursor and Grok; Claude, Codex, and OpenCode retain their
existing provider-specific transports.

On Windows, Cursor and Grok mock sessions launch through `provider-mock-launcher.exe`. It preserves
stdin/stdout/stderr streaming and owns the mock Node process in a kill-on-close Job Object. Lifecycle
tests record the actual child PID and independently confirm it is gone after session shutdown; they
do not assume Unix `SIGTERM` behavior.

## High-volume stream probe

A deterministic 1 MiB response sent as 16 ordered 64 KiB content deltas completed losslessly on both
Node and Rust. With Rust forced for the entire focused ACP file, all 17 lifecycle tests passed in
19.55 seconds. The native 1/3/5/10 concurrent-session matrix also passed all four cases in 8.08
seconds.

Two earlier equal-byte Node probes with higher event counts did not complete inside the existing
60-second test budget: 64 x 16 KiB and 512 x 2 KiB. With the native transport's bounded sidecar
output, per-session input, and TypeScript output queues, both shapes now pass as focused Rust-path
regressions. Their focused test durations were 0.98 and 1.08 seconds respectively; both preserved all
1 MiB and every ordered delta. The ACP event queue itself remains unbounded.

## Locally discovered CLIs

Read-only version probes found:

| Provider    | Local command  | Version                     | Live prompt validation |
| ----------- | -------------- | --------------------------- | ---------------------- |
| Claude Code | `claude.cmd`   | 2.1.209                     | **NOT RUN**            |
| Codex       | `codex.cmd`    | `codex-cli 0.146.0`         | **NOT RUN**            |
| OpenCode    | `opencode.cmd` | 1.17.11                     | **NOT RUN**            |
| Cursor      | Not found      | **NOT INSTALLED / ON PATH** | **NOT RUN**            |
| Grok        | Not found      | **NOT INSTALLED / ON PATH** | **NOT RUN**            |

No authenticated provider call was made. The local versions are an environment snapshot, not a
supported-version claim.

## Remaining gates

- Exercise authenticated launch, authentication failure, and provider-specific crash behavior in a
  disposable account or sanctioned fixture environment.
- Diagnose the Node-path high-event-rate stalls and decide whether the ACP event queue also needs a
  bounded receipt-driven contract before expanding Rust beyond opt-in sessions.
- Repeat 1/3/5/10 process-tree sampling with real provider fixtures and multiple runs per level.
