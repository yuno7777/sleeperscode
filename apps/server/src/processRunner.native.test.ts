import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodePath from "node:path";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";

import { ProcessRunner, layer } from "./processRunner.ts";

const NativeEnvironment = Layer.succeed(HostProcessEnvironment, {
  ...process.env,
  T3CODE_RUST_RUNTIME: "1",
});
const TestLayer = layer.pipe(Layer.provide(NodeServices.layer), Layer.provide(NativeEnvironment));

describe("ProcessRunner native adapter", () => {
  it.live("preserves both timeout behavior contracts", () =>
    Effect.gen(function* () {
      const runner = yield* ProcessRunner;
      const input = {
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 1000)"],
        timeout: "20 millis",
      } as const;

      const error = yield* runner.run(input).pipe(Effect.flip);
      expect(error._tag).toBe("ProcessTimeoutError");

      const result = yield* runner.run({ ...input, timeoutBehavior: "timedOutResult" });
      expect(result).toMatchObject({
        code: null,
        timedOut: true,
        stdout: "",
        stderr: "",
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("resolves a Windows executable from the supplied PATH and extends its environment", () =>
    Effect.gen(function* () {
      if (process.platform !== "win32") return;
      const runner = yield* ProcessRunner;
      const result = yield* runner.run({
        command: NodePath.basename(process.execPath),
        args: ["-e", "process.stdout.write(process.env.SLEEPERS_RUNTIME_TEST ?? '')"],
        env: {
          PATH: NodePath.dirname(process.execPath),
          SLEEPERS_RUNTIME_TEST: "välue-值",
        },
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("välue-值");
    }).pipe(Effect.provide(TestLayer)),
  );
});
