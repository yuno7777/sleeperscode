# Agent Hub

Agent Hub shows which coding agents your Sleepers Code environment can use now and which additional
ACP-compatible agents are discoverable. Open it from the desktop sidebar or command palette. On
mobile, open **Settings → Agent Hub**.

## Built-in providers

The built-in section reports three different states:

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
published in the ACP catalog; it does not prove vendor endorsement or publisher identity. Likewise,
**Checksum available** means a future downloader could verify downloaded bytes. It does not mean
Sleepers Code has downloaded or verified that agent already.

Installation is disabled during the current alpha. Sleepers Code will not execute registry-provided
package commands or download community binaries until explicit consent, publisher trust, checksum
verification, staging, rollback, and prerequisite checks are enforced end to end. Install and
authenticate a provider independently, then use provider settings to configure its server-side
command or absolute path.

## Troubleshooting

- If no built-in status appears, confirm the selected environment is connected.
- If the registry is unavailable, pull to refresh on mobile or select **Refresh catalog** on web and
  desktop.
- If an old snapshot is shown, the environment could not refresh the registry but retained its last
  valid result.
- If a provider is installed but not routable, check authentication, its enabled setting, and the
  configured executable path.

See [Install Sleepers Code](./install.md) for provider setup and [Remote access](./remote-access.md)
for connecting another environment.
