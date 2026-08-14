# Session handoff

Audited 2026-08-09 after reviewing the Claude continuation that followed commit `8d69b87ba`.

## Git state

- Branch: `main`.
- Fork base: `45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b`.
- `origin`: `https://github.com/yuno7777/sleeperscode.git`; `origin/main` exists. Verify
  divergence immediately before any push.
- `upstream`: `https://github.com/pingdotgg/t3code.git`.
- Latest fetched upstream in this handoff: `1a003e383`; it is already an ancestor of this branch.
- The branch is 245 commits past the recorded fork base before the current client/documentation
  commits. Do not manufacture history to target an older numeric range. Remote push/release state
  was not refreshed during this local continuation, so verify it immediately before publishing.

## Read first

Read `AGENTS.md` and `docs/sleepers-code-roadmap.md`. Before changing Effect code, read
`.repos/effect-smol/LLMS.md` completely. Use focused tests only; do not run repo-wide checks.

Node 24 is required. Prepend the repository bin plus the bundled runtime paths:

```powershell
$repoBin=(Resolve-Path '.\node_modules\.bin').Path
$runtimeBin='C:\Users\Abhishek Satarkar\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$runtimeOverride='C:\Users\Abhishek Satarkar\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\override'
$runtimeFallback='C:\Users\Abhishek Satarkar\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback'
$env:PATH="$repoBin;$runtimeBin;$runtimeOverride;$runtimeFallback;$env:PATH"
```

Run benchmark scripts directly with `node scripts/<name>.mjs`. Do not invoke their package scripts
when that would trigger an unnecessary dependency refresh.

## What the Claude continuation added

- A HEAD-stamped checkpoint index cache.
- Provider integration-transport metadata.
- Agent registry, distribution selection, and install-safety contracts.
- Agent integration/routing status helpers.
- Ollama, LM Studio, and OpenAI-compatible model discovery scaffolding.
- ACP high-volume and late-consumer regressions.
- Five benchmark harnesses and runtime audit documents.

These began as incremental scaffolding and optimizations. Registry fetching is wired into web,
desktop, and mobile. Adaptive routing and local-model execution are not wired into product flows.

## Current Agent Hub installation slice

- `15bc89d3f` adds the server-owned secure binary installer: fresh-plan revalidation, explicit
  unverified-publisher consent, HTTPS and SHA-256 enforcement, bounded downloads, archive safety,
  isolated staging, atomic activation, rollback, and confirmed uninstall.
- `087521b8b` registers installed binaries as dynamic generic ACP provider instances. Their auth
  state stays `unknown`, they never become automatically routable, and unsupported auth/model/text
  generation behavior fails honestly instead of borrowing Cursor identity.
- `8d8a956fb` adds a bounded, managed ACP protocol health probe. It sends only `initialize`, never
  authenticates or creates a session, and preserves `unknown` auth even when the handshake passes.
- `2f57689c8` records in-memory authentication evidence only after a real manually selected ACP
  session starts. A failed later startup clears the evidence; no credential or account identity is
  stored.
- Web/desktop and mobile now expose exact-plan review, streamed progress, installed state, and
  uninstall. Package-manager execution remains intentionally disabled.
- Package entries now carry environment-owned PATH evidence for their complete runtime pair:
  `node` plus `npx`, or `uv` plus `uvx`. Both clients distinguish ready, missing, and not checked;
  older server snapshots degrade to not checked instead of guessing.
- Every new turn now receives a versioned, deterministic task profile before provider startup. The
  profile records bounded domain/complexity scores, tool and verification needs, security level,
  coarse scope, and conservative collaboration guidance without storing prompt excerpts or changing
  the user's selected provider.
- Turn normalization now enriches that profile with cached, root-only repository markers, languages,
  frameworks, test runners, and workspace shape. The profiler performs no recursive traversal, caps
  manifest reads at 128 KiB, stores no paths or manifest text, and ignores forged client evidence.
- WebSocket turns now retain a deterministic shadow routing decision. Turn overrides beat thread
  selections; provider eligibility uses live registry blockers; multiple healthy providers remain
  unranked; and the versioned contract fixes `applied: false`, so no provider/model behavior changes.
- A durable local task-run projection now binds each normal turn's task profile and shadow decision
  to its provider turn id and terminal state. It stores no prompt, path, provider error text, usage
  payload, or inferred success/quality label; no router behavior consumes it yet.
- A bounded, read-only task analytics RPC now exposes that content-free evidence to web/desktop and
  mobile. The Usage page has Overview, Tasks, and Router views, deduplicates identical local stores,
  and labels completion as lifecycle rather than quality; routing remains shadow-only.
- Web/desktop and mobile now require explicit confirmation before clearing local task/router history.
  The operate-scoped RPC deletes only the content-free projection, and migration 42 retains a replay
  cutoff so cleared evidence stays cleared without changing conversations or usage transcripts.
- Authenticated web/desktop hosts now have a persisted Sleepers Code first-run guide. It performs a
  real provider refresh, distinguishes installation/auth/routing state, links into Agent Hub, and can
  be reopened from Agent Hub. Hosted relay clients and mobile intentionally keep their connection-led
  onboarding because agent discovery belongs to the connected server host.
- Release versioning now updates seven product/native manifests plus both Cargo locks in one command.
  The release workflow commits those native changes, so locked builds cannot silently package a Rust
  helper with a stale product version. The cross-platform release smoke no longer depends on Bash
  understanding Windows filesystem paths when merging updater manifests.

## Confirmed Claude mistakes and corrections

1. `package.json` carried a UTF-8 BOM and failed direct `JSON.parse`; removed in `a40b99d07`.
2. The Git benchmark contained a literal NUL, swallowed Git failures, used a fixed order while
   claiming alternation, and could report over 100% launch share; fixed in `2246d41ba`.
3. Four other benchmark harnesses also claimed interleaving while always using a fixed order; fixed
   in `a2b3f2526`. The checkpoint harness now reports the correct process-launch count per variant.
4. The checkpoint cache was shared by every project root in one repository. A nested project could
   silently inherit out-of-scope staged entries from a root project. A differential regression first
   reproduced the unequal tree OIDs; the cache is now scoped by resolved project root in
   `f420759f8`.
5. The ACP “stalled consumer” test counted raw byte chunks, including startup traffic, and inferred
   queue backpressure from an unfinished long prompt. It now makes only the valid late-consumer
   losslessness claim, and the unmeasured saturation gate is explicit (`280df77cb`).
6. ACP install safety was calculated across every platform and fallback instead of the selected
   distribution. It now classifies only what would actually run (`135254380`).
7. A provider with `enabled: true` but runtime `status: "disabled"` was considered routable. Both
   disabled signals now block routing (`7f6e584b4`).
8. Local-model discovery accepted malformed and non-HTTP URLs despite claiming a never-failing
   effect. It now validates and returns `invalid_base_url` without issuing a request (`ba4312bd7`).
9. The startup benchmark could wait 60 seconds after an early server exit and had a listener race
   during cleanup. It now races readiness/idle sampling against the captured exit promise
   (`8af1cf047`).
10. The first Agent Hub UI called a checksum-providing binary "verified" and named host-compatible
    filtering after Windows. Shared cross-client logic now says "checksum available" and filters by
    the selected environment's compatible distribution without implying prior verification.
11. Registry website and repository strings were passed directly to a browser link. Agent Hub now
    exposes only well-formed HTTP or HTTPS URLs and safely falls back from an invalid website to the
    repository.

## Verification

- Current Agent Hub client continuation: **21 tests passed across 2 files**.
- Client-runtime, web, and mobile typechecks pass. Client-runtime reports one unrelated existing
  Effect suggestion in `relay/discovery.ts`.
- The web production build passes after adding the install and uninstall surfaces. Existing bundle
  size and resolver timing warnings remain.
- The preceding installer/provider slice passed AgentInstaller, ACP runtime/adapter, dynamic-driver,
  and provider-registry focused tests plus the server typecheck.
- The generic ACP health slice passes **30 tests across 2 files** and the real `t3` server typecheck;
  only unrelated existing Effect suggestions remain.
- Live prerequisite detection passes **40 tests across 3 files**. Contracts, client-runtime, server,
  web, and mobile typechecks pass, and the web production build passes with the existing bundle-size
  and resolver-timing warnings.
- Task-profile contracts, classifier fixtures, root profiler/cache, command normalization,
  turn-event integration, and the focused decider regression pass **115 tests across 13 files**;
  contracts, shared, and server typechecks pass with only unrelated existing Effect suggestions,
  and the production server bundle builds.
- Task-outcome contracts, migration, repository roundtrip, projection integration, decider, and
  provider-ingestion regressions pass their focused suites. Contracts, shared, client-runtime,
  server, web, and mobile typechecks pass; only the existing Effect suggestions remain.
- Task/router analytics contracts, merge, zoned-window repository/service, and cross-environment
  deduplication have focused coverage. Browser/device visual validation remains a release gate.
- Task analytics deletion is covered at the contract, migration, repository, service, and
  authorization boundaries; automated UI checks must open but not confirm the destructive dialog.
- First-run eligibility, factual provider summaries, and readiness ordering pass focused tests. The
  controlled browser verified welcome, provider scan, completion persistence, reopening, Agent Hub
  handoff, compact layout, and zero console errors against the isolated worktree server.
- Release version synchronization passes 15 focused cases across semantic-version validation,
  package manifests, Cargo manifests, Cargo locks, CLI output, and failure context. Root and
  resource-monitor locked Cargo checks pass,
  scripts typecheck passes, and the complete release smoke passes on Windows.
- Contracts typecheck: passed.
- Server typecheck: passed. Only pre-existing Effect suggestions remain.
- Focused release-candidate regression: **134 tests passed across 9 files**.
- Checkpoint differential suite: **6 passed**, including nested-root contamination and corrupt-cache
  fallback.
- ACP file: Node and Rust coverage passed, including both late-consumer cases.
- Four benchmark scripts plus the startup harness pass `node --check`; the checkpoint benchmark also
  completed a minimal synthetic run.
- No browser/computer-use validation was performed because permission was not requested.
- No packaging run was performed in this audit.

## Upstream and push rule

Upstream has already been integrated. Do not manufacture commits to satisfy an old numeric target;
create only substantive conventional commits. Before any push, verify focused tests, inspect staged
content, scan it for secrets, and re-check the current remote divergence.

Do not create a release yet. A release still needs packaging evidence and a deliberate release note;
the user asked for fewer than six releases, not for speculative releases during development.

## Portable Windows milestone (refreshed 2026-08-15)

- The production bundle and portable builder produced
  `release/Sleepers-Code-0.0.32-x64-portable.exe`; the successful refreshed packaging pass took
  742.2 seconds.
- The refreshed artifact is 121,546,894 bytes. Its independently calculated SHA-256 is
  `c081a2ace5cc4542620ae591d366bcfcc0d03f06c0ce0619c736ec038aec9241`, matching
  `release/SHA256SUMS.txt`.
- The packaged app launched on the development Windows host and created sibling
  `Sleepers-Code-Data/desktop` and `Sleepers-Code-Data/userdata` directories. Its Electron window
  responded and the bundled server returned HTTP 200 on `127.0.0.1:3773`; the app was left open.
- Portable mode does not redirect `HOME` or `APPDATA`; provider CLIs and authentication remain in
  their normal locations. `T3CODE_HOME` remains an explicit override.
- The affected desktop and packaging suites pass 62 tests across four files; desktop and scripts
  typechecks pass. Clean-machine move, restart, provider, WSL, and removal qualification remain open.

## Best next engineering work

1. Qualify Agent Hub install, progress, cancellation, and uninstall in a real web/desktop client and
   on a mobile device after explicit browser/device permission.
2. Design the human-reviewed publisher allowlist/signature policy required for stronger registry
   trust levels. Do not infer endorsement from the ACP feed.
3. Design an auditable package-manager execution policy before enabling `npx` or `uvx`; live PATH
   detection alone is not an installation safety boundary.
4. Decide whether successful-session auth evidence should persist, expire, or remain deliberately
   process-local before enabling unattended routing.
5. Reconcile the usage ledger with routing phases without inventing quality scores.
6. Add redaction tests at the emitting boundaries listed in `docs/secret-handling-audit.md`.
7. Reconcile terminal task-run evidence with usage records, then design an explicit human-evaluation
   signal before calibrating Phase 33 scores. Do not activate routing from provider-brand priors or
   treat terminal completion as a quality claim.

## Hard constraints

- Never kill by name or pattern; only a PID captured at spawn.
- Never run against the live `~/.t3/userdata`; use isolated worktree state.
- Do not set `VITE_HTTP_URL` or `VITE_WS_URL` in development.
- Do not delete TypeScript/Node fallbacks until replacements pass differential tests and benchmarks.
- Browser/computer use requires explicit permission.
- No release until packaging and release-specific validation are complete.
