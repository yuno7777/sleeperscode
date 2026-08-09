# ADR 006: Source the agent catalog from the ACP registry, and separate verifiability from trust

Status: accepted

## Context

Phases 16 and 20 call for an agent catalog and a declarative manifest registry, with Phase 23 warning
that install facts drift and must be verified live, and Phase 24 requiring that installation never
means downloading an arbitrary script and hoping.

The Agent Client Protocol project publishes a machine-readable registry of agents that implement the
protocol at `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`, refreshed
continuously. Verified on 2026-08-09, it carries `version` and `agents`, and each agent carries `id`,
`name`, `version`, `description`, `repository`, `authors`, `license`, `icon`, and a `distribution`
object keyed by delivery mechanism: `npx`, `uvx`, and `binary` keyed by platform triple with
`archive`, `cmd`, optional `args`, optional `env`, and optional `sha256`.

Two facts about that feed shaped this decision.

It already answers Phase 21's requirement that install methods be typed data rather than arbitrary
command strings, and Phase 24's requirement that downloads be checksum-verifiable, since binary
artifacts publish a SHA-256.

It also mixes trust levels without labelling them. `claude-acp` lists Anthropic, Zed Industries, and
JetBrains as authors and lives under the ACP organisation. `amp-acp` is an Apache-2.0 community
wrapper under an individual's personal GitHub account. Both are equally present in the same list.

## Decision

Source the catalog of ACP-capable agents by decoding the published registry rather than hand-keeping
a list. A hand-kept list of third-party CLIs is exactly what Phase 16 warns will go stale, and
Phase 23's "do not blindly trust this roadmap's install commands months later" applies with equal
force to any list we write ourselves.

Decode it defensively. Entries this build cannot decode are dropped instead of failing the payload,
and unmodelled top-level keys are ignored, because the feed grows without our involvement. This is
the same rule the rest of these contracts already apply to growing server-to-client arrays.

**Separate "can these bytes be verified" from "is this publisher trustworthy."**
`deriveAcpInstallSafety` answers only the first. HTTPS archives carrying a well-formed SHA-256 are
checksum-verifiable; `npx`/`uvx` package names are not, because the package resolves at install time
with nothing to check beforehand; a malformed digest counts as no digest. Safety is evaluated after
platform selection, so unrelated platform artifacts and lower-priority fallbacks cannot change the
classification of the distribution that would actually run.

Nothing infers vendor endorsement from registry membership. A checksum proves a download matches what
its publisher uploaded and says nothing about who that publisher is. Deciding that an entry is the
agent's official distribution is a separate judgement, and the registry does not carry the field that
would let code make it.

## Consequences

- Phase 16's catalog stops being a maintenance burden and a source of invented entries.
- Phase 21 gets typed install methods for free, from the publisher rather than from us.
- Phase 24's checksum gate exists as data validation with tests, ahead of any installer.
- Phase 25's trust tiers cannot be derived from this feed alone. Distinguishing official from
  community entries needs a signal the registry does not publish, so built-in trust must come from a
  Sleepers-maintained allowlist keyed by agent id, reviewed by a human, and not from the feed.
- Nothing installs anything yet. This is the contract and the gate; the installer that consumes them
  is still to be built, and must refuse any entry whose safety says it cannot be verified unless the
  user explicitly initiates that specific install.
- The registry is a network dependency at runtime. The shared server service caches successful
  snapshots for 15 minutes and falls back to the last good copy rather than emptying the catalog.
