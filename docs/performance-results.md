# Performance results

Captured 2026-08-08 after the first finite-process runtime slice. This is a microbenchmark of a warm
release sidecar, not an application startup or memory benchmark. The thin-LTO release build
completed in 21.72 seconds after its dependency cache had been populated; the stripped Windows x64
binary is 1,272,320 bytes.

## Supported toolchain build baseline

The frozen-lockfile workspace install completed under Node 24.14.0 and pnpm 11.16.0, including the
repository prepare and Effect language-service patch steps. A cold-cache-disabled
`pnpm build:desktop` then completed in 92.1 seconds. That focused task built the production web
client, bundled server, and Electron main/preload code successfully.

| Build output                         | Files |      Bytes |   MiB |
| ------------------------------------ | ----: | ---------: | ----: |
| `apps/web/dist`                      |   778 | 58,485,982 | 55.78 |
| `apps/server/dist` (includes client) |   790 | 72,574,742 | 69.21 |
| `apps/desktop/dist-electron`         |    12 |  3,812,869 |  3.64 |

These are unpackaged development build directories and overlap because the server bundle embeds
the web client. They are not additive and do not represent installer or installed-application size.
The build reported existing large-chunk and sourcemap warnings but exited successfully.

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

## Deterministic provider concurrency

Command: `pnpm bench:provider-concurrency`. Each row is one isolated run of the ACP mock-provider
stress test while the release resource monitor sampled the complete Vitest process tree every 250
milliseconds.

| Concurrent sessions | Elapsed | Samples | Peak tree RSS | Peak sampled CPU | Peak processes |
| ------------------: | ------: | ------: | ------------: | ---------------: | -------------: |
|                   1 | 2.986 s |       7 |    464.41 MiB |          163.68% |              5 |
|                   3 | 3.555 s |       9 |    711.66 MiB |          306.42% |              7 |
|                   5 | 3.890 s |       9 |    908.28 MiB |          566.34% |              9 |
|                  10 | 4.878 s |       8 |  1,507.00 MiB |          188.24% |             14 |

These numbers include the Vite/Vitest runner, worker, resource monitor, and mock Node agents. They
are not production-agent RAM claims. There is one run per level and only 7-9 CPU samples, so the CPU
peaks are observational and should not be ranked across rows. The functional 1/3/5/10 matrix passed;
real provider and repeated-run distributions remain unmeasured.

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
