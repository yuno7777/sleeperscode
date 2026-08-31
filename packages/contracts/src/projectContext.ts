import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { TaskRepositoryEvidence } from "./taskProfile.ts";

export const PROJECT_CONTEXT_MAX_DOCUMENTS = 24;
export const PROJECT_CONTEXT_MAX_RELATED_THREADS = 24;
export const PROJECT_CONTEXT_MAX_CHECKPOINTS = 12;
export const PROJECT_HANDOFF_MAX_ITEMS = 24;
export const PROJECT_KNOWLEDGE_NOTE_MAX_ITEMS = 100;

/** A workspace-relative path deliberately safe to show and open within its project. */
export const ProjectContextPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/^(?![\\/])(?![a-zA-Z]:[\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/),
);
export type ProjectContextPath = typeof ProjectContextPath.Type;

export const ProjectContextDocumentKind = Schema.Literals(["guide", "rule", "reference"]);
export type ProjectContextDocumentKind = typeof ProjectContextDocumentKind.Type;

export const ProjectContextDocument = Schema.Struct({
  path: ProjectContextPath,
  kind: ProjectContextDocumentKind,
});
export type ProjectContextDocument = typeof ProjectContextDocument.Type;

export const ProjectContextRelatedThread = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  active: Schema.Boolean,
  sharesWorktreeWithCurrentThread: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type ProjectContextRelatedThread = typeof ProjectContextRelatedThread.Type;

export const ProjectContextCheckpoint = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  fileCount: NonNegativeInt,
  completedAt: IsoDateTime,
});
export type ProjectContextCheckpoint = typeof ProjectContextCheckpoint.Type;

/** User-editable, reviewable content. It is never generated or published implicitly. */
export const ProjectHandoffSummary = Schema.Struct({
  changed: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(500))).check(
    Schema.isMaxLength(PROJECT_HANDOFF_MAX_ITEMS),
  ),
  decisions: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(500))).check(
    Schema.isMaxLength(PROJECT_HANDOFF_MAX_ITEMS),
  ),
  verification: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(500))).check(
    Schema.isMaxLength(PROJECT_HANDOFF_MAX_ITEMS),
  ),
  remaining: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(500))).check(
    Schema.isMaxLength(PROJECT_HANDOFF_MAX_ITEMS),
  ),
});
export type ProjectHandoffSummary = typeof ProjectHandoffSummary.Type;

export const ProjectHandoff = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  summary: ProjectHandoffSummary,
  savedAt: IsoDateTime,
});
export type ProjectHandoff = typeof ProjectHandoff.Type;

export const ProjectKnowledgeNote = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  threadId: ThreadId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  summary: ProjectHandoffSummary,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectKnowledgeNote = typeof ProjectKnowledgeNote.Type;

/** The server-built briefing shown before a turn starts, with visible local sources. */
export const ProjectContextSnapshot = Schema.Struct({
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  currentBranch: Schema.NullOr(TrimmedNonEmptyString),
  repositoryEvidence: Schema.NullOr(TaskRepositoryEvidence),
  documents: Schema.Array(ProjectContextDocument).check(
    Schema.isMaxLength(PROJECT_CONTEXT_MAX_DOCUMENTS),
  ),
  rules: Schema.Array(ProjectContextDocument).check(
    Schema.isMaxLength(PROJECT_CONTEXT_MAX_DOCUMENTS),
  ),
  recentCheckpoints: Schema.Array(ProjectContextCheckpoint).check(
    Schema.isMaxLength(PROJECT_CONTEXT_MAX_CHECKPOINTS),
  ),
  relatedThreads: Schema.Array(ProjectContextRelatedThread).check(
    Schema.isMaxLength(PROJECT_CONTEXT_MAX_RELATED_THREADS),
  ),
  handoffs: Schema.Array(ProjectHandoff).check(Schema.isMaxLength(PROJECT_HANDOFF_MAX_ITEMS)),
  knowledgeNotes: Schema.Array(ProjectKnowledgeNote).check(
    Schema.isMaxLength(PROJECT_KNOWLEDGE_NOTE_MAX_ITEMS),
  ),
  generatedAt: IsoDateTime,
});
export type ProjectContextSnapshot = typeof ProjectContextSnapshot.Type;
