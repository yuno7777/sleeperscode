# ADR 003: Validate provider semantics before migrating streaming ownership

Status: accepted

## Context

The finite Rust runtime intentionally buffers bounded command output. Claude, Codex, Cursor, Grok,
and OpenCode sessions instead depend on long-lived bidirectional protocols, incremental events,
provider-specific cancellation, and approval state. Treating those sessions as larger finite commands
would erase required semantics.

## Decision

Keep production provider streaming on the existing TypeScript/Effect paths until a deterministic
cross-provider matrix passes. Use a test-only Rust launcher on Windows solely to make mock provider
process ownership and stdio behavior equivalent enough to validate the current adapters. The
launcher is not a production provider transport.

Any future Rust streaming protocol must preserve provider event ordering, backpressure, stdin/RPC
writes, cancellation settlement, process-tree cleanup, and error identity. Migration proceeds behind
the runtime selector and must pass differential tests against the current Node implementation.

## Consequences

- Provider semantics remain stable while the Rust protocol is designed from observed behavior.
- Windows tests no longer depend on POSIX shell executability or Unix signal names.
- The test launcher adds a small build dependency to the Windows provider matrix.
- Phase 3 remains incomplete until authenticated and high-volume validation is available.
