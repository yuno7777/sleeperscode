import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { TaskProfile } from "./taskProfile.ts";

const validProfile = {
  version: 1,
  kinds: ["implementation"],
  complexity: { score: 42, band: "medium" },
  domains: { frontend: 75, backend: 0, systems: 0, research: 0 },
  visualRequirement: "required",
  reasoningRequirement: "medium",
  repoContextRequirement: "high",
  expectedFiles: "few",
  expectedDuration: "medium",
  parallelizable: false,
  testingRequirement: "focused",
  securitySensitivity: "normal",
  toolRequirements: ["filesystem", "shell", "browser"],
  collaboration: "single-worker",
  signals: ["implementation-request", "frontend-domain", "visual-requirement"],
} as const;

describe("TaskProfile", () => {
  it("decodes bounded, content-free routing metadata", () => {
    expect(Schema.decodeUnknownSync(TaskProfile)(validProfile)).toEqual(validProfile);
  });

  it("rejects scores outside the documented range", () => {
    expect(() =>
      Schema.decodeUnknownSync(TaskProfile)({
        ...validProfile,
        complexity: { score: 101, band: "very-high" },
      }),
    ).toThrow();
  });

  it("rejects free-form signals that could carry prompt content", () => {
    expect(() =>
      Schema.decodeUnknownSync(TaskProfile)({
        ...validProfile,
        signals: ["user-secret-value"],
      }),
    ).toThrow();
  });

  it("decodes bounded server-owned repository evidence", () => {
    const repositoryEvidence = {
      version: 1,
      source: "root-markers",
      markers: ["package-json", "tsconfig-json"],
      languages: ["typescript"],
      frameworks: ["react"],
      testRunners: ["vitest"],
      workspace: "single-package",
      limited: false,
    } as const;

    expect(Schema.decodeUnknownSync(TaskProfile)({ ...validProfile, repositoryEvidence })).toEqual({
      ...validProfile,
      repositoryEvidence,
    });
  });

  it("rejects free-form repository languages", () => {
    expect(() =>
      Schema.decodeUnknownSync(TaskProfile)({
        ...validProfile,
        repositoryEvidence: {
          version: 1,
          source: "root-markers",
          markers: ["package-json"],
          languages: ["secret-language"],
          frameworks: [],
          testRunners: [],
          workspace: "single-package",
          limited: false,
        },
      }),
    ).toThrow();
  });
});
