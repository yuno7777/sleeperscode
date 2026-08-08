# Provider streaming validation

Captured on 2026-08-08 on Windows x64. This phase validates the existing provider boundaries before
any long-lived provider session is migrated to Rust.

## Deterministic matrix

Run:

```text
pnpm test:provider-streaming
```

The command runs the existing adapter and transport suites for Claude, Codex, Cursor, Grok,
OpenCode, and the shared ACP JSON-RPC runtime. The latest local run passed 207 tests across eight
files in 31.18 seconds. The suites use repository-owned mocks and do not read or store provider
credentials.

On Windows, Cursor and Grok mock sessions launch through `provider-mock-launcher.exe`. It preserves
stdin/stdout/stderr streaming and owns the mock Node process in a kill-on-close Job Object. Lifecycle
tests record the actual child PID and independently confirm it is gone after session shutdown; they
do not assume Unix `SIGTERM` behavior.

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
- Add explicit huge-stream/backpressure measurements before moving streaming ownership to Rust.
- Run 1/3/5/10 concurrent provider sessions with complete process-tree CPU and memory sampling.
- Repeat the matrix under the repository-required Node 24 toolchain.
