import { describe, expect, it } from "vite-plus/test";

import type { LocalModelProbeResult } from "./LocalModelDiscovery.ts";
import {
  shouldDiscoverOpenCodeLocalModels,
  withOpenCodeLocalModels,
} from "./OpenCodeLocalModels.ts";

const ready = (
  runtime: "ollama" | "lmstudio" | "openai-compatible",
  baseUrl: string,
  modelIds: ReadonlyArray<string>,
): LocalModelProbeResult => ({
  status: "ready",
  runtime,
  baseUrl,
  models: modelIds.map((id) => ({ id, runtime })),
});

describe("withOpenCodeLocalModels", () => {
  it("adds Ollama and LM Studio models without mutating the source environment", () => {
    const environment = { PATH: "C:\\Tools" };
    const result = withOpenCodeLocalModels(environment, [
      ready("ollama", "http://localhost:11434", ["qwen2.5-coder:7b"]),
      ready("lmstudio", "http://localhost:1234/v1", ["codestral-22b"]),
    ]);

    expect(result).not.toBe(environment);
    expect(environment).not.toHaveProperty("OPENCODE_CONFIG_CONTENT");
    expect(JSON.parse(result.OPENCODE_CONFIG_CONTENT!)).toEqual({
      provider: {
        "sleepers-ollama": {
          npm: "@ai-sdk/openai-compatible",
          name: "Ollama (local)",
          options: { baseURL: "http://localhost:11434/v1" },
          models: { "qwen2.5-coder:7b": { name: "qwen2.5-coder:7b" } },
        },
        "sleepers-lmstudio": {
          npm: "@ai-sdk/openai-compatible",
          name: "LM Studio (local)",
          options: { baseURL: "http://localhost:1234/v1" },
          models: { "codestral-22b": { name: "codestral-22b" } },
        },
      },
    });
  });

  it("merges existing inline config and does not overwrite a user-defined provider", () => {
    const existingProvider = { npm: "custom-package", models: { mine: {} } };
    const environment = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        theme: "sleepers",
        provider: { "sleepers-ollama": existingProvider },
      }),
    };

    const result = withOpenCodeLocalModels(environment, [
      ready("ollama", "http://localhost:11434", ["ignored"]),
      ready("openai-compatible", "http://127.0.0.1:8080/v1", ["local-coder"]),
    ]);

    expect(JSON.parse(result.OPENCODE_CONFIG_CONTENT!)).toEqual({
      theme: "sleepers",
      provider: {
        "sleepers-ollama": existingProvider,
        "sleepers-local": {
          npm: "@ai-sdk/openai-compatible",
          name: "Local endpoint",
          options: { baseURL: "http://127.0.0.1:8080/v1" },
          models: { "local-coder": { name: "local-coder" } },
        },
      },
    });
  });

  it("preserves invalid inline config instead of replacing it", () => {
    const environment = { OPENCODE_CONFIG_CONTENT: "{broken" };
    expect(
      withOpenCodeLocalModels(environment, [ready("ollama", "http://localhost:11434", ["qwen"])]),
    ).toBe(environment);
  });

  it("does nothing for unreachable or empty runtimes", () => {
    const environment = { PATH: "C:\\Tools" };
    const results: ReadonlyArray<LocalModelProbeResult> = [
      {
        status: "unreachable",
        runtime: "ollama",
        baseUrl: "http://localhost:11434",
        reason: "request_failed",
      },
      ready("lmstudio", "http://localhost:1234/v1", []),
    ];
    expect(withOpenCodeLocalModels(environment, results)).toBe(environment);
  });
});

describe("shouldDiscoverOpenCodeLocalModels", () => {
  it("only probes for an enabled, managed OpenCode provider", () => {
    expect(
      shouldDiscoverOpenCodeLocalModels({
        enabled: true,
        discoverLocalModels: true,
        serverUrl: "",
      }),
    ).toBe(true);
    expect(
      shouldDiscoverOpenCodeLocalModels({
        enabled: false,
        discoverLocalModels: true,
        serverUrl: "",
      }),
    ).toBe(false);
    expect(
      shouldDiscoverOpenCodeLocalModels({
        enabled: true,
        discoverLocalModels: false,
        serverUrl: "",
      }),
    ).toBe(false);
    expect(
      shouldDiscoverOpenCodeLocalModels({
        enabled: true,
        discoverLocalModels: true,
        serverUrl: "http://127.0.0.1:4096",
      }),
    ).toBe(false);
  });
});
