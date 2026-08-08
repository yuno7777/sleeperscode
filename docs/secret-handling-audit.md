# Secret handling audit

Phase 78 asks for secret fixture scans and redaction conventions before any release. Phase 27 adds
that provider tokens must never be copied into telemetry and that raw passwords are never stored.
Captured 2026-08-09 at fork commit 177.

## Credential scan

Two scans over high-signal credential shapes: OpenAI-style `sk-`, GitHub `ghp_`/`github_pat_`, Slack
`xoxb-`, AWS `AKIA`, Google `AIza`, and PEM private-key headers.

| Scope                                                   | Matches |
| :------------------------------------------------------ | ------: |
| The fork's 177 commits (`git diff base..HEAD`)          |   **0** |
| All tracked files, excluding lockfiles                  |      21 |
| Of those, inside `.repos/` vendored upstream references |      21 |
| Of those, anywhere else in the repository               |   **0** |

The 21 matches are self-signed certificates and key fixtures inside `.repos/alchemy-effect`, which is
vendored read-only reference material that `AGENTS.md` forbids editing or importing from. They are
that project's own AWS test fixtures, not credentials belonging to this repository or its users.

Nothing this fork added introduces a credential shape, which is the result Phase 78 needs before a
release.

## Where secrets are handled

Redaction is not centralised in one helper; it lives at the boundaries that emit text:

| Location                                | Concern                                     |
| :-------------------------------------- | :------------------------------------------ |
| `serverSettings.ts`                     | Settings persistence and its emitted values |
| `observability/Layers/Observability.ts` | What reaches traces and logs                |
| `terminal/Manager.ts`                   | Terminal output                             |
| `relay/AgentAwarenessRelay.ts`          | Data leaving over the relay                 |
| `cloud/ManagedEndpointRuntime.ts`       | Managed endpoint configuration              |
| `ws.ts`                                 | The client-facing socket boundary           |

Provider credentials themselves are not held by this application. Each provider CLI owns its own
authentication, and `ServerProviderAuth` records only a status, an optional type, label, and email.
That is the arrangement Phase 27 asks for: Sleepers Code orchestrates authentication and probes its
result rather than taking custody of it.

## What this does not establish

The scan proves no credential-shaped literal was committed. It does not prove secrets cannot escape at
runtime, which is a different question and the one still open:

- No test asserts that a provider token appearing in provider output is redacted before it reaches
  logs, traces, or the relay. The redaction sites above are conventions, not enforced invariants.
- The scan covers known credential prefixes. A bare high-entropy token with no recognisable prefix
  would pass it.
- `.repos/` is excluded from judgement rather than cleaned, on the basis that it is vendored and
  read-only. If vendored material is ever shipped in a package, that assumption needs revisiting.

Closing those needs a redaction test at each emitting boundary, which is the natural next step and is
worth doing before the first release rather than after.
