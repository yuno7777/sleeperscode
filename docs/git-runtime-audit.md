# Git runtime audit

Phase 9 asks whether Git work should move to `gix`, `git2`, or stay on the native Git executable.
This is the audit and the measurement behind that decision. The baseline was captured 2026-08-09
and the metadata follow-up on 2026-08-31, both on Windows x64 with Node 24.14.0.

## Every Git call goes through one boundary

There is no scattered Git access to untangle. Every invocation reaches the same two files:

```text
callers  ->  VcsProcess.run  ->  ProcessRunner.run  ->  child process
```

`apps/server/src/vcs/VcsProcess.ts` is the only place that spawns a VCS command. It owns the
30-second default timeout, the 1 MB output cap, truncation markers, and the mapping from process
failures to typed `VcsError`s, including classifying a non-zero exit as authentication, not-found,
or command-failed.

That matters more than the choice of Git library. A migration would replace what sits below this
boundary, not restructure the callers, and the boundary already carries the timeout, output-bound,
and error-classification behavior any replacement would have to reproduce.

Call sites cluster in `apps/server/src/vcs/GitVcsDriverCore.ts` (the driver), `apps/server/src/git/`
(workflow and manager), `apps/server/src/checkpointing/`, and `apps/server/src/project/`. Counting
literal invocations outside tests, 28 sites resolve to these subcommands:

| Subcommand   | Sites | Character                                                                                        |
| :----------- | ----: | :----------------------------------------------------------------------------------------------- |
| `rev-parse`  |     7 | Metadata; reads refs and config                                                                  |
| `push`       |     2 | Network                                                                                          |
| `update-ref` |     2 | Checkpoint plumbing                                                                              |
| `pull`       |     2 | Network                                                                                          |
| `status`     |     1 | Index and working-tree scan                                                                      |
| `diff`       |     1 | Index and working-tree scan                                                                      |
| `log`        |     1 | History                                                                                          |
| Others       |    12 | `remote`, `branch`, `add`, `write-tree`, `read-tree`, `commit-tree`, `reset`, `clean`, `restore` |

Local status is event-driven. Remote status polls on a 30-second default interval
(`VcsStatusBroadcaster.ts`), backing off to at most 15 minutes after failures.

## The measurement

```text
node scripts/benchmark-git-operations.mjs --repeat=20
```

`git --version` is included as a launch floor: it opens no repository, so whatever it costs is pure
process launch. Subtracting it from each operation leaves Git's own work.

| Repository            | Operation                       |     Mean |   Median |       p95 | Git's own work | Launch share |
| :-------------------- | :------------------------------ | -------: | -------: | --------: | -------------: | -----------: |
| this monorepo         | `--version` (launch floor)      | 37.82 ms | 37.70 ms |  59.40 ms |              — |       100.0% |
| this monorepo         | `rev-parse --git-common-dir`    | 38.77 ms | 38.31 ms |  61.92 ms |        0.95 ms |        97.5% |
| this monorepo         | `rev-parse --abbrev-ref HEAD`   | 39.70 ms | 39.42 ms |  55.12 ms |        1.88 ms |        95.3% |
| this monorepo         | `remote`                        | 40.84 ms | 40.40 ms |  57.46 ms |        3.02 ms |        92.6% |
| this monorepo         | `diff HEAD --numstat`           | 72.21 ms | 70.88 ms |  95.63 ms |       34.39 ms |        52.4% |
| this monorepo         | `status --porcelain=2 --branch` | 85.92 ms | 85.08 ms | 118.07 ms |       48.10 ms |        44.0% |
| single-commit fixture | `--version` (launch floor)      | 39.03 ms | 40.70 ms |  50.10 ms |              — |       100.0% |
| single-commit fixture | `rev-parse --git-common-dir`    | 43.65 ms | 42.37 ms |  58.36 ms |        4.63 ms |        89.4% |
| single-commit fixture | `rev-parse --abbrev-ref HEAD`   | 42.21 ms | 43.14 ms |  60.68 ms |        3.19 ms |        92.5% |
| single-commit fixture | `remote`                        | 42.76 ms | 45.03 ms |  59.82 ms |        3.73 ms |        91.3% |
| single-commit fixture | `diff HEAD --numstat`           | 44.98 ms | 44.43 ms |  70.23 ms |        5.95 ms |        86.8% |
| single-commit fixture | `status --porcelain=2 --branch` | 46.12 ms | 47.00 ms |  61.60 ms |        7.09 ms |        84.6% |

The earlier recorded 92.871 ms Git status baseline is consistent with the 85.92 ms measured here.

## What the numbers say

**Process launch dominates, not Git.** Launching any Git process on this host costs about 38 ms
before Git opens a repository. On the small repository every operation is 85-92% launch overhead.

**The metadata operations are almost pure overhead.** `rev-parse --git-common-dir` spends 0.95 ms
doing Git work inside a 38.77 ms call. `rev-parse --abbrev-ref HEAD` spends 1.88 ms, `remote`
3.02 ms. These are the most frequent call sites in the codebase, and 92-97% of their cost is
spawning a process to answer a question that amounts to reading a file.

**Status and diff are genuinely doing work.** On this monorepo `status` spends 48.10 ms and `diff`
34.39 ms on real index and working-tree scanning. This is the only place where a faster Git
implementation could win on algorithm rather than on launch, and it is also the place where
correctness is hardest: ignore rules, renames, submodules, line-ending normalization, and
`.gitattributes` all have to match the native executable exactly.

## Decision

**Keep the native Git executable.** The premise behind migrating to `gix` or `git2` was that Git's
work is slow. It is not: the process launch around it is. Replacing the Git implementation would
leave the 38 ms launch untouched for every operation that still shells out, while taking on the
compatibility surface of status and diff, which are the two operations users notice being wrong.

**The Rust sidecar does not help here either.** The protocol v2 re-measurement in
`performance-results.md` puts a warm sidecar launch at 68.30 ms against 50.09 ms for a direct Node
child, so routing Git through it would add latency to every call.

The real candidates, in order of value per unit of risk:

1. **Coalesce standard repository metadata. Implemented.** The driver now asks `rev-parse` for the
   common directory, per-worktree Git directory, and worktree root in one process, then reads that
   Git directory's `HEAD` directly. Detached heads resolve to no current branch. Unreadable or
   nonstandard symbolic heads fall back to `symbolic-ref`; bare repositories and malformed or
   newline-bearing output fall back to the previous resolver. This preserves Git as the authority
   for repository layout while removing two process launches from the normal path.
2. **Coalesce the status path.** `statusDetails` issues `rev-parse`, `status`, and `diff` as three
   separate launches, so a single refresh pays the 38 ms floor three times, roughly 114 ms of which
   about 76 ms is launch. Caching the metadata result across a refresh removes launches without
   changing any Git behavior.
3. **Reduce the launch floor itself.** A 38 ms floor to run `git --version` is high and is the single
   largest lever across every Git operation. It is unmeasured whether this is Windows process
   creation generally, Git for Windows' own startup, or antivirus filtering. Worth attributing
   before anything else, because it also affects provider CLI probing, which
   `performance-results.md` shows dominates server startup memory.

None of these is a Git library migration. Phase 9 stays open for broader status-path and launch-floor
work, but the implementation selection and first measured launch reduction are complete.

## Metadata resolver follow-up

The benchmark alternates the legacy and coalesced resolvers in every iteration and verifies their
returned common directory, worktree root, and branch are identical before recording a sample:

```text
node scripts/benchmark-git-operations.mjs --repeat=20 --warmups=3
```

| Repository            | Legacy mean | Coalesced mean | Mean improvement |
| :-------------------- | ----------: | -------------: | ---------------: |
| this monorepo         |   169.49 ms |       72.64 ms |            57.1% |
| single-commit fixture |   177.05 ms |       77.92 ms |            56.0% |

The result is a launch-count win, not evidence that the Git implementation itself became faster.
The driver integration suite passes 46 tests on this host. Its one remaining Windows failure is an
existing test fixture that asks Git for Windows to create a directory whose name contains a newline;
the three directly affected metadata, fallback-diagnostics, and current-branch tests pass.

## Limitations

Twenty iterations on one host under uncontrolled background load, one large repository and one
trivial one. No repository with a large dirty working tree, no submodules, no network operations
(`push`, `pull`, `log` were not measured), and no comparison against an actual `gix` or `git2`
implementation, which would be needed before reversing the decision above.
