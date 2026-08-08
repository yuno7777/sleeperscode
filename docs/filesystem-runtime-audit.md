# Filesystem runtime audit

Phase 7 proposes moving performance-sensitive filesystem work to Rust using crates such as `notify`,
`ignore`, `walkdir`, and `globset`. This is the audit and the measurement behind that decision.
Captured 2026-08-09 on Windows x64 with Node 24.14.0.

## The heavy path is already native

The premise that filesystem work sits in Node is out of date. `apps/server/src/workspace/` splits
into three concerns:

| Concern                                 | Implementation                                                      |
| :-------------------------------------- | :------------------------------------------------------------------ |
| Recursive traversal, fuzzy search, grep | `@ff-labs/fff-node`, a native finder, via `WorkspaceSearchIndex.ts` |
| Single-directory listing                | Node `readdir` with `withFileTypes`, in `WorkspaceEntries.ts`       |
| Path safety and containment             | Pure TypeScript, in `WorkspacePaths.ts`                             |

`WorkspaceSearchIndex.ts` builds two index variants: a path-only index for the file tree, composer
path search, and file picker, and a content index created on demand for content search. It already
carries the bounds Phase 7 and Phase 8 ask for: a 25,000-entry cap, a 15-second scan timeout, a
15-minute idle TTL, a 250 ms content-search time budget, and 100 matches per file.

Node's remaining filesystem use is a single-level `readdir` per directory expansion, plus ordinary
file reads and writes. Neither is recursive, so neither is a traversal cost.

## The measurement

```text
node scripts/benchmark-workspace-scan.mjs --repeat=3
```

Each scenario runs in a separate process, and scenarios alternate across iterations.

| Scenario                      |        Mean |        Min |         Max |   Files | Directories |
| :---------------------------- | ----------: | ---------: | ----------: | ------: | ----------: |
| Node walk, exclusions applied |    108.1 ms |   107.2 ms |    109.4 ms |  15,873 |       1,711 |
| Node walk, no exclusions      |  2,893.3 ms | 2,814.0 ms |  2,998.6 ms | 382,502 |      35,196 |
| Native index, path only       |    124.6 ms |   109.4 ms |    133.9 ms |       — |           — |
| Native index, with content    | 14,092.3 ms |   314.5 ms | 41,584.9 ms |       — |           — |

## What the numbers say

**Traversal is not a bottleneck, and Node is not the problem.** A plain Node recursive walk with
exclusions applied takes 108.1 ms over this monorepo, statistically the same as the native path-only
index at 124.6 ms. Whatever the native finder is worth, it is not raw directory traversal speed. The
`walkdir` and `ignore` crates in the Phase 7 proposal would be replacing something that is already
fast enough and already native.

**Exclusions are the entire lever, and they are worth 27x.** Skipping `node_modules`, `.git`,
`dist`, `target`, and friends is the difference between 15,873 files and 382,502, and between 108 ms
and 2,893 ms. This is the one filesystem decision that measurably matters, and the existing code
already makes it.

**Content indexing looked expensive and highly variable.** Building the content index averaged 14.1
seconds with a range of 0.31 to 41.6 seconds across three runs. See the correction below: that mean
is one cold outlier, and the follow-up measurement withdraws the conclusion originally drawn from it.

## Correction: the content index is not near its timeout

This document first concluded that a cold-cache content search on a large repository could exceed the
15-second production timeout, and listed that as Phase 7's one measured problem. A follow-up
measurement relating index time to file count does not support it.

```text
node scripts/benchmark-content-index.mjs --sizes=1000,5000,15000,30000 --repeat=3
```

| Target                 | Content index mean |
| :--------------------- | -----------------: |
| 1,000 synthetic files  |            61.7 ms |
| 5,000 synthetic files  |           191.4 ms |
| 15,000 synthetic files |           508.1 ms |
| 30,000 synthetic files |         1,065.8 ms |
| this monorepo          |         331-413 ms |

Index construction is linear at roughly 35 microseconds per file. Reaching the 15-second timeout by
computation alone would take on the order of 400,000 files, and the index caps at 25,000 entries
before that. Repeated runs on this monorepo now complete in 303-433 ms.

The original 14.1-second mean came from three samples of which one was 41.6 seconds and two were
about 0.3 seconds. That 41.6-second run was the first content index ever built over this repository
on this machine, so it measured cold first-touch I/O, not index work. It is not reproducible now that
the page cache is warm, and a benchmark should not drop the OS cache to try.

**Corrected conclusion: the 15-second timeout is not tight, and no change to it is justified.** What
remains genuinely unmeasured is a first-ever content index over a large repository on a cold cache,
which is where the single 41.6-second observation came from. That is a real risk worth remembering,
but one outlier is not evidence of a defect, and the timeout constant should not be moved on it.

## Decision

**Do not migrate filesystem traversal.** The hot path is already native, and the part still in Node
is a single-level `readdir` that no crate would speed up. Phase 7 as originally framed is largely
already satisfied, not pending.

Remaining work, in order of value:

1. **Inventory watcher behavior for Phase 8.** Debounce, deduplication, batching, and storm
   protection were not audited here. The 27x exclusion result strongly suggests watcher exclusions
   deserve the same scrutiny, since a dependency install touches the same 380,000 files.
2. **Leave the content-index timeout alone.** Characterised above: linear at about 35 microseconds
   per file, roughly 400,000 files from the bound, and capped at 25,000 entries well before that.
3. **Leave `WorkspaceEntries` alone.** Single-directory `readdir` is not worth a native call.

Phase 7 therefore has no confirmed defect. It is closed on evidence rather than on work done.

## A note on measuring this

The first version of this benchmark ran every scenario in one process and reported that the native
index failed to become ready within 60 seconds. That was false. Run alone, the same scan completes
in about 120 ms; an exhaustive Node walk in the same process had starved it of I/O. Isolating each
scenario in its own process fixed it. A benchmark that shares a process between a saturating workload
and the thing being measured will manufacture defects that do not exist.

## Limitations

Three iterations on one host, one monorepo, no small or medium repository comparison, and no
measurement of watchers, file reads, or writes. Content-index variance is large enough that three
runs describe a range rather than a distribution.
