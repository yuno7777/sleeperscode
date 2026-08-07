# ADR 001: Keep the Rust finite-process runtime behind `ProcessRunner`

- Status: Accepted
- Date: 2026-08-08

## Context

T3 Code already centralizes bounded, finite subprocess calls in `ProcessRunner`, while provider
sessions, PTYs, and desktop lifecycle code have different streaming and ownership contracts. A
large runtime replacement would combine unrelated risks and weaken the Node fallback.

## Decision

The first Rust runtime remains a lazy local sidecar behind `ProcessRunner` and a versioned NDJSON
protocol. Node remains the default. Rust is selected explicitly while validation is incomplete.

Fallback is safe only before the requested command starts. Once the sidecar emits
`processStarted`, the adapter maps failure into the existing error contract and never reruns the
command automatically. Shell-backed Windows wrappers remain on Node until their command-line and
process-tree semantics have explicit tests.

## Consequences

- The UI, WebSocket transport, event-sourced orchestration, providers, PTYs, and Electron shell do
  not depend on the native runtime.
- Rust can improve process ownership incrementally without changing callers.
- The protocol needs compatibility tests in both languages.
- A sidecar adds one process and IPC hop, which must be measured rather than assumed beneficial.
- Provider streaming and Windows Job Object ownership require later decisions and protocol work.

## Validation gate

Keep Node as the safe default until Windows path/wrapper tests, process-tree cleanup, provider
lifecycle tests, whole-application measurements, desktop packaging, and crash recovery demonstrate
that automatic Rust selection is safe.
