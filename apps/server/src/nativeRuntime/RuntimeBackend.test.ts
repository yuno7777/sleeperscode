import { describe, expect, it } from "vite-plus/test";

import { selectRuntimeBackend } from "./RuntimeBackend.ts";

describe("runtime backend selection", () => {
  it("keeps Node as the default", () => {
    expect(selectRuntimeBackend({ environment: {} })).toEqual({
      requested: "node",
      active: "node",
      source: "settings",
    });
  });

  it("uses the persisted Rust selection", () => {
    expect(selectRuntimeBackend({ configured: "rust", environment: {} })).toEqual({
      requested: "rust",
      active: "rust",
      source: "settings",
    });
  });

  it("keeps auto on the safest validated backend", () => {
    expect(selectRuntimeBackend({ configured: "auto", environment: {} })).toEqual({
      requested: "auto",
      active: "node",
      source: "settings",
    });
  });

  it("gives the typed environment override precedence", () => {
    expect(
      selectRuntimeBackend({
        configured: "node",
        environment: { T3CODE_RUNTIME_BACKEND: " RUST ", T3CODE_RUST_RUNTIME: "0" },
      }),
    ).toEqual({
      requested: "rust",
      active: "rust",
      source: "environment",
    });
  });

  it("supports the legacy boolean override", () => {
    expect(
      selectRuntimeBackend({
        configured: "node",
        environment: { T3CODE_RUST_RUNTIME: "1" },
      }),
    ).toEqual({
      requested: "rust",
      active: "rust",
      source: "legacy-environment",
    });
  });

  it("ignores invalid environment values", () => {
    expect(
      selectRuntimeBackend({
        configured: "rust",
        environment: { T3CODE_RUNTIME_BACKEND: "experimental" },
      }),
    ).toEqual({
      requested: "rust",
      active: "rust",
      source: "settings",
    });
  });
});
