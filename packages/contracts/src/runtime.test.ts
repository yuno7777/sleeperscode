import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  DEFAULT_RUNTIME_BACKEND,
  RuntimeBackend,
  RuntimeEvent,
  RuntimeRequest,
} from "./runtime.ts";

describe("native runtime protocol", () => {
  it("defines stable runtime backend values", () => {
    expect(DEFAULT_RUNTIME_BACKEND).toBe("node");
    expect(Schema.decodeUnknownSync(RuntimeBackend)("auto")).toBe("auto");
    expect(() => Schema.decodeUnknownSync(RuntimeBackend)("experimental")).toThrow();
  });

  it("decodes a Rust run request fixture", () => {
    const decoded = Schema.decodeUnknownSync(RuntimeRequest)({
      version: 2,
      type: "run",
      requestId: "request-1",
      command: "program.exe",
      args: ["--flag"],
      cwd: "C:\\workspace with spaces",
      env: { T3_TEST: "yes" },
      stdin: "hello",
      timeoutMs: 1000,
      maxOutputBytes: 4096,
      outputMode: "truncate",
      truncatedMarker: "...",
    });

    expect(decoded.type).toBe("run");
    if (decoded.type !== "run") throw new Error("expected run request");
    expect(decoded.cwd).toBe("C:\\workspace with spaces");
  });

  it("decodes structured completion and error events", () => {
    expect(
      Schema.decodeUnknownSync(RuntimeEvent)({
        version: 2,
        type: "processCompleted",
        requestId: "request-1",
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        stdout: "ok",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      }).type,
    ).toBe("processCompleted");
    expect(
      Schema.decodeUnknownSync(RuntimeEvent)({
        version: 2,
        type: "error",
        requestId: "request-1",
        code: "PROCESS_SPAWN_FAILED",
        message: "The process could not be started.",
        recoverable: true,
        debugDetail: null,
        stream: null,
        maxOutputBytes: null,
        observedOutputBytes: null,
      }).type,
    ).toBe("error");
  });

  it("decodes bounded streaming requests and byte events", () => {
    const write = Schema.decodeUnknownSync(RuntimeRequest)({
      version: 2,
      type: "write",
      requestId: "session-1",
      dataBase64: "aGVsbG8=",
    });
    expect(write.type).toBe("write");

    const output = Schema.decodeUnknownSync(RuntimeEvent)({
      version: 2,
      type: "processOutput",
      requestId: "session-1",
      stream: "stdout",
      sequence: 0,
      dataBase64: "8J+Zgg==",
    });
    expect(output.type).toBe("processOutput");

    expect(() =>
      Schema.decodeUnknownSync(RuntimeRequest)({
        version: 2,
        type: "write",
        requestId: "session-1",
        dataBase64: "not base64",
      }),
    ).toThrow();
  });
});
