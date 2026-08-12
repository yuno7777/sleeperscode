# Task profiles

Sleepers Code attaches a deterministic `TaskProfile` to every new turn before any provider session
starts. The profile is the first input to the adaptive-routing roadmap; it does not choose a provider
or override the model selected by the user.

## Contract

Classifier version 1 records:

- task kinds such as implementation, debugging, review, research, design, and operations;
- a bounded complexity score and a named complexity band;
- frontend, backend, systems, and research signal scores;
- visual, reasoning, repository-context, testing, and security requirements;
- coarse expected file scope and duration;
- tool requirements;
- bounded root-level repository languages, frameworks, test runners, and workspace shape;
- whether decomposition is plausible; and
- stable reason codes explaining which deterministic signals fired.

The profile deliberately excludes prompt excerpts, filenames, repository paths, credentials, and
provider recommendations. It can therefore be retained with the turn-start event without copying
sensitive prompt content into a second storage surface.

## Classifier behavior

`packages/shared/src/taskProfile.ts` uses bounded string checks. Prompts up to 24,000 sampled
characters are inspected directly; longer prompts use a 16,000-character prefix and an
8,000-character suffix. No model call, network request, or repository traversal is performed.

Before the pure decider runs, the server adds best-effort repository evidence. The profiler checks a
fixed set of root marker filenames and reads only `package.json`, `Cargo.toml`, and `pyproject.toml`
when they are no larger than 128 KiB. Results are cached for five minutes across at most 32 workspace
roots. It never recursively lists the workspace, and the retained evidence contains only closed
enums and booleans—not paths, filenames chosen by the user, dependency versions, or manifest text.
An unavailable or oversized source sets `limited: true` instead of delaying or rejecting the turn.

The collaboration recommendation is conservative:

- low and medium tasks remain on one worker;
- a task can be decomposed only when complexity is at least 65 and it also has broad scope, multiple
  domains, many expected files, or an explicit collaboration request; and
- multi-specialist work requires both parallelizability and a complexity score of at least 80.

This prevents a small request such as changing a button radius from automatically creating a
planning, implementation, testing, and review chain.

## Event integration

The command normalizer resolves the existing thread worktree or project root and attaches
server-owned repository evidence. Client command schemas omit that field, so a remote client cannot
forge it. The orchestration decider computes the profile from the user message, attachment types,
and bounded evidence, then adds it to `thread.turn-start-requested`. Both fields are optional in their
durable schemas so historical events and mixed-version snapshots continue to decode.

The original user message remains the provider input and continues through the existing message
event. The task profile feeds the optional shadow decision described in
[`adaptive-router.md`](./adaptive-router.md) and remains metadata for later budget, collaboration,
and telemetry stages. The durable task-run join in
[`task-outcome-attribution.md`](./task-outcome-attribution.md) carries the profile to the provider's
concrete turn id without copying prompt content.

## Limitations

- Version 1 uses English keyword signals and coarse estimates.
- Repository evidence is root-only. It does not inspect changed areas, nested package manifests,
  source files, test results, Git history, or quality outcomes.
- Scores are explainable heuristics, not measured provider-quality evidence.
- The shadow decision cannot change provider selection or collaboration behavior.

Later router work may add bounded change and telemetry inputs, but it must keep classification cheap,
versioned, privacy-preserving, and subordinate to explicit user routing choices.
