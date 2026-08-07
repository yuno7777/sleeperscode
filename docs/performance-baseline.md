# Performance baseline

Captured 2026-08-08 before tracked source changes at commit
`45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b`.

## Host

| Item | Value                                                  |
| ---- | ------------------------------------------------------ |
| OS   | Windows 11 Home Single Language, build 10.0.26200, x64 |
| CPU  | Intel Core i7-13620H, 10 cores / 16 logical processors |
| RAM  | 16,564,280 KiB visible                                 |
| Rust | rustc/cargo 1.95.0                                     |
| Node | 22.17.0                                                |
| pnpm | 11.10.0                                                |

The repository requires Node `^24.13.1`; this machine's Node version is below that constraint.
`pnpm install --frozen-lockfile` did not finish its link step within two bounded attempts (2 and 5
minutes), so application startup/build measurements are explicitly not reported yet.

## Measured results

### Git status

Command: `Measure-Command { git status --porcelain=v1 }`, 10 warm sequential runs.

Raw milliseconds: `150.938, 89.322, 93.262, 86.256, 83.409, 77.568, 87.362, 76.183, 94.017, 90.395`.

- Mean: 92.871 ms
- Median: 88.342 ms
- Range: 76.183-150.938 ms

### Node process launch proxy

Command: launch the installed Node executable with `-e` and no inherited stdio, wait for exit, 20
sequential runs. This measures generic child launch overhead, not authenticated agent startup.

Raw milliseconds: `39.741, 32.876, 50.947, 42.226, 47.324, 38.867, 51.056, 54.913, 48.149,
53.894, 72.127, 47.608, 45.281, 66.912, 54.236, 44.732, 50.715, 44.099, 42.977, 50.565`.

- Mean: 48.912 ms
- Median: 48.879 ms
- Range: 32.876-72.127 ms

### Checkout size

The checkout occupied 472,344,075 bytes immediately after cloning, before dependency installation.
This is not the packaged application size.

## Not measured

| Metric                                  | Status           | Reason / required procedure                                                             |
| --------------------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| Cold and warm application startup       | **NOT MEASURED** | Complete install with Node 24, then time from process creation to ready/pairing signal. |
| Idle and active RAM                     | **NOT MEASURED** | Run a packaged or controlled dev build and sample its complete process tree.            |
| Idle CPU                                | **NOT MEASURED** | Collect at least 60 seconds after quiescence with the existing resource monitor.        |
| Packaged application size               | **NOT MEASURED** | Build the Windows NSIS artifact with the supported Node toolchain.                      |
| Agent launch                            | **NOT MEASURED** | Requires a configured provider and a repeatable mock or authenticated fixture.          |
| Repository open / native workspace scan | **NOT MEASURED** | The incomplete pnpm link made `@ff-labs/fff-node` unavailable.                          |
| Checkpoint creation                     | **NOT MEASURED** | Needs an isolated fixture repository and server dependencies.                           |
