# Task outcome attribution

Sleepers Code keeps a local, durable join between a turn's server-owned task profile, its shadow
router decision, and the provider's factual terminal state. This is the first outcome-attribution
input for later router evaluation; it does not score provider quality or activate automatic routing.

## Lifecycle

The `projection_task_runs` table follows the existing event-sourced turn lifecycle:

1. `thread.turn-start-requested` replaces the thread's pending task-run row and stores the optional
   `TaskProfile` and `RouterDecision` JSON.
2. A running `thread.session-set` binds that pending row to the provider's concrete turn id.
3. Provider `turn.completed` and `turn.aborted` events pass the same active-turn guard used by the
   session lifecycle.
4. The server emits `thread.turn-outcome-recorded`, and the task-run projection records its
   versioned `TaskOutcomeObservation`.

The projection has its own replay cursor. Existing databases receive it through migration 41, and
the projector can rebuild it from the durable event log. Historical turns created before task
profiles or router decisions remain decodable with missing evidence rather than guessed values.

The analytics read model also derives `elapsedMs` when both timestamps are present and ordered. It
measures request-to-terminal wall time, including queueing and provider work. It is not presented as
model-only latency, and clock-skewed or pending rows remain untimed instead of being clamped to zero.

## What an observation means

Version 1 records only:

- `completed`, `failed`, `interrupted`, `cancelled`, or `aborted`;
- the provider driver and optional configured instance id; and
- the provider event timestamp.

`completed` means the provider reported a completed turn. It does **not** mean the implementation was
correct, tests passed, the changes survived, or the user was satisfied. The contract intentionally
has no `success`, quality score, free-form error, or stop-reason field.

## Privacy and bounds

The task-run projection stores closed-enum task metadata, the bounded shadow decision, and the
content-free terminal observation. It does not duplicate:

- prompts or assistant messages;
- filenames, repository paths, diffs, or manifest content;
- provider error text or abort reasons;
- credentials or account identity; or
- raw usage payloads.

The source conversation and checkpoint data continue to live in their existing stores. Usage and
cost remain in the usage ledger until a tested attribution join exists.

## Read surface

`server.getTaskAnalytics` exposes at most 200 newest records per environment and reporting window.
The payload contains only compact profile categories, shadow-decision reason codes, provider identity,
terminal state, and optional elapsed milliseconds. It uses an opaque local-store fingerprint so
clients can avoid double-counting the same database through multiple connections. Web/desktop and
mobile merge those bounded summaries into Tasks and Router views on the Usage page, showing timing
coverage, average elapsed time, and per-task elapsed time. The views deliberately label terminal
state as lifecycle evidence and shadow decisions as unapplied.

## Current limits

- Only a normal turn-start-to-running transition can produce a fully joined task-run row. A late
  provider completion without a preceding pending row remains in the event log but is not invented
  into a task profile.
- Request-to-terminal elapsed time is available, but queue time and provider execution are not split.
- There is no quality label, test-result ingestion, user rating, repair count, change-survival signal,
  or usage/cost join yet.
- No router score or provider selection consumes these rows.
- There is no analytics export or automatic retention policy yet.

Router scoring must wait for independent quality evidence and a defensible evaluation dataset. A
terminal-state count alone is not a model leaderboard.
