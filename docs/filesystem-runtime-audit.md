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

**Content indexing is expensive and highly variable.** Building the content index averaged 14.1
seconds with a range of 0.31 to 41.6 seconds across three runs, the spread tracking filesystem cache
warmth. Production caps this with a 15-second timeout, so on a cold cache a first content search over
a repository this size can exceed the timeout and surface `WorkspaceSearchIndexScanTimedOut`. That is
the one finding here worth acting on, and it is a bounds and user-experience question rather than a
language question.

## Decision

**Do not migrate filesystem traversal.** The hot path is already native, and the part still in Node
is a single-level `readdir` that no crate would speed up. Phase 7 as originally framed is largely
already satisfied, not pending.

Remaining work, in order of value:

1. **Characterise the content-index timeout.** Establish how repository size relates to cold-cache
   index time, and decide whether 15 seconds is the right bound, whether the failure should be
   retried or degraded to path-only results, and what the user sees when it trips. This is Phase 7's
   only measured problem.
2. **Inventory watcher behavior for Phase 8.** Debounce, deduplication, batching, and storm
   protection were not audited here. The 27x exclusion result strongly suggests watcher exclusions
   deserve the same scrutiny, since a dependency install touches the same 380,000 files.
3. **Leave `WorkspaceEntries` alone.** Single-directory `readdir` is not worth a native call.

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
