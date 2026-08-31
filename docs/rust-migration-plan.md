# Rust migration plan

## Constraints

- Preserve web, desktop, and mobile clients and the remote-hosting WebSocket architecture.
- Keep provider and orchestration semantics in TypeScript until differential tests prove parity.
- Add Rust behind a narrow adapter and retain the Node implementation as the default fallback.
- Support Windows paths, executable shims, process trees, Unicode, and spaces in paths first.
- Do not claim resource or latency improvements until a repeatable benchmark measures them.

## Ranked candidates

| Rank | Candidate                                   | Expected benefit                                                          | Risk                                                   | Decision                             |
| ---: | ------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ |
|    1 | Finite process execution and supervision    | High: bounded output, cancellation, cleanup, concurrent Git/tool commands | Low-medium behind fallback                             | Start now                            |
|    2 | Long-lived provider process supervision     | High: fewer orphan processes and clearer backpressure                     | High: streaming protocol and provider lifecycle parity | Follow after phase 1                 |
|    3 | Git status/diff hot paths                   | Medium-high on large repositories                                         | Medium-high compatibility risk                         | Benchmark after process runtime      |
|    4 | Checkpoint Git plumbing                     | Medium: background work and cancellation                                  | High restore-semantics risk                            | Port only with differential fixtures |
|    5 | Filesystem watcher and bulk file operations | Medium                                                                    | Medium; search is already native                       | Profile before work                  |
|    6 | SQLite persistence                          | Unknown                                                                   | Very high schema/event compatibility risk              | Defer                                |
|    7 | Tauri shell                                 | Potentially high package/RAM reduction                                    | Very high multi-surface and feature-parity risk        | Defer until gap closure              |

## Incremental phases

### Phase 0: baseline and audit

- Record the upstream commit, host, toolchain, repeatable commands, and missing measurements.
- Map the execution path and Electron APIs.

### Phase 1: workspace, protocol, and finite process runtime

- Add a small Cargo workspace with `runtime-protocol` and `runtime-sidecar`.
- Use versioned NDJSON requests/events and structured error codes.
- Implement bounded stdout/stderr capture, stdin, environment/cwd, timeout, cancellation, concurrent
  requests, graceful shutdown, and force-kill fallback.
- Add Rust unit/integration tests, including Windows `.exe` and paths-with-spaces cases where the
  host supports them.
- Integrate through an opt-in TypeScript adapter. If startup, handshake, protocol, or request
  handling fails, use the current `ProcessRunner` path and log a structured warning.

### Phase 2: long-lived provider process handles

- Extend the protocol with streaming chunks and explicit stdin/stop commands.
- Adapt `ChildProcessSpawner` behind a feature flag and run provider contract tests for every
  adapter. Use bounded queues and per-session ownership.
- Keep Node spawning available until Codex, Claude, Cursor, Grok, and OpenCode pass lifecycle and
  output-streaming tests on Windows.

### Phase 3: Git and checkpoints

- Benchmark current Git CLI behavior through both Node and Rust supervision.
- Use native Git libraries only for operations where they preserve config, filters, worktrees,
  submodules, line endings, and credential behavior. Keep uncommon operations on the Git CLI.
- Differential-test hidden refs, staged/unstaged state, untracked files, detached HEAD, restore,
  and checkpoint deletion.

### Phase 4: filesystem runtime

- Profile current native `fff` search before changing it.
- Move only remaining high-cost scans/watchers/file operations, keeping canonical path and
  workspace-root safety semantics.

### Phase 5: desktop shell evaluation

- The reversible shell experiment may host an existing loopback web surface without native
  privileges. Close every item in `electron-to-tauri-gap-analysis.md` before starting a replacement
  shell or moving production behavior out of Electron.
- Keep the WebSocket server as a reusable host for remote web and mobile clients even if the local
  desktop UI moves to Tauri commands/events.

## Definition of done for each slice

1. Existing implementation remains available.
2. Typed protocol fixtures round-trip in Rust and TypeScript.
3. Focused tests cover success, failure, cancellation, concurrency, and Windows behavior.
4. Relevant server/desktop typecheck and tests pass.
5. A real application path is exercised without UI regression.
6. Baseline and hybrid runs use the same input and report averages plus raw samples.
