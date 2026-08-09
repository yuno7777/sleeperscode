# Session handoff

Audited 2026-08-09 after reviewing the Claude continuation that followed commit `8d69b87ba`.

## Git state

- Branch: `main`.
- Fork base: `45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b`.
- `origin`: `https://github.com/yuno7777/sleeperscode.git`; `origin/main` exists. Verify
  divergence immediately before any push.
- `upstream`: `https://github.com/pingdotgg/t3code.git`.
- Latest fetched upstream in this handoff: `1a003e383`; it is already an ancestor of this branch.
- At audit time nothing had been pushed and no release had been created. Verify remote state rather
  than assuming this remains true.

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

These began as incremental scaffolding and optimizations. Registry fetching and read-only Agent Hub
surfaces are now wired into web, desktop, and mobile. Agent installation, adaptive routing, and
local-model execution are not wired into product flows yet.

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

## Best next engineering work

1. Qualify the read-only Agent Hub in a real web/desktop client and on a mobile device after explicit
   browser/device permission.
2. Design the human-reviewed publisher allowlist required for registry trust levels. Do not infer
   endorsement from the ACP feed.
3. Build the installer executor around explicit consent, prerequisite detection, isolated staging,
   SHA-256 verification, atomic activation, and rollback. Keep package-manager execution gated until
   an equally auditable policy exists.
4. Add non-secret auth and health probes for catalog agents before exposing any route/start action.
5. Reconcile the usage ledger with routing phases without inventing quality scores.
6. Add redaction tests at the emitting boundaries listed in `docs/secret-handling-audit.md`.

## Hard constraints

- Never kill by name or pattern; only a PID captured at spawn.
- Never run against the live `~/.t3/userdata`; use isolated worktree state.
- Do not set `VITE_HTTP_URL` or `VITE_WS_URL` in development.
- Do not delete TypeScript/Node fallbacks until replacements pass differential tests and benchmarks.
- Browser/computer use requires explicit permission.
- No release until packaging and release-specific validation are complete.
