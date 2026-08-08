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

| Metric                                |         Original |        Hybrid Rust |               Improvement |
| ------------------------------------- | ---------------: | -----------------: | ------------------------: |
| Idle RAM                              | **NOT MEASURED** |   **NOT MEASURED** |          **NOT MEASURED** |
| Startup                               | **NOT MEASURED** |   **NOT MEASURED** |          **NOT MEASURED** |
| Original generic process launch proxy |   48.912 ms mean | **NOT COMPARABLE** |          **NOT MEASURED** |
| Paired no-op process launch (v1)      |   58.461 ms mean |     43.258 ms mean |  26.0% lower mean latency |
| Paired no-op process launch (v2)      |   50.094 ms mean |     68.296 ms mean | 36.3% higher mean latency |
| Three-process tree cancellation       | **NOT MEASURED** |      1.896 ms mean |        Native-only metric |
| Agent launch                          | **NOT MEASURED** |   **NOT MEASURED** |          **NOT MEASURED** |
| Git status                            |   92.871 ms mean |   **NOT MEASURED** |          **NOT MEASURED** |
| Repository scan                       | **NOT MEASURED** |   **NOT MEASURED** |          **NOT MEASURED** |
| Packaged app size                     | **NOT MEASURED** |   **NOT MEASURED** |          **NOT MEASURED** |

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

### Protocol v2 re-measurement

The same benchmark was repaired for protocol v2 (handshake version check, global-error handling,
10-second operation deadlines) and re-run on the current sidecar under Node 24.14.0. The sidecar
binary has grown to 1,434,112 bytes since the v1 capture because it now carries the streaming
session machinery and the blocking-pool launch helper.

```text
node scripts/benchmark-runtime-sidecar.mjs target/release/t3-runtime-sidecar.exe 20
```

| Path                           |      Mean |    Median |            Range |
| ------------------------------ | --------: | --------: | ---------------: |
| Direct Node no-op child        | 50.094 ms | 47.648 ms | 42.079-62.964 ms |
| Warm Rust sidecar finite child | 68.296 ms | 66.829 ms | 61.946-90.528 ms |

The hybrid path is 36.3% slower than a direct Node child for this workload, reversing the v1 result.
Two things changed at once between the captures, so this run does not attribute the reversal: the
protocol and sidecar gained streaming support and blocking-pool launch, and the harness moved from
Node 22.17.0 to Node 24.14.0. The direct Node baseline itself improved from 58.461 ms to 50.094 ms
across the same change, which is consistent with the runtime bump accounting for part of the gap.

This is a no-op `node -e ""` child launched through a warm sidecar. It is not a provider-performance
claim: it measures per-launch protocol overhead on the smallest possible payload, where the round
trip through the sidecar cannot be amortized against any real work. The session-scoped provider
figures above remain the relevant evidence for ACP workloads, and `auto` stays on Node.

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
real-provider distributions and adequately repeated mock distributions remain unmeasured.

### Paired Node and Rust sample

The benchmark now accepts `--backend=node|rust` and `--repeat=N`. Two repetitions per backend were
captured under Node 24.14.0 with the same release monitor and 250 ms sampling interval:

```text
pnpm bench:provider-concurrency -- --backend=node --repeat=2
pnpm bench:provider-concurrency -- --backend=rust --repeat=2
```

| Sessions | Backend | Mean elapsed | Mean peak RSS | Maximum peak RSS | Maximum processes |
| -------: | :------ | -----------: | ------------: | ---------------: | ----------------: |
|        1 | Node    |      4.849 s |    589.07 MiB |       594.00 MiB |                 7 |
|        1 | Rust    |      4.575 s |    589.85 MiB |       589.95 MiB |                 6 |
|        3 | Node    |      5.056 s |    844.40 MiB |       897.17 MiB |                13 |
|        3 | Rust    |      4.953 s |    777.20 MiB |       798.59 MiB |                 8 |
|        5 | Node    |      5.367 s |  1,088.62 MiB |     1,169.32 MiB |                19 |
|        5 | Rust    |      6.140 s |    960.13 MiB |       993.11 MiB |                10 |
|       10 | Node    |      6.159 s |  1,713.18 MiB |     1,750.61 MiB |                32 |
|       10 | Rust    |      8.072 s |  1,212.15 MiB |     1,236.28 MiB |                15 |

The Rust rows use one shared sidecar across all sessions, matching adapter-scoped ownership. This
reduced maximum process counts substantially and used less sampled peak tree RSS at 3, 5, and 10
sessions. It did not improve throughput: mean elapsed time was worse at 5 and 10 sessions, and the
second 10-session Rust run took 10.31 seconds versus 5.83 seconds for the first. The shared sidecar
therefore exposes a contention or head-of-line-blocking gate that must be diagnosed before automatic
selection. Two repetitions are still too few for stable ranking, background load was not isolated,
and CPU samples are omitted because their variance was extreme.

### Focused 10-session repetition

The 10-session level was then repeated five times per backend:

```text
pnpm bench:provider-concurrency -- --backend=node --levels=10 --repeat=5
pnpm bench:provider-concurrency -- --backend=rust --levels=10 --repeat=5
```

| Backend | Runs | Mean elapsed | Elapsed range | Mean peak RSS | Maximum peak RSS | Maximum processes |
| :------ | ---: | -----------: | ------------: | ------------: | ---------------: | ----------------: |
| Node    |    5 |      5.869 s | 5.594-6.011 s |  1,866.92 MiB |     1,910.97 MiB |                34 |
| Rust    |    5 |      8.353 s | 7.383-9.853 s |  1,341.42 MiB |     1,540.31 MiB |                15 |

In this focused sample the shared Rust sidecar used 28.1% less mean peak tree RSS and 19 fewer
processes at the maximum, but elapsed time was 42.3% worse. The result confirms the contention gate
at this workload; it does not identify whether the bottleneck is the sidecar event channel, the
single TypeScript NDJSON reader, queue scheduling, or another shared resource.

### Raw streaming sidecar pool probe

The provider and Effect layers were removed from a second diagnostic. Each session sends an exact
32 KiB payload to the release `runtime-fixture`, closes stdin, and verifies the echoed bytes. One
warmup runs per sidecar before timing. The harness records process-start, control-acceptance, and
exit phases and enforces a 15-second operation deadline:

```text
node scripts/benchmark-runtime-streaming.mjs --levels=10 --pool-sizes=1,3,5 --repeat=3 --timeout-ms=15000
```

| Sidecars | Sessions | Runs | Mean elapsed |    Elapsed range | Mean last start |
| -------: | -------: | ---: | -----------: | ---------------: | --------------: |
|        1 |       10 |    3 |   3,139.2 ms | 603.3-4,618.5 ms |      3,134.5 ms |
|        3 |       10 |    3 |     857.4 ms | 261.3-1,760.9 ms |        852.9 ms |
|        5 |       10 |    3 |     192.9 ms |   130.9-269.4 ms |        187.2 ms |
|       10 |       10 |    3 |     108.8 ms |   103.1-116.6 ms |        102.7 ms |

Moving synchronous Windows launch and Job Object attachment to Tokio's blocking pool reduced a
small three-session shared-sidecar probe, but did not remove the parent-local launch bottleneck. In
the repeated 10-session sample, nearly all elapsed time accumulated before the last
`processStarted`; control acceptance and exact echo completion followed within about 4-6 ms. The
raw result rules out the TypeScript NDJSON reader and ACP event queue as the primary cause for this
workload. It favors session-scoped sidecars for latency, but does not yet quantify their process-tree
RSS cost, so it is a design input rather than an automatic-backend qualification.

### Session-scoped provider follow-up

Cursor and Grok were then changed from one adapter-scoped sidecar to one lazy sidecar per active ACP
session. The production-shaped 10-session benchmark was repeated five times per backend with the
same 250 ms resource monitor:

| Backend | Runs | Mean elapsed | Elapsed range | Mean peak RSS | Maximum peak RSS | Maximum processes |
| :------ | ---: | -----------: | ------------: | ------------: | ---------------: | ----------------: |
| Node    |    5 |      5.963 s | 5.517-6.461 s |  1,821.85 MiB |     1,893.29 MiB |                34 |
| Rust    |    5 |      6.161 s | 6.055-6.321 s |  1,423.96 MiB |     1,694.70 MiB |                24 |

Session-scoped Rust was 3.3% slower by mean elapsed time, used 21.8% less mean peak tree RSS, and
reduced the maximum process count by 10. This removes most of the shared-sidecar throughput penalty:
the earlier shared sample was 42.3% slower. Rust is still not faster on this workload, the samples
were taken under uncontrolled local background load, and packaging plus whole-application gates
remain open, so `auto` continues to select Node.

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
