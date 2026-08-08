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

Cursor and Grok now construct one lazy native client per active ACP session. A raw exact-byte probe
showed that sharing one sidecar delayed the final process start, while session-scoped sidecars kept
10 concurrent launches near the dedicated-sidecar bound. In the production-shaped five-run sample,
session-scoped Rust reduced the maximum observed process count from 34 on Node to 24 and reduced
mean peak tree RSS by 21.8%; mean elapsed time was 3.3% worse instead of the shared sidecar's 42.3%
regression. See `performance-results.md`; the remaining throughput, packaging, and application gates
keep native provider transport opt-in.

Two earlier ad hoc Node probes with higher event counts did not complete inside a 60-second budget.
That result is not reproduced by the committed paired regressions: Node and Rust now both pass 64 x
16 KiB and 512 x 2 KiB, preserving all 1 MiB and every ordered delta. All four cases completed in
3.66 seconds of test time. The Rust-only focused durations were 0.98 and 1.08 seconds. The ACP event
queue is now bounded at 256 events; the 512-delta cases prove both transports can apply and release
backpressure beyond that capacity. The cause of the earlier ad hoc timeout is unknown.

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
- Measure queue occupancy and process-tree memory under repeated high-event and slow-consumer runs;
  the fixed capacity is a bound, not evidence that 256 is the optimal value.
- Repeat 1/3/5/10 process-tree sampling with real provider fixtures and multiple runs per level.
