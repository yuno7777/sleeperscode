# Rust runtime design

## Boundary

The first runtime is a local child process, not a network service. It uses newline-delimited JSON on
stdin/stdout, emits no agent output to normal logs, and keeps stderr for structured diagnostics.
The Node server owns the sidecar lifecycle. The protocol is versioned and rejects incompatible
peers before work starts.

```text
Node server ProcessRunner
          |
   opt-in compatibility adapter
          |
   bounded NDJSON requests/events
          |
    Rust runtime sidecar
          |
   Tokio child processes
```

## Process ownership

- The sidecar owns every process it starts and tracks it by request/process ID.
- Each run owns its `tokio::process::Child`, stdout/stderr readers, timeout, and cancellation token.
- Concurrent runs are independent Tokio tasks; shared state is only an ID-to-control-handle map.
- Sidecar stdin is decoded one line at a time, and a fixed semaphore rejects work beyond 32 active
  processes. Events use a bounded writer channel, which propagates backpressure instead of growing
  without limit.
- Shutdown cancels active work, attempts graceful termination, waits for a bounded grace period,
  and then force-kills remaining children.

## Protocol shape

Requests and events live in `runtime-protocol`; the sidecar and Rust tests consume the same types.
Matching TypeScript codecs reject unknown protocol versions and malformed messages.

Initial requests:

- `run`: finite command with explicit argv, cwd, environment behavior, optional stdin, timeout, and
  output limits.
- `cancel`: cancel one active request.
- `shutdown`: stop accepting work and clean up owned children.

Initial events:

- `hello`: protocol/runtime version, PID, platform, architecture, and capabilities.
- `processStarted`: request ID and PID.
- `processCompleted`: exit code, timeout state, bounded stdout/stderr, and truncation flags.
- `error`: stable code, readable message, request ID when known, and optional development detail.

Streaming provider output is deliberately a later protocol capability. The first adapter handles
finite `ProcessRunner` calls only; pretending it supports provider sessions would weaken lifecycle
and backpressure guarantees.

## Security

- Commands and arguments are separate fields; the Rust runtime never concatenates arbitrary input
  into a shell command.
- Shell execution is rejected by the native protocol. The TypeScript compatibility layer keeps the
  Node path for `.cmd`/`.bat` shims until a tested Windows command-line contract is implemented.
- Working directories are validated before spawn. The runtime does not broaden filesystem access.
- Environment inheritance is explicit and capped input/output sizes prevent accidental memory
  expansion.
