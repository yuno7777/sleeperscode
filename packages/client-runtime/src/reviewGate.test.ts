import { describe, expect, it } from "vitest";

import { deriveReviewGate } from "./reviewGate.ts";

const packet = {
  changed: ["src/app.ts"],
  verification: ["vp test · exit 0"],
  nextActions: [],
  verificationReceipts: [
    { label: "vp test · exit 0", outcome: "passed" as const, occurredAt: "2026-09-01T00:00:00Z" },
  ],
  research: [],
};

describe("deriveReviewGate", () => {
  it("requires an explicit verification receipt before changes are ready", () => {
    expect(
      deriveReviewGate({
        packet: { ...packet, verification: [], verificationReceipts: [] },
        quotaExhausted: false,
        compactionNeedsCheckpoint: false,
        threadError: false,
      }),
    ).toMatchObject({ status: "incomplete", title: "Verification still needed" });
  });

  it("does not hide a failed receipt behind a passing one", () => {
    expect(
      deriveReviewGate({
        packet: {
          ...packet,
          verificationReceipts: [
            ...packet.verificationReceipts,
            {
              label: "vp typecheck · exit 1",
              outcome: "failed",
              occurredAt: "2026-09-01T00:01:00Z",
            },
          ],
        },
        quotaExhausted: false,
        compactionNeedsCheckpoint: false,
        threadError: false,
      }),
    ).toMatchObject({ status: "needs-attention", title: "Review needs attention" });
  });

  it("marks a passing checked change ready for human review", () => {
    expect(
      deriveReviewGate({
        packet,
        quotaExhausted: false,
        compactionNeedsCheckpoint: false,
        threadError: false,
      }),
    ).toMatchObject({ status: "ready", title: "Ready for review" });
  });
});
