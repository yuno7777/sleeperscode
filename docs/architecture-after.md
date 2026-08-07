# Architecture after the first migration slice

This document describes the implemented state after phase 1, not the final Tauri target.

```text
Web / mobile / Electron clients (unchanged)
                  |
        typed WebSocket Effect RPC
                  |
   Node orchestration and provider adapters (unchanged)
                  |
       ProcessRunner compatibility boundary
          |                         |
 opt-in supported call        automatic fallback
          |                         |
 Rust runtime sidecar          Node child spawner
```

The Rust sidecar is lazy: it starts only when native finite-process execution is enabled and first
used. A protocol or binary failure does not prevent the server/UI from starting. Provider sessions,
terminal PTYs, filesystem search, persistence, WebSocket transport, and Electron remain unchanged in
this slice.

Fallback is deliberately limited to failures before the requested process starts. Once Rust emits
`processStarted`, the adapter maps any error back into the existing `ProcessRunner` error contract
without rerunning the command, avoiding duplicate side effects.

Set `T3CODE_RUST_RUNTIME=1` to opt into the adapter. Development builds discover
`target/debug/t3-runtime-sidecar`; packaged builds can set `T3CODE_RUNTIME_SIDECAR_PATH` to an
explicit artifact until desktop packaging is wired. Run `pnpm test:runtime-sidecar` for the Rust
suite and `pnpm bench:runtime-sidecar -- <sidecar-path> <iterations>` for the paired benchmark.

Later phases may move long-lived provider process handles behind the same compatibility boundary.
No provider adapter or frontend component should need to know whether Node or Rust owns a process.
