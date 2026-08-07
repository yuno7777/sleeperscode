# Electron to Tauri gap analysis

Tauri migration is deferred. The current Electron app is more than a window wrapper and the Node
server remains necessary for remote web/mobile clients.

| Current capability                                 | Likely path                  | Status / gap                                                                                                 |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Main/splash windows, bounds, focus, fullscreen     | **DIRECT TAURI REPLACEMENT** | Validate multi-display restore and Windows focus behavior.                                                   |
| Application and context menus                      | **DIRECT TAURI REPLACEMENT** | Preserve dynamic enablement, destructive styling, and keyboard routing.                                      |
| Folder/file/message dialogs                        | **TAURI PLUGIN**             | Verify owner-window behavior and filters.                                                                    |
| External URL and clipboard                         | **TAURI PLUGIN**             | Straightforward, subject to URL validation parity.                                                           |
| Safe credential storage                            | **TAURI PLUGIN**             | Must preserve migration from Electron-encrypted values and Linux backend reporting.                          |
| Auto updater and release channels                  | **TAURI PLUGIN**             | Requires signing, rollback, staged rollout, and current release-note parity.                                 |
| Deep links/default protocol client                 | **TAURI PLUGIN**             | Validate single-instance routing on Windows/Linux/macOS.                                                     |
| Custom `t3` protocol and authenticated fetch proxy | **CUSTOM RUST COMMAND**      | Electron protocol/net behavior needs an explicit security model.                                             |
| Power/idle/thermal state                           | **CUSTOM RUST COMMAND**      | Existing resource policy consumes Electron power events; platform parity is incomplete.                      |
| Backend server pool and local hosting              | **KEEP TEMPORARILY**         | Remote clients require the Node WebSocket server even with a Tauri shell.                                    |
| WSL backend discovery and launch                   | **CUSTOM RUST COMMAND**      | Preserve distro selection, node-pty availability, paths, environment, and error UX.                          |
| SSH environments/password prompts                  | **KEEP TEMPORARILY**         | Existing Effect SSH manager and prompt lifecycle are mature.                                                 |
| Browser preview tabs/webviews                      | **KEEP TEMPORARILY**         | Largest gap: navigation, injected scripts, picking, screenshots, PiP, keyboard input, and session isolation. |
| Playwright-core preview automation                 | **KEEP TEMPORARILY**         | Tauri WebView automation parity is not established.                                                          |
| Electron IPC/preload bridge                        | **CUSTOM RUST COMMAND**      | Replace method-by-method with typed commands/events, not a generic JSON escape hatch.                        |
| Process metrics                                    | **DIRECT RUST REPLACEMENT**  | Existing Rust resource monitor already supplies most data.                                                   |
| Native theme and app identity                      | **DIRECT TAURI REPLACEMENT** | Validate live theme updates, dock/app user model IDs, and about panel.                                       |
| Clerk Electron/passkeys                            | **KEEP TEMPORARILY**         | Authentication and passkey support need an endorsed Tauri flow.                                              |

## Gate to start a Tauri shell

Do not replace Electron until preview, authentication, updater, deep link, credential migration,
WSL/SSH, local server hosting, and remote-client flows each have a runnable parity test and a
rollback path.
