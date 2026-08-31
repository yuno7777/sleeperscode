# Using Antigravity

Sleepers Code can run the official Antigravity CLI as a full provider through its documented
non-interactive stream-JSON interface. Install it on the computer that runs the Sleepers Code
environment, complete sign-in by running `agy`, and verify setup with:

```bash
agy --version
agy models
```

The provider is detected automatically when `agy` is on the server's `PATH`. If it is installed in
another location, set **Settings → Providers → Antigravity → Binary path** to the command name or
absolute server-side path.

## Web research

Antigravity reports its available tools at the start of every headless session. When that inventory
contains `search_web` or `read_url_content`, Sleepers Code records those calls as web-research items
in the thread instead of treating them as unknown generic tools. Tool availability is determined
from the active CLI session, so the UI does not claim web access when the installed version or agent
does not advertise it.

See the official [Antigravity CLI overview](https://www.antigravity.google/product/antigravity-cli) and
[headless-mode documentation](https://antigravity.google/docs/cli/headless) for the upstream command
and protocol.

## Sessions and models

- Models come from `agy models` when the CLI can return its inventory non-interactively and remain
  selectable in web, desktop, and mobile clients. On Windows, where that command currently requires
  a terminal, Sleepers Code provides a conservative verified fallback model and supports custom
  models in Settings.
- Conversation IDs returned by Antigravity are retained so an existing thread can resume.
- Plan mode maps to Antigravity's `--mode plan` option.
- Reasoning effort is part of Antigravity model slugs such as `gemini-3.7-flash-high`. Sleepers Code
  does not also pass `--effort`, because the CLI rejects combining it with an explicit model.
- Attachments are not offered because the documented headless interface accepts text prompts, not
  Sleepers Code attachment records.

## Usage totals

The Usage page records the token totals returned by Antigravity for turns run through Sleepers Code.
Those totals survive normal server restarts and appear under the selected Antigravity model. Sessions
run directly in another terminal are not available through the CLI's headless protocol, and the page
does not invent a dollar cost when the provider does not supply trustworthy billing data. In cost
views these records are labelled **Cost not reported** rather than `$0.00` or `0.0% of cost`.

## Permissions and orchestration

Read-only and workspace-write sessions run Antigravity with its sandbox enabled. Full-access mode
only passes Antigravity's skip-permissions option when the Sleepers Code session is also explicitly
using the danger-full-access sandbox.

Native Antigravity subagent delegation is off by default so a provider session behaves as one direct
worker inside Sleepers Code. You can opt in with **Allow native subagents** in provider settings.
This is a prompt-level boundary supplied to the provider; it is not a hard security sandbox.

Antigravity's headless protocol does not expose an interactive approval-response channel. If a task
needs interactive permissions, adjust the Sleepers Code permission mode before starting the turn.
