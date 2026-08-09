import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";

import { makeProviderProbeScheduler } from "./ProviderProbeScheduler.ts";

describe("ProviderProbeScheduler", () => {
  it.effect("serializes provider probes without dropping queued work", () =>
    Effect.gen(function* () {
      const scheduler = yield* makeProviderProbeScheduler();
      const release = yield* Deferred.make<void>();
      const started = yield* Queue.unbounded<number>();
      const active = yield* Ref.make(0);
      const peakActive = yield* Ref.make(0);

      const runProbe = (id: number) =>
        scheduler.run(
          Effect.acquireUseRelease(
            Ref.updateAndGet(active, (count) => count + 1).pipe(
              Effect.tap((count) => Ref.update(peakActive, (peak) => Math.max(peak, count))),
              Effect.tap(() => Queue.offer(started, id)),
            ),
            () => Deferred.await(release),
            () => Ref.update(active, (count) => count - 1),
          ),
        );

      const fibers = yield* Effect.forEach([1, 2, 3, 4, 5], runProbe, {
        concurrency: "unbounded",
      }).pipe(Effect.forkChild);

      yield* Queue.take(started);
      expect(Option.isNone(yield* Queue.poll(started))).toBe(true);
      expect(yield* Ref.get(active)).toBe(1);

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(fibers);

      expect(yield* Ref.get(peakActive)).toBe(1);
      expect(yield* Ref.get(active)).toBe(0);
      expect(yield* Queue.size(started)).toBe(4);
    }),
  );
});
