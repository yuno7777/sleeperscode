# Security policy

## Supported versions

Sleepers Code is currently an unsigned alpha built from `main`. Security fixes are applied to the
latest source and the next validated artifact; older local builds are not maintained as separate
release lines.

## Reporting a vulnerability

Do not disclose vulnerability details in a public issue, discussion, pull request, screenshot, trace,
or provider transcript.

Use GitHub's private vulnerability-reporting form:

<https://github.com/yuno7777/sleeperscode/security/advisories/new>

Include the affected commit or artifact, platform, impact, minimal reproduction, and any suggested
mitigation. Remove credentials, pairing tokens, provider prompts, private repository content, and
unrelated logs.

If GitHub does not offer the private form to your account, open a public issue titled
`Security contact requested` with no vulnerability details. A maintainer can then arrange a private
channel. Public issues containing exploit details or secrets may be removed to protect users.

## Response expectations

The project will acknowledge a private report when a maintainer is available, validate it against the
current branch, and coordinate a fix and disclosure appropriate to the impact. This alpha does not
promise a fixed response-time SLA. Please allow a reasonable remediation window before disclosure.

## Scope

Reports are useful when they affect Sleepers Code code, bundled runtime components, authentication,
pairing, remote access, installer/update behavior, provider isolation, or local data boundaries.
Provider CLIs, hosted services, and third-party MCP servers retain their own security programs unless
the issue is caused by how Sleepers Code integrates them.
