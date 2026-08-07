# Architecture before the Rust runtime migration

Snapshot: upstream commit `45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b` on 2026-08-08.

```text
React web client / React Native mobile client / Electron desktop shell
                              |
                    typed Effect RPC over WebSocket
                              |
                        Node T3 server
                              |
              command -> decider -> persisted event
                              |
              projector -> SQLite read model -> RPC
                              |
       +----------------------+----------------------+
       |                      |                      |
 provider adapters       queue-backed reactors   host services
       |                      |                      |
 Codex / Claude /        checkpoints and         workspace (native fff
 Cursor / Grok /         ordered receipts        index), Git CLI, PTY,
 OpenCode processes                             previews, telemetry
```

## Runtime path

The clients use the schemas in `packages/contracts` and the shared connection/state code in
`packages/client-runtime`. `apps/server/src/ws.ts` exposes those schemas through Effect RPC. The
orchestration engine persists commands and events in SQLite, updates projections, and starts
reactors. `ProviderService` routes a thread to a configured provider instance; each adapter owns
the provider protocol and its process lifetime.

Provider processes currently use Effect's Node child-process spawner. Codex and ACP runtimes use
stdin/stdout protocols, Claude uses its SDK/runtime adapter, and OpenCode supervises a local server.
`ProcessRunner` handles bounded, finite command invocations used by supporting services. Terminal
sessions use `node-pty` and remain a separate PTY-shaped concern.

Workspace path and content search already use `@ff-labs/fff-node`, a native engine. File mutation
and browsing use Node filesystem APIs with explicit root checks. Git and checkpoint operations use
the installed Git executable through `VcsProcess`; checkpoints are commits stored under hidden Git
refs and are coordinated by `CheckpointReactor`.

The Electron process starts and supervises the bundled Node server and adds windowing, application
menus, dialogs, updater, safe storage, deep links, custom protocols, preview webviews, clipboard,
power state, WSL, SSH, and desktop IPC. The Node WebSocket server is also the host for browsers and
mobile clients, so it cannot be removed as part of a desktop-only shell change.

## Classification

| Module                                             | Decision             | Reason                                                                                                    |
| -------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| React web UI and React Native UI                   | **KEEP TYPESCRIPT**  | Product behavior and rendering are not runtime bottlenecks addressed by Rust.                             |
| `packages/contracts` and `packages/client-runtime` | **KEEP TYPESCRIPT**  | These are the typed multi-surface compatibility boundary.                                                 |
| WebSocket/RPC authorization and remote transport   | **KEEP TYPESCRIPT**  | Remote web/mobile hosting is core and tightly integrated with Effect RPC. Revisit only with parity tests. |
| Pure command decider and projector                 | **DO NOT TOUCH**     | Pure, tested domain semantics gain little from a language migration.                                      |
| SQLite event store and projections                 | **MAYBE MIGRATE**    | Profile first; moving persistence would create a high compatibility and migration cost.                   |
| Provider protocol adapters                         | **KEEP TYPESCRIPT**  | Provider-specific SDKs and schemas change frequently; keep complexity at this boundary.                   |
| Child-process spawning and supervision             | **MIGRATE TO RUST**  | High-value lifetime, cleanup, concurrency, backpressure, and Windows process-tree work.                   |
| Terminal PTY runtime                               | **MAYBE MIGRATE**    | `node-pty` is specialized and user-visible. Migrate only after the non-PTY process runtime is proven.     |
| Workspace search index                             | **DO NOT TOUCH**     | It already uses a native engine and has path/content-specific behavior.                                   |
| Workspace file read/write and watching             | **MAYBE MIGRATE**    | Safety semantics are good; profile watcher/scanning pressure before replacement.                          |
| Git status/diff/checkpoint subprocess work         | **MAYBE MIGRATE**    | Reuse the process runtime first; evaluate `gix`, `git2`, and Git CLI compatibility with benchmarks.       |
| Queue-backed reactors and receipts                 | **KEEP TYPESCRIPT**  | They encode ordering and event-sourced behavior; Rust is useful only for isolated effects.                |
| Electron shell                                     | **KEEP TEMPORARILY** | Several Electron-only capabilities lack a validated Tauri replacement today.                              |
| Rust resource monitor                              | **KEEP RUST**        | Existing bounded NDJSON sidecar is a proven integration pattern.                                          |
