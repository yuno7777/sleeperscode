import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

export const DEFAULT_PROVIDER_PROBE_CONCURRENCY = 1;

export interface ProviderProbeSchedulerShape {
  readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export class ProviderProbeScheduler extends Context.Service<
  ProviderProbeScheduler,
  ProviderProbeSchedulerShape
>()("t3/provider/Services/ProviderProbeScheduler") {}

export const makeProviderProbeScheduler = Effect.fn("ProviderProbeScheduler.make")(function* (
  concurrency = DEFAULT_PROVIDER_PROBE_CONCURRENCY,
) {
  const semaphore = yield* Semaphore.make(concurrency);

  return ProviderProbeScheduler.of({
    run: <A, E, R>(effect: Effect.Effect<A, E, R>) => semaphore.withPermits(1)(effect),
  });
});
