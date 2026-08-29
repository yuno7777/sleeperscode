# Adaptive router

Sleepers Code records a deterministic routing decision for each new turn. Version 1 runs only in
shadow mode: it explains the effective provider/model and execution requirements, but it cannot
change the user's selection. The contract fixes `mode` to `shadow` and `applied` to `false`, making
accidental activation a schema error rather than a convention.

## Precedence

Selection precedence is intentionally small:

1. a model selection supplied for the current turn is authoritative;
2. otherwise the thread's persisted model selection is authoritative; and
3. the shadow router never overrides either choice.

Project defaults continue to apply when a thread is created. By turn time they are already reflected
in the thread selection, so the router does not need a second fallback chain.

## Candidate context

WebSocket turn dispatch reads the provider registry's current in-memory snapshots. Candidates are
sorted by instance id and bounded to 64. Each candidate retains only its instance id, driver kind,
automatic-routing eligibility, and closed blocker codes. A provider is eligible only when its driver
is available, it is installed, it is not in an error or disabled state, it is enabled, and its auth
state is confirmed as authenticated.

Provider snapshot failures and transports without live registry injection produce a limited empty
context. A limited context yields `insufficient-evidence`; it never claims that no providers exist.
No provider status refresh or vendor process is started on the turn path.

## Decision output

The pure policy records:

- the effective instance and model plus whether it came from the turn or thread;
- the selected provider's eligibility when known;
- all bounded candidates and blocker reason codes;
- a retain-current result, one unranked eligible alternative, no eligible candidate, or insufficient
  evidence;
- required tools and the task profile's collaboration recommendation;
- deterministic review and research requirements; and
- stable, content-free explanation codes.

The decision contains no prompt excerpt, workspace path, credentials, provider identity details, or
manifest content. It is optional on the durable turn-start event so older events and mixed-version
clients continue to decode.

## Explanation surfaces

Every `RouterDecisionReason` has one exhaustive shared mapping to a short label and factual detail.
Web/desktop use a native disclosure in Usage → Router, while mobile shows the primary reason and lets
the user expand the remaining reasons for that decision. Both surfaces consume the same copy, so a
reason cannot silently mean something different between clients. Missing legacy decisions remain
labeled as missing evidence rather than receiving a fabricated explanation.

The explanations describe recorded inputs and policy branches only. They do not claim causality,
provider quality, cost savings, or that shadow mode changed execution.

The task-run projection described in
[`task-outcome-attribution.md`](./task-outcome-attribution.md) now binds that decision to the
provider's concrete turn id and content-free terminal state. A provider-completed state is lifecycle
evidence, not a correctness or quality label.

## Deliberate limits

Version 1 does not rank multiple eligible providers, choose another model, use provider-brand priors,
estimate cost or latency, or activate collaboration. Those behaviors require independent quality
evidence, pricing/usage reconciliation, user modes, and override semantics. Terminal provider states
alone cannot calibrate them. Until that evidence exists, a fixed score table would turn assumptions
into product behavior and violate the roadmap.

Environment HTTP dispatch currently records a limited-context shadow decision; WebSocket dispatch
has the live candidate set. Automatic routing must not be enabled until every command transport has
equivalent server-owned context and the decision policy passes outcome-backed evaluation.
