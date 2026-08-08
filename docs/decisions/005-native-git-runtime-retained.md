# ADR 005: Keep the native Git executable, and gate migrations on bottleneck evidence

Status: accepted

## Context

Phase 9 of the roadmap proposes evaluating `gix` or `git2` against the native Git executable, and
Phase 11 proposes migrating orchestration to Rust. Both proposals assume the migrated component is
where time is being spent. Neither assumption had been measured.

`scripts/benchmark-git-operations.mjs` measured the operations taken from the real call sites, using
`git --version` as a launch floor so each result splits into process launch and Git's own work. On
this host launching any Git process costs about 38 ms. `rev-parse --git-common-dir`, the shape of the
most frequent call site, spends 0.95 ms doing Git work inside a 38.77 ms call. Only `status`
(48.10 ms of work) and `diff` (34.39 ms) do substantial work, and only on a large repository.

Separately, `docs/performance-results.md` records that a warm Rust sidecar launch costs 68.30 ms
against 50.09 ms for a direct Node child, and that server startup memory is dominated by provider CLI
probing rather than by any runtime component.

## Decision

Keep the native Git executable. Do not adopt `gix` or `git2`.

The measured bottleneck is process launch, which a different Git implementation does not remove for
any operation that still shells out, and the operations where a faster implementation could win on
algorithm — `status` and `diff` — are the ones where matching the executable on ignore rules,
renames, submodules, line endings, and `.gitattributes` is hardest and most visible when wrong.

Routing Git through the existing Rust sidecar is also rejected: it is currently slower per launch
than a direct child.

Generalising from this: **a component is migrated only when profiling shows that component is the
bottleneck.** This applies to Phase 11. Orchestration stays on the existing event-sourced TypeScript
path until measurement implicates it. Current evidence implicates provider CLI probing and Windows
process launch instead, and `AGENTS.md` treats the orchestration core as the part of the product not
to disturb without cause.

## Consequences

- Phase 9 stays open on evidence rather than on effort, with three candidates that beat a library
  migration: answering metadata from `.git` without launching Git, coalescing the three launches in
  the status path, and attributing the 38 ms launch floor itself.
- Phase 11 is blocked on evidence rather than scheduled. Phases that the roadmap places behind it may
  need re-planning against the existing TypeScript orchestration.
- Git behavior, error classification, and timeout semantics stay exactly as they are, since nothing
  below `VcsProcess` changes.
- If a large dirty working tree, submodules, or a repository much larger than this one shifts the
  balance toward Git's own work, this decision should be re-measured before it is trusted.
