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
- [ ] Package the sidecar for Windows desktop artifacts.

## Process migration

- [x] Validate stdout, stderr, stdin, non-zero exit, failed executable, invalid cwd, and timeout.
- [x] Validate cancellation and multiple concurrent finite processes.
- [-] Validate Windows executable resolution, Unicode, and spaces in paths (`.exe`, PowerShell,
  `.cmd`, `.bat`, an installed npm wrapper, Unicode/deep/relative paths, a local administrative UNC
  path, environment, PATH overrides, and ACL-denied execution pass; a real non-ASCII Windows profile
  and an external network share remain unverified).
- [ ] Extend to streaming provider processes with bounded queues.
- [ ] Run every provider adapter lifecycle contract against Rust supervision.
- [x] Prove cancellation, timeout, parent crash, graceful shutdown, and abrupt sidecar exit leave no
      tested parent-child-grandchild process behind on Windows.

## Later phases

- [ ] Benchmark and select Git operations for migration.
- [ ] Differential-test checkpoint capture/diff/restore.
- [ ] Profile remaining filesystem work; do not replace native `fff` blindly.
- [ ] Close Tauri gap analysis and build a reversible shell experiment.
- [ ] Repeat application RAM, CPU, startup, package-size, and workflow benchmarks.
