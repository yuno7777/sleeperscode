/**
 * Typed boundary for OpenCode's documented `opencode db --format json` usage
 * aggregate. The query deliberately selects only timestamps, IDs, token totals,
 * and cost; session messages and prompts never enter this module.
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

const OpenCodeUsageRow = Schema.Struct({
  sessionId: Schema.String,
  timestampMs: NonNegativeNumber,
  providerId: Schema.String,
  modelId: Schema.String,
  inputTokens: NonNegativeNumber,
  outputTokens: NonNegativeNumber,
  cacheReadTokens: NonNegativeNumber,
  cacheWriteTokens: NonNegativeNumber,
  reasoningTokens: NonNegativeNumber,
  costUsd: NonNegativeNumber,
});

export type OpenCodeUsageRow = typeof OpenCodeUsageRow.Type;

const OpenCodeUsageRowsJson = Schema.fromJsonString(Schema.Array(OpenCodeUsageRow));

export class OpenCodeUsageDecodeError extends Data.TaggedError("OpenCodeUsageDecodeError")<{
  readonly detail: string;
}> {}

export const decodeOpenCodeUsageRows = (input: string) =>
  Schema.decodeEffect(OpenCodeUsageRowsJson)(input).pipe(
    Effect.mapError(
      () => new OpenCodeUsageDecodeError({ detail: "OpenCode returned invalid usage data." }),
    ),
  );

/**
 * Stable read-only query for OpenCode's local database. `time_updated` is the
 * completed assistant-message timestamp, which is the narrowest durable event
 * OpenCode exposes for daily usage bucketing.
 */
export const openCodeUsageQuery = (sinceMs: number, untilMs: number): string =>
  `SELECT
    session_id AS sessionId,
    time_updated AS timestampMs,
    json_extract(data, '$.providerID') AS providerId,
    json_extract(data, '$.modelID') AS modelId,
    COALESCE(json_extract(data, '$.tokens.input'), 0) AS inputTokens,
    COALESCE(json_extract(data, '$.tokens.output'), 0) AS outputTokens,
    COALESCE(json_extract(data, '$.tokens.cache.read'), 0) AS cacheReadTokens,
    COALESCE(json_extract(data, '$.tokens.cache.write'), 0) AS cacheWriteTokens,
    COALESCE(json_extract(data, '$.tokens.reasoning'), 0) AS reasoningTokens,
    COALESCE(json_extract(data, '$.cost'), 0) AS costUsd
  FROM message
  WHERE json_extract(data, '$.tokens') IS NOT NULL
    AND time_updated >= ${Math.max(0, Math.trunc(sinceMs))}
    AND time_updated <= ${Math.max(0, Math.trunc(untilMs))}
  ORDER BY time_updated ASC, id ASC`;
