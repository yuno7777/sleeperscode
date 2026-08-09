import { TaskProfile } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { classifyTaskProfile } from "./taskProfile.ts";

const encodeProfileJson = Schema.encodeSync(Schema.fromJsonString(TaskProfile));

describe("classifyTaskProfile", () => {
  it("keeps a trivial visual tweak on one worker", () => {
    const profile = classifyTaskProfile({ text: "Change the button radius to 12px." });

    expect(profile.complexity.band).toBe("low");
    expect(profile.collaboration).toBe("single-worker");
    expect(profile.parallelizable).toBe(false);
    expect(profile.signals).toContain("trivial-change");
  });

  it("recognizes broad cross-domain security work as decomposable", () => {
    const profile = classifyTaskProfile({
      text: [
        "Implement an end-to-end authentication migration across the React UI,",
        "server API, SQLite schema, Rust runtime, and tests. Use parallel specialist workers.",
      ].join(" "),
    });

    expect(profile.complexity.band).toBe("very-high");
    expect(profile.securitySensitivity).toBe("high");
    expect(profile.parallelizable).toBe(true);
    expect(profile.collaboration).toBe("multi-specialist");
    expect(profile.domains.frontend).toBeGreaterThan(0);
    expect(profile.domains.backend).toBeGreaterThan(0);
    expect(profile.domains.systems).toBeGreaterThan(0);
  });

  it("routes research requirements to tools without inventing repository work", () => {
    const profile = classifyTaskProfile({
      text: "Research the latest official documentation, compare the options, and cite sources.",
    });

    expect(profile.kinds).toContain("research");
    expect(profile.toolRequirements).toContain("web-research");
    expect(profile.repoContextRequirement).toBe("low");
    expect(profile.testingRequirement).toBe("none");
  });

  it("requires visual and image tools for an attached UI reference", () => {
    const profile = classifyTaskProfile({
      text: "Implement this React screen and verify it in the browser.",
      attachmentTypes: ["image"],
    });

    expect(profile.visualRequirement).toBe("required");
    expect(profile.toolRequirements).toEqual(
      expect.arrayContaining(["filesystem", "shell", "browser", "image"]),
    );
    expect(profile.signals).toContain("image-attachment");
  });

  it("never copies prompt content into the profile", () => {
    const privateMarker = "PRIVATE_MARKER_4bfb2a1d";
    const profile = classifyTaskProfile({
      text: `Review auth.ts for a credential bug. ${privateMarker}`,
    });

    expect(encodeProfileJson(profile)).not.toContain(privateMarker);
    expect(profile.signals.every((signal) => !signal.includes("auth.ts"))).toBe(true);
  });

  it("is deterministic and bounds work for oversized prompts", () => {
    const text = `Implement the server tests. ${"context ".repeat(20_000)}`;
    const first = classifyTaskProfile({ text });
    const second = classifyTaskProfile({ text });

    expect(first).toEqual(second);
    expect(first.complexity.score).toBeGreaterThanOrEqual(0);
    expect(first.complexity.score).toBeLessThanOrEqual(100);
    expect(first.signals).toContain("long-prompt");
  });
});
