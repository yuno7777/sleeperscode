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
});
