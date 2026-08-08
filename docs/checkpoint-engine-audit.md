# Checkpoint engine audit

Phase 10 says to preserve checkpoint semantics and move expensive logic into Rust where beneficial.
This is the audit and the measurement behind that decision. Captured 2026-08-09 on Windows x64.

A checkpoint is captured at the end of every turn, so its cost is paid on every agent interaction.

## What a capture does

`CheckpointStore` is a thin delegator: it resolves the active VCS driver and calls its optional
checkpoint capability. The work lives in `GitVcsDriver.checkpoints.captureCheckpoint`, which builds a
commit without touching the user's real index by pointing `GIT_INDEX_FILE` at a throwaway file:

| Step                         | Purpose                                  |
| :--------------------------- | :--------------------------------------- |
| `rev-parse --git-common-dir` | Locate a place for the temporary index   |
| `rev-parse --verify HEAD`    | Detect whether HEAD exists               |
| `read-tree HEAD`             | Seed the temporary index from HEAD       |
| `add -A -- .`                | Stage the whole worktree into that index |
| `write-tree`                 | Produce a tree object                    |
| `commit-tree`                | Produce a commit object                  |
| `update-ref`                 | Point the hidden checkpoint ref at it    |

Seven Git launches per checkpoint. At the 38 ms launch floor from `docs/git-runtime-audit.md`, that is
about 266 ms of pure process launch before any work happens.

## The measurement

```text
node scripts/benchmark-checkpoint-capture.mjs --sizes=1000,5000,15000 --repeat=5
```

Per-step means against synthetic repositories with a dirty worktree, one file modified:

| Step                         |  1,000 files |    5,000 files |    15,000 files |
| :--------------------------- | -----------: | -------------: | --------------: |
| `rev-parse --git-common-dir` |      44.3 ms |        41.1 ms |         45.9 ms |
| `rev-parse --verify HEAD`    |      44.3 ms |        41.5 ms |         42.1 ms |
| `read-tree HEAD`             |      43.4 ms |        63.0 ms |         86.6 ms |
| `add -A -- .`                | **527.1 ms** | **2,665.3 ms** | **23,700.7 ms** |
| `write-tree`                 |      83.3 ms |       261.6 ms |        660.1 ms |
| `commit-tree`                |      54.8 ms |        63.1 ms |         53.2 ms |
| `update-ref`                 |      49.6 ms |        54.8 ms |         57.6 ms |
| **Total**                    | **846.8 ms** | **3,190.4 ms** | **24,646.2 ms** |

Staging is 62% of the cost at 1,000 files, 84% at 5,000, and 96% at 15,000. It also scales far worse
than the repository does: tripling the file count from 5,000 to 15,000 multiplied the staging cost by
8.9.

## Why staging is expensive

Superlinear growth on a worktree with a single modified file means Git is not doing incremental work.
It is re-hashing everything, every time.

The cause is the throwaway index. Git avoids re-reading file contents by trusting the stat data cached
in the index; a fresh index seeded by `read-tree HEAD` has tree content but no stat cache, so
`git add -A` must open and hash every file in the worktree to decide what changed.

Two variants isolate it:

| Repository   | Production: fresh index, `read-tree` | Reused index, `read-tree` each time | Reused index, no `read-tree` |
| :----------- | -----------------------------------: | ----------------------------------: | ---------------------------: |
| 5,000 files  |                           2,664.5 ms |                          2,763.5 ms |                 **255.1 ms** |
| 15,000 files |                          21,384.3 ms |                         24,686.7 ms |                 **360.1 ms** |

Reusing the index file alone changes nothing, which is the point: `read-tree HEAD` discards the stat
cache on every capture, so a persistent file gains nothing while it is still re-seeded. Skipping the
re-seed as well collapses the whole capture, 10x faster at 5,000 files and **59x faster at 15,000**.
The staging step alone drops from 20.4 seconds to 104 ms.

## Decision

**Do not move checkpoint capture to Rust.** The expensive step is `git add -A`, and its cost is not
Git being slow, nor process launch, nor anything a reimplementation would improve. It is the
checkpoint design discarding Git's stat cache on every turn. A Rust reimplementation that re-hashed
the worktree every turn would be equally slow; one that maintained its own stat cache would be
reinventing the index Git already has.

**The fix is a persistent checkpoint index.** Keep one index file per worktree instead of a fresh
one per capture, and re-seed it with `read-tree HEAD` only when it is missing or stale, rather than
unconditionally.

This cannot be applied as-is, because `read-tree HEAD` is load-bearing for correctness, not just
seeding. Conditions the implementation has to satisfy before it can replace the current behavior:

- **HEAD moved.** If HEAD changed since the index was built (a commit, a branch switch, a restore),
  the index must be re-seeded or the checkpoint tree will be based on the wrong baseline.
- **Concurrent captures.** One index file per worktree is shared state. Two captures running at once
  must not interleave; today each has its own file and cannot collide.
- **Missing or corrupt index.** Any failure to read the persistent index must fall back to the
  current fresh-index path rather than producing a wrong tree.
- **External Git activity.** A user or agent running Git directly can move HEAD or the real index
  between captures.

The property that makes this testable is exact: for any repository state, the persistent-index path
must produce the **same tree OID** as the current implementation. That is a differential test, not a
judgement call, and it should cover a clean tree, modified files, new files, deletions, renames,
ignored files, a HEAD change between captures, and an empty repository with no HEAD.

Until those tests exist, the current behavior stays. A wrong checkpoint tree is silent data loss at
restore time, and 24 seconds of correct behavior beats 0.4 seconds of nearly correct behavior.

## Limitations

Synthetic repositories with uniform small text files, one host, four to five iterations per point.
Real repositories have larger files and different directory shapes, which will change the constants
though not the mechanism. Restore, diff, and delete paths were not measured; only capture. The 15,000
file figure is not the ceiling: the cost grows superlinearly, so a larger repository is worse than
proportionally worse.
