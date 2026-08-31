# Rust migration checklist

## Audit and baseline

- [x] Trace client, transport, orchestration, provider, persistence, filesystem, Git, checkpoint, and desktop boundaries.
- [x] Classify major modules.
- [x] Inventory Electron-specific capabilities.
- [x] Record available baseline measurements and mark gaps `NOT MEASURED`.
- [-] Complete a supported Node 24 install and application-level baseline.

## Rust foundation

- [x] Add a Cargo workspace without changing frontend structure.
- [x] Add versioned Rust request/event types and serialization tests.
- [x] Implement the finite process runtime with bounded output and cleanup.
- [x] Add matching TypeScript codecs and protocol fixture tests.
- [x] Add lazy binary discovery and an opt-in compatibility adapter.
- [-] Package the sidecar for Windows desktop artifacts (build staging and path forwarding pass; a
  complete NSIS installer remains blocked on an uncached optional dependency download).

## Process migration

- [x] Validate stdout, stderr, stdin, non-zero exit, failed executable, invalid cwd, and timeout.
- [x] Validate cancellation and multiple concurrent finite processes.
- [-] Validate Windows executable resolution, Unicode, and spaces in paths (`.exe`, PowerShell,
  `.cmd`, `.bat`, an installed npm wrapper, Unicode/deep/relative paths, a local administrative UNC
  path, environment, PATH overrides, and ACL-denied execution pass; a real non-ASCII Windows profile
  and an external network share remain unverified).
- [x] Extend the sidecar protocol and TypeScript client to streaming processes with bounded output
      and per-session input queues, correlated control receipts, exact byte chunks, and priority stop.
- [-] Run provider lifecycle contracts against Rust supervision (the shared ACP suite and Cursor/Grok
  matrix pass; Claude, Codex, and OpenCode still use their provider-specific Node transports).
- [x] Prove cancellation, timeout, parent crash, graceful shutdown, and abrupt sidecar exit leave no
      tested parent-child-grandchild process behind on Windows.

## Later phases

- [x] Benchmark and select Git operations for migration; retain native Git and remove redundant
      metadata launches.
- [x] Differential-test checkpoint capture/diff/restore.
- [x] Profile remaining filesystem work; retain the existing native `fff` index.
- [ ] Close Tauri gap analysis and build a reversible shell experiment.
- [ ] Repeat application RAM, CPU, startup, package-size, and workflow benchmarks.
