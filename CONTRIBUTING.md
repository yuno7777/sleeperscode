# Contributing to Sleepers Code

Sleepers Code is an open-source fork of T3 Code. Contributions are welcome when they are focused,
measurable, and preserve the product's web, desktop, mobile, remote, and provider compatibility.

## Before you start

1. Read [`AGENTS.md`](./AGENTS.md). It documents the architecture, safety boundaries, terminology,
   and focused verification rules used in this repository.
2. Search existing issues before filing a new one.
3. Open an issue before starting a large feature, architectural change, new dependency, provider,
   or wire-contract change. A discussion is not a promise that a pull request will be accepted.
4. Report vulnerabilities through the private process in [`SECURITY.md`](./SECURITY.md), never in a
   public issue, log dump, screenshot, or pull request.

Small reliability, correctness, performance, accessibility, documentation, and test improvements are
the easiest changes to review. Keep one concern per pull request.

## Development setup

Use Node 24 and Vite+. The full, platform-aware instructions and verified commands live in the
[source-build runbook](./docs/operations/source-build.md).

```bash
git clone https://github.com/yuno7777/sleeperscode.git
cd sleeperscode
vp i
vp run dev
```

Development uses isolated repository-local `.t3` state. Never point a development server at another
running installation's writable data directory.

## Making a change

- Preserve compatibility-sensitive identifiers such as the `t3` CLI, URL schemes, environment
  variables, app IDs, wire contracts, and existing data paths unless a reviewed migration exists.
- Put wire changes in `packages/contracts`, shared client behavior in `packages/client-runtime`, and
  provider-specific complexity at the provider adapter boundary.
- Consider every applicable surface: web, desktop, mobile, local/remote connections, reverse actions,
  documentation, and each affected provider.
- Do not commit credentials, pairing tokens, provider transcripts, private repository content,
  generated userdata, or release signing material.
- Do not manufacture commits, tests, metrics, screenshots, or release evidence.

## Verification

Run the smallest checks that prove the behavior you changed. Examples:

```bash
vp test run path/to/changed.test.ts
vp lint path/to/changed.ts --report-unused-disable-directives
tsgo --noEmit -p path/to/affected/tsconfig.json
```

Backend behavior changes need focused tests. User-visible changes should include before/after images;
motion or timing changes need a short recording. Do not claim a broad check passed when only a narrow
test ran. Repository-wide checks belong to CI unless a maintainer explicitly requests them.

Before opening a pull request, also run:

```bash
vp run audit:open-source
```

## Pull requests

Use a conventional, plain-language title such as `fix(web): reconnect without losing the draft`.
In the body, explain the problem, the chosen fix, validation performed, known limitations, and the
model or harness used for agent-authored work. Keep unrelated changes separate.

Pull requests receive automated size and contributor-trust labels. These labels help triage; they are
not endorsements and do not replace source review.

By contributing, you agree that your contribution is licensed under this repository's
[MIT License](./LICENSE). Preserve upstream and third-party notices.
