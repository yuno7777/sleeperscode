# Provider abstraction and transport audit

Phase 12 asks for a universal agent provider abstraction with capability negotiation. Phase 13 asks
that the richest reliable machine interface be used per agent, and that the integration mode be
recorded. This is the audit behind both. Captured 2026-08-09.

## Phase 12 is largely already built

The roadmap sketches a Rust `AgentProvider` trait and places Phase 12 behind Phase 11. Neither is
required: the abstraction already exists in TypeScript, and it is a driver SPI rather than a service
tag precisely so many instances of one driver can coexist.

`apps/server/src/provider/ProviderDriver.ts` defines:

| Concept                | Shape                                                                                       |
| :--------------------- | :------------------------------------------------------------------------------------------ |
| `ProviderDriver`       | `driverKind`, `metadata`, `configSchema`, `defaultConfig`, `create`                         |
| `ProviderInstance`     | `instanceId`, `driverKind`, `continuationIdentity`, `snapshot`, `adapter`, `textGeneration` |
| `ProviderAdapterShape` | session and turn operations plus `capabilities` and `streamEvents`                          |

The adapter surface is the "do not force every CLI into a lowest common denominator" part of the
phase, and it is already wide: `startSession`, `sendTurn`, `interruptTurn`, `respondToRequest`,
`respondToUserInput`, `stopSession`, `listSessions`, `hasSession`, `readThread`, `rollbackThread`,
`stopAll`, `streamEvents`.

The registry decodes each driver's config once through `configSchema`, so drivers never handle raw
`unknown`, and every driver declares the infrastructure services it needs through Effect's `R`
channel. `create` owns all per-instance state and releases it when its scope closes.

**Phase 12 does not depend on Phase 11.** The abstraction sits above orchestration and does not care
whether orchestration is TypeScript or Rust, so blocking Phase 11 on bottleneck evidence does not
block this. What Phase 12 was actually missing is capability negotiation: `ProviderAdapterCapabilities`
had exactly one member, `sessionModelSwitch`.

## Phase 13: what each adapter actually speaks

Verified from the imports and session runtimes rather than from documentation:

| Provider    | Machine interface                                 | Implementation                                        | Mode                |
| :---------- | :------------------------------------------------ | :---------------------------------------------------- | :------------------ |
| Claude Code | Official vendor SDK, in-process                   | `@anthropic-ai/claude-agent-sdk`                      | `vendor-sdk`        |
| Codex       | Official app-server protocol over a subprocess    | `effect-codex-app-server` via `CodexSessionRuntime`   | `vendor-app-server` |
| OpenCode    | Official SDK against a managed local server       | `@opencode-ai/sdk/v2` via `makeManagedServerProvider` | `vendor-app-server` |
| Cursor      | ACP over a subprocess, plus `cursor/*` extensions | `effect-acp` via `AcpSessionRuntime`                  | `acp`               |
| Grok        | ACP over a subprocess, plus `_x.ai/*` extensions  | `effect-acp` plus `XAiAcpExtension`                   | `acp`               |

**No adapter scrapes terminal output.** Phase 13's central rule is already satisfied by all five, and
every one of them sits in the top two tiers of the hierarchy the phase describes. That is the
finding: the policy was being followed, it simply was not written down anywhere a machine could read.

## What changed

`ProviderAdapterCapabilities` gains a required `integrationTransport`, declared by each adapter at the
single place it already declares `sessionModelSwitch`. Required rather than optional so a new adapter
cannot quietly omit the decision.

The union lists only the three modes in use. Streaming-CLI, batch-CLI, and terminal-bridge modes are
deliberately absent: adding one should be a visible change to this type, reviewed against Phase 13's
ordering, rather than a value someone can reach for by default.

There is no runtime consumer yet. This is metadata recorded for the Agent Hub and router work that
Phase 13 gates, and it is enforced by the compiler rather than by a test, because it declares a fact
about an adapter rather than changing any behavior.

## Remaining work

- **Capability negotiation is still thin.** Two members describe five adapters that differ in far
  more: which approval kinds they raise, whether they can resume a session, whether they support
  rollback, whether they expose model listing. Each of those is currently discovered by calling and
  handling failure. Widening the type is only worth doing per member, when a caller needs to branch
  on it, rather than as a speculative capability matrix.
- **`probe` and dynamic capability discovery**, which Phase 12 sketches, do not exist as such.
  Provider availability lives in the snapshot and status-cache paths instead. Whether those should be
  unified is an Agent Hub question, not an abstraction question.
- **No adapter declares its extension methods.** Cursor and Grok both speak ACP but with different
  vendor extensions, which the transport mode alone does not capture.

## Limitations

Static audit of the five built-in adapters on one checkout. Transport facts were read from imports
and session runtimes; no live provider was launched, and no vendor documentation was consulted to
confirm that these remain the richest interfaces each vendor offers.
