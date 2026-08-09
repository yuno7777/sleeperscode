import { describe, expect, it } from "vite-plus/test";

import {
  LOCAL_MODEL_DEFAULT_BASE_URL,
  localModelListUrl,
  parseLocalModels,
  parseOllamaModels,
  parseOpenAiCompatibleModels,
} from "./localModel.ts";

/** Copied verbatim from Ollama's documented `GET /api/tags` example. */
const ollamaTagsPayload = {
  models: [
    {
      name: "deepseek-r1:latest",
      model: "deepseek-r1:latest",
      modified_at: "2025-05-10T08:06:48.639712648-07:00",
      size: 4683075271,
      digest: "0a8c266910232fd3291e71e5ba1e058cc5af9d411192cf88b6d30e92b6e73163",
      details: {
        parent_model: "",
        format: "gguf",
        family: "qwen2",
        families: ["qwen2"],
        parameter_size: "7.6B",
        quantization_level: "Q4_K_M",
      },
    },
    {
      name: "llama3.2:latest",
      model: "llama3.2:latest",
      modified_at: "2025-05-04T17:37:44.706015396-07:00",
      size: 2019393189,
      digest: "a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72",
      details: {
        parent_model: "",
        format: "gguf",
        family: "llama",
        families: ["llama"],
        parameter_size: "3.2B",
        quantization_level: "Q4_K_M",
      },
    },
  ],
};

describe("localModelListUrl", () => {
  it("uses Ollama's own listing endpoint", () => {
    expect(localModelListUrl("ollama", "http://localhost:11434")).toBe(
      "http://localhost:11434/api/tags",
    );
  });

  it("appends models to an OpenAI-shaped base that already carries its version", () => {
    expect(localModelListUrl("lmstudio", "http://localhost:1234/v1")).toBe(
      "http://localhost:1234/v1/models",
    );
  });

  it("tolerates a trailing slash from a pasted URL", () => {
    expect(localModelListUrl("openai-compatible", "http://localhost:8000/v1/")).toBe(
      "http://localhost:8000/v1/models",
    );
  });

  it("ships defaults only for runtimes that have one", () => {
    expect(LOCAL_MODEL_DEFAULT_BASE_URL.ollama).toBe("http://localhost:11434");
    expect(LOCAL_MODEL_DEFAULT_BASE_URL.lmstudio).toBe("http://localhost:1234/v1");
    expect(LOCAL_MODEL_DEFAULT_BASE_URL["openai-compatible"]).toBeUndefined();
  });
});

describe("parseOllamaModels", () => {
  it("reads the documented payload", () => {
    expect(parseOllamaModels(ollamaTagsPayload)).toEqual([
      {
        id: "deepseek-r1:latest",
        runtime: "ollama",
        parameterSize: "7.6B",
        quantization: "Q4_K_M",
        family: "qwen2",
        sizeBytes: 4683075271,
      },
      {
        id: "llama3.2:latest",
        runtime: "ollama",
        parameterSize: "3.2B",
        quantization: "Q4_K_M",
        family: "llama",
        sizeBytes: 2019393189,
      },
    ]);
  });

  it("falls back to name when model is absent", () => {
    const models = parseOllamaModels({ models: [{ name: "mistral:7b" }] });
    expect(models).toEqual([{ id: "mistral:7b", runtime: "ollama" }]);
  });

  it("skips unreadable entries instead of hiding the rest", () => {
    const models = parseOllamaModels({
      models: [{ name: "good:latest" }, { nope: true }, 42, { name: "   " }],
    });
    expect(models.map((model) => model.id)).toEqual(["good:latest"]);
  });

  it("returns nothing for a payload that is not an Ollama response", () => {
    expect(parseOllamaModels({ data: [] })).toEqual([]);
    expect(parseOllamaModels(null)).toEqual([]);
  });

  it("omits optional details rather than emitting empty strings", () => {
    const models = parseOllamaModels({
      models: [{ name: "bare:latest", details: { family: "", parameter_size: "  " } }],
    });
    expect(models).toEqual([{ id: "bare:latest", runtime: "ollama" }]);
  });
});

describe("parseOpenAiCompatibleModels", () => {
  it("reads an OpenAI-shaped listing", () => {
    const payload = {
      object: "list",
      data: [
        { id: "qwen2.5-coder-7b-instruct", object: "model", owned_by: "organization_owner" },
        { id: "nomic-embed-text-v1.5", object: "model" },
      ],
    };
    expect(parseOpenAiCompatibleModels(payload, "lmstudio")).toEqual([
      { id: "qwen2.5-coder-7b-instruct", runtime: "lmstudio" },
      { id: "nomic-embed-text-v1.5", runtime: "lmstudio" },
    ]);
  });

  it("requires only an id, so unfamiliar servers still work", () => {
    expect(parseOpenAiCompatibleModels({ data: [{ id: "x" }] }, "openai-compatible")).toEqual([
      { id: "x", runtime: "openai-compatible" },
    ]);
  });

  it("skips entries without a usable id", () => {
    const models = parseOpenAiCompatibleModels(
      { data: [{ id: "keep" }, { id: "" }, { object: "model" }] },
      "openai-compatible",
    );
    expect(models.map((model) => model.id)).toEqual(["keep"]);
  });
});

describe("parseLocalModels", () => {
  it("dispatches on runtime", () => {
    expect(parseLocalModels(ollamaTagsPayload, "ollama")).toHaveLength(2);
    expect(parseLocalModels({ data: [{ id: "a" }] }, "lmstudio")).toEqual([
      { id: "a", runtime: "lmstudio" },
    ]);
  });

  it("does not read an Ollama payload as an OpenAI one", () => {
    expect(parseLocalModels(ollamaTagsPayload, "lmstudio")).toEqual([]);
  });
});
