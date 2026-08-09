/**
 * Local model runtimes.
 *
 * Phase 30 treats models running on the user's own machine as first-class
 * workers. They cost nothing to run, so cheap repetitive work — classification,
 * summarisation, repository exploration — can go to them instead of to a metered
 * provider.
 *
 * Three runtimes are modelled. Ollama has its own listing endpoint; LM Studio
 * and anything else exposing the OpenAI shape share one. Endpoint paths and the
 * Ollama payload were taken from vendor documentation rather than assumed.
 *
 * @module localModel
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LocalModelRuntime = Schema.Literals(["ollama", "lmstudio", "openai-compatible"]);
export type LocalModelRuntime = typeof LocalModelRuntime.Type;

/**
 * Base URLs a runtime listens on out of the box.
 *
 * `openai-compatible` has no default: it describes any server speaking the
 * OpenAI shape, so the user has to say where it is.
 */
export const LOCAL_MODEL_DEFAULT_BASE_URL: Partial<Record<LocalModelRuntime, string>> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234/v1",
};

/**
 * URL that lists the models a runtime currently has.
 *
 * `baseUrl` is taken as given, including any version segment, because an
 * OpenAI-compatible server may be mounted under a prefix. Trailing slashes are
 * tolerated so a user pasting from a browser bar gets a working URL.
 */
export const localModelListUrl = (runtime: LocalModelRuntime, baseUrl: string): string => {
  const base = baseUrl.replace(/\/+$/, "");
  return runtime === "ollama" ? `${base}/api/tags` : `${base}/models`;
};

/**
 * One model available locally.
 *
 * Cost is deliberately not a field. Every local model is free to run, so a
 * constant zero on each record would carry no information; callers branch on the
 * fact that it is local.
 */
export const LocalModel = Schema.Struct({
  /** Identifier passed back to the runtime when requesting this model. */
  id: TrimmedNonEmptyString,
  runtime: LocalModelRuntime,
  /** Reported parameter count, such as `7.6B`. Ollama only. */
  parameterSize: Schema.optional(TrimmedNonEmptyString),
  /** Reported quantisation, such as `Q4_K_M`. Ollama only. */
  quantization: Schema.optional(TrimmedNonEmptyString),
  /** Model family, such as `qwen2`. Ollama only. */
  family: Schema.optional(TrimmedNonEmptyString),
  /** On-disk size in bytes. Ollama only, and the closest available proxy for how much memory a model will want. */
  sizeBytes: Schema.optional(Schema.Number),
});
export type LocalModel = typeof LocalModel.Type;

const OllamaModelDetails = Schema.Struct({
  family: Schema.optional(Schema.String),
  parameter_size: Schema.optional(Schema.String),
  quantization_level: Schema.optional(Schema.String),
});

const OllamaTagsEntry = Schema.Struct({
  name: Schema.String,
  model: Schema.optional(Schema.String),
  size: Schema.optional(Schema.Number),
  details: Schema.optional(OllamaModelDetails),
});

const OllamaTagsResponse = Schema.Struct({
  models: Schema.Array(Schema.Unknown),
});

const OpenAiModelsEntry = Schema.Struct({
  id: Schema.String,
});

const OpenAiModelsResponse = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
});

const decodeOllamaResponse = Schema.decodeUnknownOption(OllamaTagsResponse);
const decodeOllamaEntry = Schema.decodeUnknownOption(OllamaTagsEntry);
const decodeOpenAiResponse = Schema.decodeUnknownOption(OpenAiModelsResponse);
const decodeOpenAiEntry = Schema.decodeUnknownOption(OpenAiModelsEntry);

const trimmedOrUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Reads Ollama's `GET /api/tags` payload.
 *
 * Entries that cannot be read are skipped rather than failing the list: one
 * malformed model should not hide every other model the user has pulled.
 */
export const parseOllamaModels = (payload: unknown): ReadonlyArray<LocalModel> => {
  const response = decodeOllamaResponse(payload);
  if (response._tag === "None") return [];
  const models: Array<LocalModel> = [];
  for (const raw of response.value.models) {
    const entry = decodeOllamaEntry(raw);
    if (entry._tag === "None") continue;
    const id = (entry.value.model ?? entry.value.name).trim();
    if (id.length === 0) continue;
    models.push({
      id,
      runtime: "ollama",
      ...(trimmedOrUndefined(entry.value.details?.parameter_size) !== undefined
        ? { parameterSize: trimmedOrUndefined(entry.value.details?.parameter_size)! }
        : {}),
      ...(trimmedOrUndefined(entry.value.details?.quantization_level) !== undefined
        ? { quantization: trimmedOrUndefined(entry.value.details?.quantization_level)! }
        : {}),
      ...(trimmedOrUndefined(entry.value.details?.family) !== undefined
        ? { family: trimmedOrUndefined(entry.value.details?.family)! }
        : {}),
      ...(entry.value.size !== undefined ? { sizeBytes: entry.value.size } : {}),
    });
  }
  return models;
};

/**
 * Reads an OpenAI-shaped `GET /models` payload.
 *
 * Only `id` is required. Servers differ on what else they report, and demanding
 * more would reject working runtimes over fields nothing here uses.
 */
export const parseOpenAiCompatibleModels = (
  payload: unknown,
  runtime: LocalModelRuntime,
): ReadonlyArray<LocalModel> => {
  const response = decodeOpenAiResponse(payload);
  if (response._tag === "None") return [];
  const models: Array<LocalModel> = [];
  for (const raw of response.value.data) {
    const entry = decodeOpenAiEntry(raw);
    if (entry._tag === "None") continue;
    const id = entry.value.id.trim();
    if (id.length === 0) continue;
    models.push({ id, runtime });
  }
  return models;
};

/** Reads whichever payload shape the runtime produces. */
export const parseLocalModels = (
  payload: unknown,
  runtime: LocalModelRuntime,
): ReadonlyArray<LocalModel> =>
  runtime === "ollama" ? parseOllamaModels(payload) : parseOpenAiCompatibleModels(payload, runtime);
