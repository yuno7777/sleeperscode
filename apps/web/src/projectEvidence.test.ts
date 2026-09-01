import { describe, expect, it } from "vite-plus/test";

import { continuationPacketHandoff, deriveContinuationPacket } from "./projectEvidence.ts";

const activity = (payload: unknown, createdAt = "2026-09-01T00:00:00.000Z") =>
  ({ id: "activity-1", kind: "provider.activity", payload, createdAt }) as never;

describe("deriveContinuationPacket", () => {
  it("keeps explicit passing command receipts and provider research evidence", () => {
    const packet = deriveContinuationPacket({
      activities: [
        activity({
          itemType: "command_execution",
          data: { item: { command: "vp test", exitCode: 0 } },
        }),
        activity({
          itemType: "web_search",
          data: { item: { query: "Effect docs", url: "https://effect.website" } },
        }),
      ],
      checkpoints: [{ files: [{ path: "apps/web/src/App.tsx" }] }] as never,
      thread: { session: null, latestTurn: { state: "completed" } } as never,
      quotaExhausted: false,
      compactionNeedsCheckpoint: false,
    });

    expect(packet.verification).toEqual(["vp test · exit 0"]);
    expect(packet.research).toEqual([
      {
        query: "Effect docs",
        url: "https://effect.website",
        occurredAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
    expect(continuationPacketHandoff(packet)).toMatchObject({
      changed: ["apps/web/src/App.tsx"],
      remaining: ["Review the changed files and verification before continuing."],
    });
  });

  it("does not call a non-zero command verification", () => {
    const packet = deriveContinuationPacket({
      activities: [
        activity({
          itemType: "command_execution",
          data: { item: { command: "vp test", exitCode: 1 } },
        }),
      ],
      checkpoints: [],
      thread: { session: { status: "error" }, latestTurn: { state: "error" } } as never,
      quotaExhausted: true,
      compactionNeedsCheckpoint: true,
    });

    expect(packet.verification).toEqual([]);
    expect(packet.nextActions).toHaveLength(3);
  });
});
