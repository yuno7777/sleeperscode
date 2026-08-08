# Native runtime sidecar

The native runtime sidecar is an optional finite-process execution backend. Node remains the
default and fallback, including when the sidecar is absent or cannot start.

## Desktop packaging

The desktop artifact builder compiles `t3-runtime-sidecar` for the selected platform and
architecture, stages it under `apps/desktop/prod-resources/runtime-sidecar`, and declares that
directory as an Electron `extraResources` entry. A packaged app therefore exposes the executable at:

```text
<resources>/runtime-sidecar/t3-runtime-sidecar[.exe]
```

`DesktopBackendConfiguration` probes that external path for the Windows primary backend and, when
present, passes it to the server as `T3CODE_RUNTIME_SIDECAR_PATH`. The WSL backend intentionally
does not receive the Windows executable. Development probes prefer `target/release` and then
`target/debug` from the repository root.

## Windows staging evidence

On 2026-08-08, an x64 Windows artifact stage produced a 1,275,392-byte sidecar. The copy in
`resources` and the copy promoted to `prod-resources` had the same SHA-256:

```text
CF1E4D5FE9AB451736BD39C6B074EA3E2BED4DD92AC0536E020FA186244C314B
```

The generated Electron build configuration contained both external native resources:

- `resource-monitor` -> `resource-monitor`
- `runtime-sidecar` -> `runtime-sidecar`

The local NSIS build did not complete because the fresh production install timed out downloading
optional Anthropic SDK platform tarballs. No installer or release was produced, so clean-package
launch and `auto` backend selection remain gated.

## Verification

Run the focused packaging and desktop configuration suites:

```text
vp test run scripts/build-desktop-artifact.test.ts
vp test run apps/desktop/src/backend/DesktopBackendConfiguration.test.ts
```

The packaging fixture verifies the Cargo package, binary, target triple, destination name, and
copied bytes without requiring Electron Builder or network access.
