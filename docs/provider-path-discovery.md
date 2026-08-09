# Provider executable discovery

Sleepers Code resolves provider executables in the environment that owns the project. This matters
for remote use: a browser connected to another T3 environment must configure a path on the server,
not a path on the browser's machine.

## Resolution order

Each built-in provider persists a `binaryPath` setting. The value may be either a command name such
as `codex` or an absolute server-side path such as `C:\Tools\codex.cmd`. Empty overrides return to
the provider default.

On Windows, server startup repairs the inherited `PATH` before providers are created. Entries are
deduplicated case-insensitively and searched in this order:

1. npm's roaming bin directory;
2. WinGet links and Windows app aliases;
3. user-local Node, Volta, and pnpm directories;
4. `.local/bin`, Bun, Cargo, and Scoop user directories;
5. the no-profile PowerShell environment;
6. the inherited process environment;
7. the user's PowerShell profile environment when Node is still unresolved.

Windows `PATHEXT` controls `.com`, `.exe`, `.bat`, and `.cmd` lookup. Executables run directly;
batch shims use the repository's argument-escaping shell path. An unresolved command is never passed
through a shell as a fallback.

Git Bash is covered when Sleepers Code inherits its environment, while providers inside WSL are
resolved by the separate Linux backend from that distribution's login-shell `PATH`. Windows paths
are intentionally not forwarded into WSL as provider overrides.

## User control

Settings exposes the binary override for Codex, Claude, Cursor, Grok, and OpenCode, including custom
provider instances. It is a text field rather than a browser file picker because the environment may
be remote, tunneled, or inside WSL; a browser picker would select a file on the wrong machine.

Changing a persisted executable path rebuilds that provider instance and triggers a fresh health
probe. Missing providers remain unavailable without preventing the rest of the server from starting.

This discovery layer does not install or authenticate proprietary provider CLIs. Agent Hub install
work remains a separate phase with explicit vendor-source and consent requirements.

## Focused evidence

- `packages/shared/src/shell.test.ts` covers PATH ordering, profile fallback, Windows extensions, and
  safe batch-shim execution.
- `packages/contracts/src/settings.test.ts` covers normalized overrides for all five providers.
- `apps/web/src/components/settings/ProviderSettingsForm.test.ts` proves every built-in provider
  exposes a server-side binary override.
- `apps/server/src/provider/Layers/ProviderRegistry.test.ts` covers provider re-creation and re-probe
  when a persisted binary path changes.
