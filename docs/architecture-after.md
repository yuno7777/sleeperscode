# Architecture after the finite and ACP migration slices

This document describes the implemented state after phase 1, not the final Tauri target.

```text
Web / mobile / Electron clients (unchanged)
                  |
        typed WebSocket Effect RPC
                  |
   Node orchestration and provider adapters
                  |
 ProcessRunner + shared ACP runtime boundaries
          |                         |
 opt-in finite / ACP call      default or wrapper fallback
          |                         |
 Rust runtime sidecar            Node child spawner
```

The Rust sidecar is lazy: it starts only when native finite-process or ACP execution is enabled and
first used. A protocol or binary failure does not prevent the server/UI from starting. Cursor and
Grok share the opt-in ACP transport; each adapter scope owns one lazy native client and reuses its
sidecar across that adapter's concurrent sessions. Cursor and Grok do not share a global sidecar with
each other. Their adapters remain protocol-focused and do not handle native byte framing. Claude,
Codex, OpenCode, terminal PTYs, filesystem search, persistence, WebSocket transport, and Electron
retain their existing runtime paths.

Fallback is deliberately limited to failures before the requested process starts. Once Rust emits
`processStarted`, the adapter maps any error back into the existing `ProcessRunner` error contract
without rerunning the command, avoiding duplicate side effects.

Set persisted server setting `runtimeBackend` to `node`, `rust`, or `auto`. Node remains the default,
and `auto` currently resolves to Node until packaged-sidecar and whole-application differential tests
qualify Rust for automatic selection. `T3CODE_RUNTIME_BACKEND` overrides the persisted setting for
debugging; the legacy `T3CODE_RUST_RUNTIME=1` flag remains compatible. Development builds discover
`target/release/t3-runtime-sidecar` and then `target/debug/t3-runtime-sidecar`. Desktop artifacts
stage the selected-platform binary as an external resource and pass its path to the Windows primary
backend through `T3CODE_RUNTIME_SIDECAR_PATH`. Run `pnpm test:runtime-sidecar` for the Rust suite and
`pnpm bench:runtime-sidecar -- <sidecar-path> <iterations>` for the paired benchmark.

The native ACP path preserves JSON-RPC bytes through bounded start/write/output/stop sessions. Shell
wrappers remain on Node, which preserves Windows `.cmd` and `.bat` behavior. Later phases may move
the remaining long-lived provider processes behind similarly narrow boundaries. No frontend
component needs to know whether Node or Rust owns a process. Shared-sidecar stress tests currently
show a memory/process-count benefit and a throughput regression at 5-10 concurrent mock sessions, so
`auto` must remain on Node while that contention is unresolved.
