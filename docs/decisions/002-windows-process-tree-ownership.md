# ADR 002: Own Windows subprocess trees with Job Objects

- Status: Accepted
- Date: 2026-08-08

## Context

Killing only the direct child is insufficient for coding-agent and tool processes because they may
spawn workers or servers. Unix signal assumptions do not apply to Windows, and assigning a running
process to a Job Object leaves a race in which it can create descendants before containment.

Microsoft documents that Job Objects manage processes as a unit, descendants join the parent's job
by default, `TerminateJobObject` terminates associated processes, and
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` terminates them when the final job handle closes. Microsoft also
recommends creating the process suspended before assigning it when assignment must happen before it
runs.

## Decision

On Windows, every Rust-owned finite process is created with `CREATE_SUSPENDED`. The runtime:

1. Creates a private unnamed Job Object.
2. Enables `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` without breakaway flags.
3. Spawns the direct child suspended.
4. Assigns its process handle to the job.
5. Finds and resumes the initial thread.
6. Terminates the job on cancellation, timeout, or direct-child exit.

If job creation, assignment, or resume fails, the suspended child is terminated before
`processStarted` is emitted. The TypeScript adapter may therefore use its existing safe pre-start
Node fallback without duplicating command side effects.

## Consequences

- Normal cancellation, timeout, provider exit, graceful sidecar shutdown, and abrupt sidecar death
  clean the tested parent-child-grandchild tree.
- Descendants cannot opt out through ordinary inherited process creation because breakaway flags
  are not enabled on the job.
- Termination is forceful. Provider-specific graceful-stop protocols remain a later streaming
  runtime concern.
- Processes created through mechanisms that do not inherit the caller's job require separate
  provider validation.
- Non-Windows process-group ownership remains future work.

## Evidence

- [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Microsoft AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)
- `crates/runtime-sidecar/tests/process_runtime.rs`
- `crates/runtime-sidecar/tests/sidecar_lifecycle.rs`
- `scripts/benchmark-runtime-cancellation.mjs`
