import {
  type AntigravitySettings,
  EventId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ToolLifecycleItemType,
} from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { collectUint8StreamText } from "../../stream/collectUint8StreamText.ts";
import {
  type ProviderAdapterError,
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");
const RESUME_SCHEMA_VERSION = 1 as const;
const DEFAULT_PRINT_TIMEOUT = "5m";

type AntigravityUsage = {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly thinking_tokens?: number;
  readonly cache_read_tokens?: number;
  readonly total_tokens?: number;
};

type AntigravityStreamEvent =
  | {
      readonly event: "init";
      readonly conversation_id?: string;
      readonly init?: {
        readonly tools?: ReadonlyArray<string>;
        readonly permission_mode?: string;
        readonly cwd?: string;
      };
    }
  | {
      readonly event: "step_update";
      readonly step_update?: {
        readonly conversation_id?: string;
        readonly step_index?: number;
        readonly state?: string;
        readonly step_type?: string;
        readonly text_delta?: string;
        readonly tool_name?: string;
        readonly tool_info?: {
          readonly name?: string;
          readonly parameters?: unknown;
          readonly output?: unknown;
          readonly error?: unknown;
        };
        readonly subagent_info?: unknown;
        readonly usage?: AntigravityUsage;
      };
    }
  | {
      readonly event: "result";
      readonly result?: {
        readonly conversation_id?: string;
        readonly status?: string;
        readonly response?: string;
        readonly error?: string;
        readonly duration_seconds?: number;
        readonly usage?: AntigravityUsage;
      };
    };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseAntigravityStreamLine(line: string): AntigravityStreamEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  const value = record(parsed);
  if (!value || !["init", "step_update", "result"].includes(String(value.event))) {
    return undefined;
  }
  return value as AntigravityStreamEvent;
}

export function antigravityToolItemType(toolName: string): ToolLifecycleItemType {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("search_web") || normalized.includes("read_url")) return "web_search";
  if (normalized.includes("command")) return "command_execution";
  if (normalized.includes("write") || normalized.includes("replace")) return "file_change";
  if (normalized.includes("mcp")) return "mcp_tool_call";
  if (normalized.includes("subagent") || normalized.includes("agent")) {
    return "collab_agent_tool_call";
  }
  if (normalized.includes("image") || normalized.includes("screenshot")) return "image_view";
  return "dynamic_tool_call";
}

/**
 * Antigravity can expose subagent tools, but a Sleepers Code provider turn is
 * a direct worker by default. Keep the boundary deterministic and local to the
 * adapter so callers cannot accidentally reintroduce nested orchestration.
 */
export function buildAntigravityPrompt(input: {
  readonly text: string;
  readonly allowNativeOrchestration: boolean;
}): string {
  if (input.allowNativeOrchestration) return input.text;
  return [
    "You are a direct worker inside Sleepers Code.",
    "Do not spawn or delegate to subagents, and do not recursively invoke another orchestrator.",
    "Complete the requested work yourself using the available tools.",
    "",
    input.text,
  ].join("\n");
}

function parseResumeCursor(value: unknown): string | undefined {
  const candidate = record(value);
  return candidate?.schemaVersion === RESUME_SCHEMA_VERSION &&
    typeof candidate.conversationId === "string" &&
    candidate.conversationId.trim().length > 0
    ? candidate.conversationId.trim()
    : undefined;
}

interface TurnRecord {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface SessionContext {
  session: ProviderSession;
  readonly sandboxMode: "read-only" | "workspace-write" | "danger-full-access" | undefined;
  conversationId: string | undefined;
  turns: Array<TurnRecord>;
  activeKill: (() => Effect.Effect<void>) | undefined;
  activeTurnId: TurnId | undefined;
  interrupted: boolean;
  stopped: boolean;
}

export interface AntigravityAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
}

export const makeAntigravityAdapter = Effect.fn("makeAntigravityAdapter")(function* (
  settings: AntigravitySettings,
  options?: AntigravityAdapterOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("antigravity");
  const environment = options?.environment ?? process.env;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, SessionContext>();
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const nextId = crypto.randomUUIDv4.pipe(
    Effect.map(String),
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to create an Antigravity runtime identifier.",
          cause,
        }),
    ),
  );
  const stamp = () => Effect.all({ eventId: Effect.map(nextId, EventId.make), createdAt: nowIso });
  const publish = (event: ProviderRuntimeEvent) =>
    PubSub.publish(events, event).pipe(Effect.asVoid);
  const baseEvent = (threadId: ThreadId, turnId?: TurnId) => ({
    provider: PROVIDER,
    providerInstanceId: boundInstanceId,
    threadId,
    ...(turnId ? { turnId } : {}),
  });

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<SessionContext, ProviderAdapterSessionNotFoundError> => {
    const context = sessions.get(threadId);
    return context && !context.stopped
      ? Effect.succeed(context)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };

  const updateConversation = (context: SessionContext, conversationId: string | undefined) => {
    const resolved = conversationId?.trim();
    if (!resolved) return;
    context.conversationId = resolved;
    context.session = {
      ...context.session,
      resumeCursor: { schemaVersion: RESUME_SCHEMA_VERSION, conversationId: resolved },
    };
  };

  const emitAssistantStep = Effect.fn("AntigravityAdapter.emitAssistantStep")(function* (
    context: SessionContext,
    threadId: ThreadId,
    turnId: TurnId,
    step: NonNullable<Extract<AntigravityStreamEvent, { event: "step_update" }>["step_update"]>,
    raw: AntigravityStreamEvent,
  ) {
    const stepIndex = step.step_index ?? 0;
    const itemId = RuntimeItemId.make(`antigravity-response-${stepIndex}`);
    const turn = context.turns.find((candidate) => candidate.id === turnId);
    if (!turn) return;
    const state = step.state?.toUpperCase();
    const marker = `assistant:${stepIndex}`;
    const started = turn.items.some((item) => record(item)?.marker === marker);
    if (!started) {
      turn.items.push({ marker, kind: "assistant", raw });
      yield* publish({
        type: "item.started",
        ...(yield* stamp()),
        ...baseEvent(threadId, turnId),
        itemId,
        payload: { itemType: "assistant_message", status: "inProgress" },
      });
    }
    if (typeof step.text_delta === "string" && step.text_delta.length > 0) {
      yield* publish({
        type: "content.delta",
        ...(yield* stamp()),
        ...baseEvent(threadId, turnId),
        itemId,
        payload: { streamKind: "assistant_text", delta: step.text_delta },
        raw: { source: "antigravity.cli.stream-json", payload: raw },
      });
    }
    if (state === "DONE") {
      yield* publish({
        type: "item.completed",
        ...(yield* stamp()),
        ...baseEvent(threadId, turnId),
        itemId,
        payload: { itemType: "assistant_message", status: "completed" },
      });
    }
  });

  const emitToolStep = Effect.fn("AntigravityAdapter.emitToolStep")(function* (
    context: SessionContext,
    threadId: ThreadId,
    turnId: TurnId,
    step: NonNullable<Extract<AntigravityStreamEvent, { event: "step_update" }>["step_update"]>,
    raw: AntigravityStreamEvent,
  ) {
    const stepIndex = step.step_index ?? 0;
    const itemId = RuntimeItemId.make(`antigravity-tool-${stepIndex}`);
    const toolName = step.tool_info?.name ?? step.tool_name ?? "Antigravity tool";
    const state = step.state?.toUpperCase();
    const failed = step.tool_info?.error !== undefined;
    const type = state === "DONE" ? "item.completed" : "item.started";
    const turn = context.turns.find((candidate) => candidate.id === turnId);
    const marker = `tool:${stepIndex}`;
    if (type === "item.started") {
      if (turn?.items.some((item) => record(item)?.marker === marker)) return;
      turn?.items.push({ marker, kind: "tool", raw });
    }
    yield* publish({
      type,
      ...(yield* stamp()),
      ...baseEvent(threadId, turnId),
      itemId,
      payload: {
        itemType: antigravityToolItemType(toolName),
        status: state === "DONE" ? (failed ? "failed" : "completed") : "inProgress",
        title: toolName,
        data: step.tool_info ?? step.subagent_info ?? raw,
      },
      raw: { source: "antigravity.cli.stream-json", payload: raw },
    });
  });

  const emitUsage = Effect.fn("AntigravityAdapter.emitUsage")(function* (
    threadId: ThreadId,
    turnId: TurnId,
    usage: AntigravityUsage | undefined,
    model: string | undefined,
    durationSeconds?: number,
  ) {
    if (!usage) return;
    const total = Math.max(0, usage.total_tokens ?? 0);
    yield* publish({
      type: "thread.token-usage.updated",
      ...(yield* stamp()),
      ...baseEvent(threadId, turnId),
      payload: {
        usage: {
          usedTokens: total,
          totalProcessedTokens: total,
          inputTokens: Math.max(0, usage.input_tokens ?? 0),
          cachedInputTokens: Math.max(0, usage.cache_read_tokens ?? 0),
          outputTokens: Math.max(0, usage.output_tokens ?? 0),
          reasoningOutputTokens: Math.max(0, usage.thinking_tokens ?? 0),
          ...(durationSeconds === undefined
            ? {}
            : { durationMs: Math.max(0, Math.round(durationSeconds * 1000)) }),
        },
      },
      raw: {
        source: "antigravity.cli.stream-json",
        payload: {
          ...(model ? { model } : {}),
          usage,
        },
      },
    });
  });

  const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
    Effect.gen(function* () {
      const current = sessions.get(input.threadId);
      if (current && !current.stopped) return current.session;
      const now = yield* nowIso;
      const conversationId = parseResumeCursor(input.resumeCursor);
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.modelSelection?.instanceId === boundInstanceId
          ? { model: input.modelSelection.model }
          : {}),
        threadId: input.threadId,
        ...(conversationId
          ? { resumeCursor: { schemaVersion: RESUME_SCHEMA_VERSION, conversationId } }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(input.threadId, {
        session,
        sandboxMode: input.sandboxMode,
        conversationId,
        turns: [],
        activeKill: undefined,
        activeTurnId: undefined,
        interrupted: false,
        stopped: false,
      });
      yield* publish({
        type: "session.started",
        ...(yield* stamp()),
        ...baseEvent(input.threadId),
        payload: conversationId ? { resume: { conversationId } } : {},
      });
      yield* publish({
        type: "session.state.changed",
        ...(yield* stamp()),
        ...baseEvent(input.threadId),
        payload: { state: "ready", reason: "Antigravity headless session ready" },
      });
      yield* publish({
        type: "thread.started",
        ...(yield* stamp()),
        ...baseEvent(input.threadId),
        payload: conversationId ? { providerThreadId: conversationId } : {},
      });
      return session;
    });

  const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      if (context.activeTurnId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Antigravity does not accept steering while a headless turn is running.",
        });
      }
      if ((input.attachments?.length ?? 0) > 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "The documented Antigravity headless interface does not accept attachments.",
        });
      }
      const text = input.input?.trim();
      if (!text) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Turn requires non-empty text.",
        });
      }

      const turnId = TurnId.make(yield* nextId);
      const selection =
        input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
      const boundedPrompt = buildAntigravityPrompt({
        text,
        allowNativeOrchestration: settings.allowNativeOrchestration,
      });
      const args = [
        "-p",
        boundedPrompt,
        "--output-format",
        "stream-json",
        "--print-timeout",
        DEFAULT_PRINT_TIMEOUT,
        ...(selection ? ["--model", selection.model] : []),
        ...(input.interactionMode === "plan" ? ["--mode", "plan"] : []),
        ...(context.conversationId ? ["--conversation", context.conversationId] : []),
        ...(context.sandboxMode !== "danger-full-access" ? ["--sandbox"] : []),
        ...(context.session.runtimeMode === "full-access" &&
        context.sandboxMode === "danger-full-access"
          ? ["--dangerously-skip-permissions"]
          : []),
      ];
      const resolved = yield* resolveSpawnCommand(settings.binaryPath || "agy", args, {
        env: environment,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: "Failed to resolve the Antigravity CLI command.",
              cause,
            }),
        ),
      );
      const command = ChildProcess.make(resolved.command, resolved.args, {
        env: environment,
        cwd: context.session.cwd,
        shell: resolved.shell,
      });
      const child = yield* spawner.spawn(command).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: "Failed to start Antigravity CLI.",
              cause,
            }),
        ),
      );

      context.activeTurnId = turnId;
      context.activeKill = () =>
        child.kill({ forceKillAfter: "1 second" }).pipe(
          Effect.asVoid,
          Effect.catch(() => Effect.void),
        );
      context.interrupted = false;
      context.turns.push({ id: turnId, items: [] });
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        ...(selection ? { model: selection.model } : {}),
        updatedAt: yield* nowIso,
      };
      yield* publish({
        type: "turn.started",
        ...(yield* stamp()),
        ...baseEvent(input.threadId, turnId),
        payload: selection ? { model: selection.model } : {},
      });

      let terminalResult:
        | Extract<AntigravityStreamEvent, { event: "result" }>["result"]
        | undefined;
      const consumeStdout = child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) => {
          const parsed = parseAntigravityStreamLine(line);
          if (!parsed) return Effect.void;
          const turn = context.turns.find((candidate) => candidate.id === turnId);
          turn?.items.push(parsed);
          if (parsed.event === "init") {
            updateConversation(context, parsed.conversation_id);
            return stamp().pipe(
              Effect.flatMap((metadata) =>
                publish({
                  type: "session.configured",
                  ...metadata,
                  ...baseEvent(input.threadId, turnId),
                  payload: {
                    config: {
                      integrationTransport: "documented-json-stream",
                      tools: parsed.init?.tools ?? [],
                      webSearch: parsed.init?.tools?.includes("search_web") ?? false,
                      urlFetch: parsed.init?.tools?.includes("read_url_content") ?? false,
                      nativeOrchestration: settings.allowNativeOrchestration,
                      permissionMode: parsed.init?.permission_mode ?? "unknown",
                    },
                  },
                  raw: { source: "antigravity.cli.stream-json", payload: parsed },
                }),
              ),
            );
          }
          if (parsed.event === "step_update" && parsed.step_update) {
            updateConversation(context, parsed.step_update.conversation_id);
            if (parsed.step_update.step_type === "agent_response") {
              return emitAssistantStep(context, input.threadId, turnId, parsed.step_update, parsed);
            }
            if (
              parsed.step_update.step_type === "tool" ||
              parsed.step_update.tool_info !== undefined ||
              parsed.step_update.subagent_info !== undefined
            ) {
              return emitToolStep(context, input.threadId, turnId, parsed.step_update, parsed);
            }
            return Effect.void;
          }
          if (parsed.event === "result" && parsed.result) {
            terminalResult = parsed.result;
            updateConversation(context, parsed.result.conversation_id);
            return emitUsage(
              input.threadId,
              turnId,
              parsed.result.usage,
              selection?.model ?? context.session.model,
              parsed.result.duration_seconds,
            );
          }
          return Effect.void;
        }),
      );
      const [stderr, exitCode] = yield* Effect.all(
        [
          collectUint8StreamText({ stream: child.stderr, maxBytes: 64 * 1024 }).pipe(
            Effect.map((collected) => collected.text),
          ),
          child.exitCode.pipe(Effect.map(Number)),
          consumeStdout,
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map(([stderrText, code]) => [stderrText, code] as const),
        Effect.mapError(
          (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: "Failed while reading Antigravity CLI output.",
              cause,
            }),
        ),
      );

      context.activeKill = undefined;
      context.activeTurnId = undefined;
      const { activeTurnId: _activeTurnId, ...readySession } = context.session;
      context.session = {
        ...readySession,
        status: context.interrupted ? "ready" : exitCode === 0 ? "ready" : "error",
        updatedAt: yield* nowIso,
        ...(exitCode === 0
          ? {}
          : { lastError: stderr.trim() || `Antigravity exited with code ${exitCode}.` }),
      };

      const status = terminalResult?.status?.toUpperCase();
      const state = context.interrupted
        ? "interrupted"
        : status === "CANCELED"
          ? "cancelled"
          : status === "INTERRUPTED"
            ? "interrupted"
            : exitCode === 0 && status === "SUCCESS"
              ? "completed"
              : "failed";
      yield* publish({
        type: "turn.completed",
        ...(yield* stamp()),
        ...baseEvent(input.threadId, turnId),
        payload: {
          state,
          stopReason: status ?? (context.interrupted ? "INTERRUPTED" : null),
          ...(terminalResult?.usage ? { usage: terminalResult.usage } : {}),
          ...(state === "failed"
            ? {
                errorMessage:
                  terminalResult?.error?.trim() ||
                  stderr.trim() ||
                  `Antigravity exited with code ${exitCode}.`,
              }
            : {}),
        },
      });

      if (state === "failed") {
        return yield* new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail:
            terminalResult?.error?.trim() ||
            stderr.trim() ||
            `Antigravity exited with code ${exitCode}.`,
        });
      }
      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: context.session.resumeCursor,
      };
    }).pipe(Effect.scoped);

  const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
    threadId,
    turnId,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      if (turnId && context.activeTurnId && turnId !== context.activeTurnId) return;
      context.interrupted = true;
      yield* context.activeKill?.() ?? Effect.void;
    });

  const unsupportedRequest = (operation: string) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation,
        issue:
          "Antigravity headless mode does not expose an interactive approval or user-input response channel.",
      }),
    );

  const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      context.interrupted = true;
      yield* context.activeKill?.() ?? Effect.void;
      context.stopped = true;
      context.activeKill = undefined;
      context.activeTurnId = undefined;
      context.session = { ...context.session, status: "closed", updatedAt: yield* nowIso };
      yield* publish({
        type: "session.exited",
        ...(yield* stamp()),
        ...baseEvent(threadId),
        payload: { exitKind: "graceful", reason: "Antigravity session stopped" },
      });
    });

  const adapter: ProviderAdapterShape<ProviderAdapterError> = {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "unsupported",
      integrationTransport: "documented-json-stream",
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest: () => unsupportedRequest("respondToRequest"),
    respondToUserInput: () => unsupportedRequest("respondToUserInput"),
    stopSession,
    listSessions: () =>
      Effect.succeed(
        Array.from(sessions.values())
          .filter((context) => !context.stopped)
          .map((context) => context.session),
      ),
    hasSession: (threadId) => Effect.succeed(sessions.get(threadId)?.stopped === false),
    readThread: (threadId) =>
      requireSession(threadId).pipe(
        Effect.map((context) => ({
          threadId,
          turns: context.turns.map((turn) => ({ id: turn.id, items: turn.items })),
        })),
      ),
    rollbackThread: (threadId) =>
      requireSession(threadId).pipe(
        Effect.flatMap(() =>
          Effect.fail(
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "rollbackThread",
              issue: "Antigravity conversation rollback is not exposed by the documented CLI.",
            }),
          ),
        ),
      ),
    stopAll: () =>
      Effect.forEach(
        Array.from(sessions.entries()).filter(([, context]) => !context.stopped),
        ([threadId]) => stopSession(threadId),
        { discard: true },
      ),
    streamEvents: Stream.fromPubSub(events),
  };

  return adapter;
});
