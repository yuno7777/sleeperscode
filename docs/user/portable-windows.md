# Portable Sleepers Code for Windows

The Windows portable build runs without an installer and keeps Sleepers Code application data beside
the executable. It is currently an unsigned alpha, so verify its checksum before opening it.

## First launch

1. Put `Sleepers-Code-<version>-x64-portable.exe` in a writable folder.
2. Compare its SHA-256 with the matching line in `SHA256SUMS.txt`.
3. Open the executable. The first launch extracts the application and creates a sibling
   `Sleepers-Code-Data` folder.

The portable data folder contains:

- `userdata`: threads, settings, logs, and the database.
- `desktop`: Electron preferences, cache, and single-instance state.

Additional service-owned cache and worktree directories may appear beside these folders. They remain
inside `Sleepers-Code-Data`.

Provider CLIs and their authentication remain in their normal operating-system locations. Sleepers
Code does not copy provider credentials into the portable folder. A WSL backend also keeps its Linux
state in the selected distribution's home directory.

## Move, update, or remove it

Close Sleepers Code before moving or replacing files. Move the portable executable and its
`Sleepers-Code-Data` folder together. Setting `T3CODE_HOME` explicitly overrides the default sibling
data location.

Automatic updates are disabled in portable builds. To update, close the app, download and verify a
replacement portable executable, and place it beside the existing data folder.

To remove the portable app, close it and delete the executable plus `Sleepers-Code-Data`. This does
not remove repositories, provider CLIs, provider authentication, or WSL data.
