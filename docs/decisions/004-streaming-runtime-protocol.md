# ADR 004: Streaming runtime protocol boundary

## Status

Accepted for incremental implementation. Provider adapters remain on the Node process spawner until
the protocol and client pass the five-provider differential gate.

## Context

The version 1 runtime protocol owns finite commands whose output is collected before completion.
Provider sessions are long-lived, accept incremental stdin, and can emit enough events to exhaust
memory if either side uses an unbounded queue. Windows also requires the native process owner to
retain its Job Object for the complete session.

## Decision

Protocol version 2 adds four operations. `start.requestId` becomes the stable session identifier.
Every later control carries that value as `sessionId` plus a unique `requestId` for receipt and error
correlation:

- `start`: spawn one contained process with piped stdin, stdout, and stderr;
- `write`: enqueue a base64-encoded stdin byte chunk;
- `closeStdin`: close the process input stream without stopping the process;
- `stop`: terminate the owned process tree.

Accepted `write` and `closeStdin` controls emit `controlAccepted` with both identifiers. Queue-full,
invalid-input, and missing-session errors carry the control request ID, so concurrent writes cannot
consume one another's result. `stop` completes through the session's terminal `processExited` event.

Streaming output is emitted as `processOutput` events. Each event identifies stdout or stderr,
carries a per-stream non-negative sequence number, and encodes the exact bytes as base64. A terminal
`processExited` event reports the exit code and whether the runtime stopped the session.

The sidecar uses bounded channels for both outbound events and per-session input. Output readers
await event capacity, allowing OS pipe backpressure to slow the child rather than accumulating an
unbounded heap. A full input queue returns a structured recoverable error; input is never silently
dropped.

## Compatibility and fallback

Finite `run`, `cancel`, and `shutdown` semantics remain available in version 2. The TypeScript
client requires an exact handshake version, so mismatched sidecars fail before a requested process
starts and the existing ProcessRunner may use Node fallback. Once `processStarted` is observed, no
request is replayed through Node.

The `streamingProcesses` capability becomes true only after start/write/close/stop and lifecycle
tests pass in the Rust sidecar. Runtime backend `auto` continues to resolve to Node until packaging,
provider parity, and whole-application gates are complete.

## Rejected alternatives

- UTF-8 strings per read chunk can corrupt a multi-byte character split across reads.
- JSON byte arrays materially inflate high-volume streams.
- Unbounded queues hide overload until the process is out of memory.
- One global sequence interleaves stdout and stderr according to scheduler timing and implies an
  ordering the operating system does not provide.
