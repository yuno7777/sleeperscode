# Install Sleepers Code

Sleepers Code is a local-first desktop and web workspace for running coding agents on your machine.

> [!IMPORTANT]
> Sleepers Code is currently an alpha. A Windows x64 installer can be produced by maintainers, but
> no clean-machine-qualified public release is available yet. Upstream `npx t3`, package-manager,
> App Store, and T3 Code GitHub links install T3 Code—not this fork.

## Windows alpha installer

Only install an alpha artifact supplied with its matching `SHA256SUMS.txt`. In PowerShell, verify it
before opening the installer:

```powershell
Get-FileHash .\Sleepers-Code-<version>-x64.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

The calculated hash must exactly match the installer line in the manifest. Stop if it does not.

Current local alpha builds are unsigned. Windows SmartScreen may therefore show an unknown-publisher
warning even when the checksum matches. A signature will become a release requirement once signing
credentials are available.

The installer contains the Sleepers Code application, its Node server bundle, Rust runtime helper,
resource monitor, web assets, database migrations, and WSL terminal dependency. Provider CLIs are
separate and remain under their publishers' installers and terms.

Prefer a no-install copy? See the [portable Windows guide](./portable-windows.md) for checksum,
storage, move, update, and removal behavior.

## Providers

Install and authenticate at least one provider CLI on the computer where Sleepers Code runs.

| Provider    | CLI                                                                      | Default binary | Log in with           |
| :---------- | :----------------------------------------------------------------------- | :------------- | :-------------------- |
| Codex       | [Codex CLI](https://developers.openai.com/codex/cli)                     | `codex`        | `codex login`         |
| Claude Code | [Claude Code](https://claude.com/product/claude-code)                    | `claude`       | `claude auth login`   |
| Cursor      | [Cursor CLI](https://cursor.com/cli)                                     | `cursor-agent` | `agent login`         |
| Grok Build  | [Grok Build CLI](https://x.ai/cli)                                       | `grok`         | `grok login`          |
| OpenCode    | [OpenCode](https://opencode.ai)                                          | `opencode`     | `opencode auth login` |
| Antigravity | [Antigravity CLI](https://github.com/google-antigravity/antigravity-cli) | `agy`          | `agy`                 |

Cursor installs the `cursor-agent` binary but uses `agent login` for authentication.
Run `agy` once to finish Antigravity setup, then use `agy models` to confirm that its models are
available. See [Using Antigravity](./providers-antigravity.md) for web research and permission-mode
behavior.

## Binary discovery

Sleepers Code searches normal `PATH` locations plus common WinGet, npm, pnpm, user-local, Volta,
Bun, Cargo, Scoop, and WSL login-shell locations. If discovery misses an installation, set the
provider's command name or absolute server-side binary path in **Settings**.

The path belongs to the environment that runs the provider. A browser or mobile client connected to
a remote environment cannot select a file from its own device.

## Authentication

When the web app and server are both running on this computer's loopback address, opening the local
URL creates the browser session automatically. This removes the startup session-key prompt without
weakening remote access: LAN, tunnel, hosted-web, mobile, and other non-loopback connections still
use a pairing credential.

Provider authentication is required when starting that provider, not when launching Sleepers Code.
A missing or signed-out provider appears as unavailable and should not crash the application. Run
the login command on the environment that will execute the agent.

For multi-account setups, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next steps

- [Permission modes](./permission-modes.md): control what agents may do
- [Remote access](./remote-access.md): connect from another desktop or mobile device
- [Keeping environments in sync](./updating.md): understand client/server version compatibility
- [Running in the background](./background-service.md): Linux background service behavior
