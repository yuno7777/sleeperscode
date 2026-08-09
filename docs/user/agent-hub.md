# Agent Hub

Agent Hub shows which coding agents your Sleepers Code environment can use now and which additional
ACP-compatible agents are discoverable. Open it from the desktop sidebar or command palette. On
mobile, open **Settings → Agent Hub**.

## Provider instances

The provider section includes built-in integrations and agents installed by Agent Hub. It reports
three different states:

- **Installed** means the provider command was detected on the environment.
- **Integrated** means this Sleepers Code build contains an adapter for the provider.
- **Routable** means the provider is currently eligible to receive work. Installation alone does not
  establish authentication, configuration, or runtime health.

Use **Configure** on web or desktop to open provider settings when an integrated provider is not
routable.

## ACP registry

The catalog is loaded by the connected environment, so compatibility reflects the machine that will
run the agent rather than the browser or phone displaying the page. When more than one environment is
connected on mobile, select the environment you want to inspect.

You can search by agent, author, or license and filter the catalog by:

- distributions compatible with the selected environment;
- binary distributions that provide a usable SHA-256 checksum; or
- package-manager distributions.

The environment caches a valid catalog snapshot. If a refresh fails, Agent Hub can keep showing the
last valid snapshot and labels it as stale instead of silently presenting an empty catalog.

## Trust and installation

Every catalog entry is labelled **Registry · unverified**. Registry membership means an entry is
published in the ACP catalog; it does not prove vendor endorsement or publisher identity.
**Checksum available** means the publisher supplied a digest that can be checked after download. It
does not establish publisher trust or prove that an agent was previously installed.

Agent Hub enables installation only for a host-compatible binary distribution that uses HTTPS,
provides a SHA-256 checksum, uses a supported archive, and declares a safe command path. Before any
download, Sleepers Code shows the exact publisher, version, host, command, and checksum. An
unverified publisher requires explicit acknowledgement.

The environment then revalidates the plan against a fresh catalog snapshot, downloads with size and
time limits, verifies the checksum, extracts into isolated staging with archive-safety checks, and
atomically activates the files. The installed command becomes an explicit ACP provider instance.
If activation or settings registration fails, the previous installation and provider settings are
restored.

**Uninstall** removes the provider instance and files managed by Agent Hub. It does not remove
external tools or repositories. Package-manager entries such as `npx` and `uvx` remain disabled
because they do not yet have an equally auditable execution policy.

An installed catalog agent receives a bounded ACP protocol health check. The probe performs only the
`initialize` handshake: it does not authenticate, create a session, send a prompt, or inspect
credentials. Authentication therefore remains unknown. The agent can appear as installed,
integrated, and protocol-ready, but it is not eligible for automatic routing until a provider-safe
authentication signal exists. Authenticate through the agent's own supported flow when needed;
never paste credentials into Agent Hub metadata.

## Troubleshooting

- If no built-in status appears, confirm the selected environment is connected.
- If the registry is unavailable, pull to refresh on mobile or select **Refresh catalog** on web and
  desktop.
- If an old snapshot is shown, the environment could not refresh the registry but retained its last
  valid result.
- If installation is unavailable, the selected environment has no compatible checksum-protected
  binary distribution for that catalog entry.
- If installation fails, retry only after reading the surfaced error. Sleepers Code does not
  silently rerun an activation that may already have completed.
- If a provider is installed but not routable, check authentication, its enabled setting, and the
  configured executable path.

See [Install Sleepers Code](./install.md) for provider setup and [Remote access](./remote-access.md)
for connecting another environment.
