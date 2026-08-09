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
- whether decomposition is plausible; and
- stable reason codes explaining which deterministic signals fired.

The profile deliberately excludes prompt excerpts, filenames, repository paths, credentials, and
provider recommendations. It can therefore be retained with the turn-start event without copying
sensitive prompt content into a second storage surface.

## Classifier behavior

`packages/shared/src/taskProfile.ts` uses bounded string checks. Prompts up to 24,000 sampled
characters are inspected directly; longer prompts use a 16,000-character prefix and an
8,000-character suffix. No model call, network request, filesystem scan, or repository traversal is
performed.

The collaboration recommendation is conservative:

- low and medium tasks remain on one worker;
- a task can be decomposed only when complexity is at least 65 and it also has broad scope, multiple
  domains, many expected files, or an explicit collaboration request; and
- multi-specialist work requires both parallelizability and a complexity score of at least 80.

This prevents a small request such as changing a button radius from automatically creating a
planning, implementation, testing, and review chain.

## Event integration

The orchestration decider computes the profile from the user message and attachment types and adds it
to `thread.turn-start-requested`. The field is optional in the event schema so historical events and
mixed-version snapshots continue to decode.

The original user message remains the provider input and continues through the existing message
event. The task profile is metadata for later router, budget, collaboration, and telemetry stages.

## Limitations

- Version 1 uses English keyword signals and coarse estimates.
- It does not inspect repository languages, changed areas, available tests, or historical outcomes.
- Scores are explainable heuristics, not measured provider-quality evidence.
- No provider selection or collaboration behavior changes in this phase.

Later router work may add repository and telemetry inputs, but it must keep classification cheap,
versioned, privacy-preserving, and subordinate to explicit user routing choices.
