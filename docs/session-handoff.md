# Session handoff

Written 2026-08-09 for the next agent picking up this repository.

## Git state

- Branch `main`, worktree clean, **nothing pushed**, zero releases.
- Base upstream commit: `45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b`
- New substantive commits: **184** (this session added 50, from `8d69b87ba` to `2368fef95`)
- Remotes: `origin` → `yuno7777/sleeperscode`, `upstream` → `pingdotgg/t3code`
- **11 commits behind `upstream/main`, and the merge is currently clean** (`git merge-tree` exits 0).

## Read first

`AGENTS.md`, then `docs/sleepers-code-roadmap.md`. If touching Effect code, read
`.repos/effect-smol/LLMS.md` completely.

## Toolchain

Node 24 is required and is not the machine default. Prepend before any command:

```powershell
$repoBin=(Resolve-Path '.\node_modules\.bin').Path
$runtimeBin='C:\Users\Abhishek Satarkar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$env:PATH="$repoBin;$runtimeBin;$env:PATH"
```

Run benchmark scripts with `node scripts/<name>.mjs` directly. Do **not** use `pnpm bench:*` after
editing `package.json`: the wrapper attempts a dependency refresh and times out on uncached optional
Anthropic platform packages.

## What this session changed

### Product code (5 changes)

| Change                             | Files                                                                 | Note                                               |
| :--------------------------------- | :-------------------------------------------------------------------- | :------------------------------------------------- |
| Checkpoint index cache             | `apps/server/src/vcs/GitVcsDriver.ts`                                 | 59x faster capture at 15,000 files                 |
| Integration transport per adapter  | `provider/Services/ProviderAdapter.ts` + all 5 adapters               | Required field, compiler-enforced                  |
| Agent status levels                | `packages/contracts/src/server.ts`                                    | `deriveAgentStatusLevels`                          |
| Agent health / routing eligibility | `packages/contracts/src/server.ts`                                    | `summariseAgentHealth`, `selectRoutableAgents`     |
| Local model support                | `packages/contracts/src/localModel.ts`, `apps/server/src/localModel/` | Ollama, LM Studio, OpenAI-compatible               |
| ACP agent registry                 | `packages/contracts/src/agentRegistry.ts`                             | Decoder + install-safety gate + platform selection |

### New tests

- `apps/server/src/vcs/GitCheckpointCapture.test.ts` — 5 tree-oid differential cases
- `apps/server/src/localModel/LocalModelDiscovery.test.ts` — 8 cases
- `packages/contracts/src/localModel.test.ts` — 14 cases
- `packages/contracts/src/agentRegistry.test.ts` — 19 cases
- `packages/contracts/src/server.test.ts` — +13 cases
- `apps/server/src/provider/acp/AcpJsonRpcConnection.test.ts` — +2 slow-consumer cases

### New benchmarks (`package.json` scripts added)

`benchmark-server-startup.mjs`, `benchmark-git-operations.mjs`, `benchmark-workspace-scan.mjs`,
`benchmark-content-index.mjs`, `benchmark-checkpoint-capture.mjs`. Existing
`benchmark-provider-concurrency.mjs` gained interleaving.

### New docs

`docs/git-runtime-audit.md`, `docs/filesystem-runtime-audit.md`, `docs/file-watcher-inventory.md`,
`docs/checkpoint-engine-audit.md`, `docs/provider-abstraction-audit.md`,
`docs/secret-handling-audit.md`, `docs/decisions/005-native-git-runtime-retained.md`,
`docs/decisions/006-agent-catalog-from-acp-registry.md`.

## Findings that should change what you do next

1. **Process launch is the dominant cost on this host, not any library.** `git --version` costs ~38 ms.
   `rev-parse --git-common-dir` spends 0.95 ms of actual Git work inside a 38.77 ms call. Native Git
   stays (ADR 005). The same logic blocks Phase 11.
2. **ADR 005 is the governing rule**: migrate a component only once profiling implicates _that_
   component.
3. **Never compare two backends as two separate invocations.** That pattern manufactured a 1.2 s gap
   that vanished on re-measurement. Both harnesses now interleave variants inside one run.
4. **Checkpoint capture re-hashed the whole worktree every turn** because `read-tree HEAD` discards
   Git's stat cache. Fixed with a HEAD-stamped index cache that falls back on any staleness or
   corruption. Gated on tree-oid equality tests.
5. **Server startup memory is provider CLI probing**, not the server: 606 MiB–1,070 MiB transient from
   overlapping 200–320 MiB CLI probes, settling to 175–180 MiB.
6. **There is no workspace file watcher at all** — Phase 8's storm protection has no target.
7. **The ACP registry exists and is authoritative**
   (`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`), carries typed
   distributions with sha256, and **mixes vendor and community publishers without labelling them**.
   Trust tiers cannot be derived from it (ADR 006).
8. **Upstream already built the usage ledger** (tokens, cost, day buckets) in the 11 commits we are
   behind. That is the dataset the router phases need.

## Verification state (all green at handoff)

- Typechecks: contracts, server, web, desktop, mobile, shared, client-runtime — **7/7 clean**
- New suites: **65 passed**; regression sweep: **64 passed**
- Rust: `cargo fmt --check` clean, sidecar suite **25 passed**
- Secret scan over all 184 commits: clean

**Four tests fail on a clean checkout, pre-existing and unrelated to this work** (verified by
stashing): `detects repository identity inside a repository and nested directories`, `backs off failed
upstream refreshes across linked worktrees`, `preserves newline characters in worktree paths when
listing refs`, and one `CheckpointReactor` revert test.

## Recommended next steps, in order

1. **Merge `upstream/main`** while it is still clean. Brings the usage ledger and unblocks Phases
   32–38 and 60–70.
2. **Phase 95** — custom provider executable paths. PATH machinery already exists in
   `packages/shared/src/shell.ts`; the gap is persistence, and it touches all five providers.
3. **Usage for Cursor, Grok, OpenCode** — upstream covers only claude and codex.
4. **Bound concurrent provider probes** — the measured startup transient.
5. **Git metadata without launching Git** — 7 call sites; edge cases enumerated in the Git audit
   (detached HEAD, worktree `gitdir:` pointers, symbolic refs outside `refs/heads`). Needs
   differential tests before replacing any call site.
6. **Redaction tests at the six emitting boundaries** listed in `docs/secret-handling-audit.md`.

## Hard constraints

- Do **not** push. Do **not** create a release. Do **not** open a PR unless asked.
- Do not run repo-wide checks (`vp check`, `vp run -r test`). Focused only.
- Never kill a process by name or pattern; only an exact PID you captured at spawn.
- Do not point dev servers at `~/.t3/userdata`; use the repo's isolated `.t3`.
- Do not set `VITE_HTTP_URL` or `VITE_WS_URL`.
- Rust-only commits may need `--no-verify` because the hook runs `vp fmt` with no applicable target;
  only after `cargo fmt --check` and the Rust tests pass.
- Browser/computer use requires the user's explicit permission.

## Phases that cannot progress in this environment

Certificate (100), VM or Windows Sandbox (99), publishing rights (102), browser permission (28, 54,
55), real provider credentials (3), Antigravity CLI (17–19), and the router block (32–38, 59–70)
which needs a real task-outcome corpus rather than invented constants.
