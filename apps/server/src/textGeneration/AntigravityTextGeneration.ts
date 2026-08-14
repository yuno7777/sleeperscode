import {
  type AntigravitySettings,
  type ModelSelection,
  TextGenerationError,
} from "@t3tools/contracts";
import { sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils.ts";

const TIMEOUT_MS = 180_000;
const OutputEnvelope = Schema.Struct({ structured_output: Schema.Unknown });
const decodeEnvelope = Schema.decodeEffect(Schema.fromJsonString(OutputEnvelope));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

type Operation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

export const makeAntigravityTextGeneration = Effect.fn("makeAntigravityTextGeneration")(function* (
  settings: AntigravitySettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runJson = Effect.fn("AntigravityTextGeneration.runJson")(function* <
    S extends Schema.Top,
  >(input: {
    readonly operation: Operation;
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchema: S;
    readonly modelSelection: ModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const schemaJson = yield* encodeJson(toJsonSchemaObject(input.outputSchema)).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Failed to encode the Antigravity output schema.",
            cause,
          }),
      ),
    );
    const args = [
      "-p",
      input.prompt,
      "--output-format",
      "json",
      "--json-schema",
      schemaJson,
      "--model",
      input.modelSelection.model,
      "--sandbox",
      "--print-timeout",
      "3m",
    ];
    const resolved = yield* resolveSpawnCommand(settings.binaryPath || "agy", args, {
      env: environment,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Failed to resolve the Antigravity CLI command.",
            cause,
          }),
      ),
    );
    const child = yield* spawner
      .spawn(
        ChildProcess.make(resolved.command, resolved.args, {
          env: environment,
          cwd: input.cwd,
          shell: resolved.shell,
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: input.operation,
              detail: "Failed to start the Antigravity CLI.",
              cause,
            }),
        ),
      );
    const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
      stream.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (all, chunk) => all + chunk,
        ),
      );
    const completed = yield* Effect.all(
      [collect(child.stdout), collect(child.stderr), child.exitCode.pipe(Effect.map(Number))],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Failed while reading Antigravity CLI output.",
            cause,
          }),
      ),
      Effect.timeoutOption(TIMEOUT_MS),
    );
    if (Option.isNone(completed)) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "Antigravity text generation timed out.",
      });
    }
    const [stdout, stderr, exitCode] = completed.value;
    if (exitCode !== 0) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: stderr.trim() || stdout.trim() || `Antigravity exited with code ${exitCode}.`,
      });
    }
    const envelope = yield* decodeEnvelope(stdout).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Antigravity returned an unexpected JSON envelope.",
            cause,
          }),
      ),
    );
    // oxlint-disable-next-line t3code/no-inline-schema-compile -- Each text-generation operation supplies a different schema.
    return yield* Schema.decodeUnknownEffect(input.outputSchema)(envelope.structured_output).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Antigravity returned invalid structured output.",
            cause,
          }),
      ),
    );
  });

  return TextGeneration.TextGeneration.of({
    generateCommitMessage: (input) => {
      const built = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      return runJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        modelSelection: input.modelSelection,
      }).pipe(
        Effect.map((generated) => ({
          subject: sanitizeCommitSubject(generated.subject),
          body: generated.body.trim(),
          ...("branch" in generated && typeof generated.branch === "string"
            ? { branch: sanitizeFeatureBranchName(generated.branch) }
            : {}),
        })),
      );
    },
    generatePrContent: (input) => {
      const built = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        changeRequestTemplate: input.changeRequestTemplate,
        policy: input.policy,
      });
      return runJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        modelSelection: input.modelSelection,
      }).pipe(
        Effect.map((generated) => ({
          title: sanitizePrTitle(generated.title),
          body: generated.body.trim(),
        })),
      );
    },
    generateBranchName: (input) => {
      const built = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      return runJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        modelSelection: input.modelSelection,
      }).pipe(Effect.map((generated) => ({ branch: sanitizeFeatureBranchName(generated.branch) })));
    },
    generateThreadTitle: (input) => {
      const built = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });
      return runJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        modelSelection: input.modelSelection,
      }).pipe(Effect.map((generated) => ({ title: sanitizeThreadTitle(generated.title) })));
    },
  });
});
