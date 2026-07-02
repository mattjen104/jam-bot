import { describe, expect, it } from "vitest";
import { oldestPlayedAt, nextCursor } from "../src/lore/backfill.js";
import type { RawSpin } from "../src/lore/types.js";

function spin(playedAt: Date | null): RawSpin {
  return {
    rawArtist: "Artist",
    rawTitle: "Title",
    playedAt,
    externalId: `x-${playedAt?.getTime() ?? "none"}`,
  } as RawSpin;
}

describe("oldestPlayedAt", () => {
  it("returns null for an empty batch", () => {
    expect(oldestPlayedAt([])).toBeNull();
  });

  it("returns null when no spin carries a timestamp", () => {
    expect(oldestPlayedAt([spin(null), spin(null)])).toBeNull();
  });

  it("picks the oldest timestamp, ignoring null ones", () => {
    const a = new Date("2024-06-02T10:00:00Z");
    const b = new Date("2024-06-01T09:00:00Z");
    const c = new Date("2024-06-03T11:00:00Z");
    expect(oldestPlayedAt([spin(a), spin(null), spin(b), spin(c)])).toEqual(b);
  });
});

describe("nextCursor", () => {
  it("returns null when the batch had no timestamps (walk cannot advance)", () => {
    expect(nextCursor("2024-06-01T00:00:00.000Z", null)).toBeNull();
    expect(nextCursor(null, null)).toBeNull();
  });

  it("moves the cursor to the batch's oldest airdate", () => {
    const oldest = new Date("2024-05-30T12:00:00.000Z");
    expect(nextCursor("2024-06-01T00:00:00.000Z", oldest)).toBe(
      "2024-05-30T12:00:00.000Z",
    );
  });

  it("accepts a first-ever cursor (previous null)", () => {
    const oldest = new Date("2024-05-30T12:00:00.000Z");
    expect(nextCursor(null, oldest)).toBe("2024-05-30T12:00:00.000Z");
  });

  it("nudges one second older when the boundary page did not move", () => {
    // All-duplicate page: oldest equals the previous cursor — without the
    // nudge, the walk would fetch the same page forever.
    const prev = "2024-06-01T00:00:00.000Z";
    expect(nextCursor(prev, new Date(prev))).toBe("2024-05-31T23:59:59.000Z");
  });

  it("nudges when the batch oldest is somehow NEWER than the cursor", () => {
    const prev = "2024-06-01T00:00:00.000Z";
    const newer = new Date("2024-06-02T00:00:00.000Z");
    expect(nextCursor(prev, newer)).toBe("2024-06-01T23:59:59.000Z");
  });
});
