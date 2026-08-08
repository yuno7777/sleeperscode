# File watcher inventory

Phase 8 asks for debounce, deduplication, batching, bounded queues, and storm protection on file
watching, so that "a large dependency install" cannot flood the UI with redundant messages. This is
the inventory of what actually watches files today. Captured 2026-08-09.

## There is no workspace file watcher

Nothing watches the user's project tree. `fs.watch` appears in exactly three places in the server,
none of them pointed at a workspace:

| Location                                      | Watches                   | Debounced       |
| :-------------------------------------------- | :------------------------ | :-------------- |
| `apps/server/src/serverSettings.ts:532`       | the settings directory    | Yes, 100 ms     |
| `apps/server/src/keybindings.ts:592`          | the keybindings directory | Yes, 100 ms     |
| `apps/server/src/vcs/GitVcsDriverCore.ts:587` | a single trace file       | No, single file |

Both config watchers filter to the one file they care about before debouncing, with the comment that
editors emit several events per save (truncate, write, rename) and `fs.watch` can fire before content
is flushed.

**The storm scenario Phase 8 guards against cannot occur.** A dependency install writes into
`node_modules`, and nothing is subscribed to it. There is no watcher to debounce, no event queue to
bound, and no flood to protect the UI from.

## Freshness is explicit refresh, not observation

The workspace search index is kept current by being told to rescan, from two places:

| Trigger                                               | When                                     |
| :---------------------------------------------------- | :--------------------------------------- |
| `orchestration/Layers/CheckpointReactor.ts` (2 sites) | After a turn's checkpoint                |
| `workspace/WorkspaceFileSystem.ts:296`                | After a `projectsWriteFile` RPC succeeds |

`WorkspaceEntries.refresh` has two properties worth recording:

**It is a no-op unless an index is already live.** It checks `RcMap.has` per variant and skips
anything not currently held. A user who has never opened the file picker or content search pays
nothing for either trigger.

**A failed refresh invalidates rather than propagates.** Create failures, scan timeouts, and refresh
failures are logged as warnings and the index entry is dropped, so the next consumer rebuilds it.
Refresh cannot wedge the workspace.

## The cost, and the one risk

When an index is live, refresh is a full rescan, not an incremental update. From
`docs/filesystem-runtime-audit.md`, on this monorepo that is roughly 125 ms for the path-only index
and 330-430 ms for the content index.

There is no coalescing on `refresh`. N writes in quick succession produce N full rescans of every
live index. Today that is bounded by how the triggers work: checkpoint refresh happens once per turn,
and `projectsWriteFile` is a client save, so writes arrive one user action at a time. A client that
issued bulk writes would amplify directly, at the per-rescan cost above.

If that ever shows up, the fix is a debounce on `refresh` keyed by workspace root — the same 100 ms
pattern the two config watchers already use. It is not worth adding before there is a caller that
needs it.

## What Phase 8 should become

The phase as written targets a watcher that does not exist. The applicable subset is small:

1. **Nothing to do on storm protection, batching, or bounded queues.** No watcher, no storm.
2. **Coalescing on `refresh`** is the only real item, and it is currently unjustified.
3. **If a workspace watcher is ever introduced**, the exclusion result from the filesystem audit
   applies directly: excluding `node_modules`, `.git`, `dist`, and `target` is the difference between
   15,873 and 382,502 files in this repository. A watcher without exclusions would be the storm Phase
   8 is worried about; the current architecture avoids it by not watching at all.

## Limitations

Static inventory of the server only. Desktop and mobile were not searched for their own watchers, and
Vite's dev-server watching is out of scope because it does not run in a shipped build. No runtime
measurement of refresh frequency during a real agent session.
