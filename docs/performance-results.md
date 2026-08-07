# Performance results

Captured 2026-08-08 after the first finite-process runtime slice. This is a microbenchmark of a warm
release sidecar, not an application startup or memory benchmark. The thin-LTO release build
completed in 21.72 seconds after its dependency cache had been populated; the stripped Windows x64
binary is 1,272,320 bytes.

| Metric                                |         Original |        Hybrid Rust |              Improvement |
| ------------------------------------- | ---------------: | -----------------: | -----------------------: |
| Idle RAM                              | **NOT MEASURED** |   **NOT MEASURED** |         **NOT MEASURED** |
| Startup                               | **NOT MEASURED** |   **NOT MEASURED** |         **NOT MEASURED** |
| Original generic process launch proxy |   48.912 ms mean | **NOT COMPARABLE** |         **NOT MEASURED** |
| Paired no-op process launch           |   58.461 ms mean |     43.258 ms mean | 26.0% lower mean latency |
| Three-process tree cancellation       | **NOT MEASURED** |      1.896 ms mean |       Native-only metric |
| Agent launch                          | **NOT MEASURED** |   **NOT MEASURED** |         **NOT MEASURED** |
| Git status                            |   92.871 ms mean |   **NOT MEASURED** |         **NOT MEASURED** |
| Repository scan                       | **NOT MEASURED** |   **NOT MEASURED** |         **NOT MEASURED** |
| Packaged app size                     | **NOT MEASURED** |   **NOT MEASURED** |         **NOT MEASURED** |

## Paired no-op launch detail

Command: `node scripts/benchmark-runtime-sidecar.mjs target/release/t3-runtime-sidecar.exe 20`.
The harness performs three warmups, keeps one sidecar warm, and then alternates 20 sequential direct
Node launches with 20 sequential sidecar-owned launches of the same `node -e ""` command.

| Path                      |      Mean |    Median |            Range |
| ------------------------- | --------: | --------: | ---------------: |
| Direct Node child         | 58.461 ms | 56.188 ms | 46.874-84.205 ms |
| Warm release Rust sidecar | 43.258 ms | 42.678 ms | 34.833-60.599 ms |

Direct raw milliseconds: `55.358, 68.914, 54.614, 57.396, 57.018, 53.707, 70.096, 54.135,
61.820, 55.167, 51.847, 49.756, 57.511, 46.874, 47.692, 84.205, 57.240, 69.344, 62.044,
54.472`.

Hybrid raw milliseconds: `46.598, 43.120, 36.623, 49.565, 37.313, 43.875, 39.739, 41.993,
50.399, 39.711, 39.275, 50.656, 43.043, 37.284, 42.439, 37.400, 42.916, 60.599, 47.777,
34.833`.

Toolchain: Node 22.17.0, rustc 1.95.0, Windows x64. The repository's Node 24 requirement remains
unmet on this host. A faster microbenchmark alone does not establish lower application RAM, startup
time, agent launch time, or package size; those remain `NOT MEASURED`.

## Windows process-tree cancellation

Command:
`node scripts/benchmark-runtime-cancellation.mjs target/release/t3-runtime-sidecar.exe target/release/runtime-fixture.exe 20`.
After three warmups, each sample launches a parent-child-grandchild fixture through one warm release
sidecar, waits until all three PIDs are alive, sends `cancel`, waits for the cancelled completion,
and independently verifies that all PIDs exited.

| Count |     Mean |   Median |      p95 |          Range |
| ----: | -------: | -------: | -------: | -------------: |
|    20 | 1.896 ms | 1.607 ms | 3.609 ms | 1.176-4.650 ms |

Raw milliseconds: `2.041, 1.909, 1.689, 3.212, 1.665, 1.384, 1.371, 1.422, 1.260, 1.550,
1.666, 1.341, 4.650, 2.075, 1.200, 3.609, 1.370, 1.176, 2.048, 1.289`.

This measures forceful native cancellation after the tree is ready. It does not measure a
provider-specific graceful shutdown or whole-application shutdown latency.
