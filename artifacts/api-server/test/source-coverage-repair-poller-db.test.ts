// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  radioBrowserStationsTable,
  type Station,
} from "@workspace/db";

const run = randomUUID().slice(0, 8);
const slug = `repair-boot-${run}`;
const originalStream = `https://repair-${run}.example.com/stream`;
const repairedStream = `https://direct-repair-${run}.example.com/stream`;

const { spinWriter } = vi.hoisted(() => ({
  spinWriter: vi.fn(),
}));

vi.mock("../src/lore/icy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lore/icy.js")>();
  return {
    ...actual,
    fetchIcyMetadata: vi.fn(async () => ({
      ok: true as const,
      streamTitle: `Boot Repair Artist ~Boot Repair Title~~~180~~~`,
      icyMetaint: 16000,
    })),
    resolveStreamUrl: vi.fn(async () => repairedStream),
  };
});

vi.mock("../src/lore/adapters.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lore/adapters.js")>();
  return {
    ...actual,
    getNowPlayingAdapter: vi.fn(() => async () => ({
      rawArtist: "Fresh Repair Artist",
      rawTitle: "Fresh Repair Title",
    })),
  };
});

vi.mock("../src/lore/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lore/resolve.js")>();
  return {
    ...actual,
    logSpinIfChanged: spinWriter,
  };
});

import { applyVerifiedRepair } from "../src/lore/source-probe.js";
import {
  _testOnlyStationTimerCount,
  enrollStationPoller,
  stopLorePoller,
} from "../src/lore/poller.js";

let dbAvailable = false;
let station: Station | undefined;

spinWriter.mockImplementation(
  async (currentStation: Station, nowPlaying: { rawArtist: string; rawTitle: string }) => {
    void currentStation;
    void nowPlaying;
    return true;
  },
);

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  [station] = await db
    .insert(stationsTable)
    .values({
      slug,
      name: `Boot Repair ${run}`,
      streamUrl: originalStream,
      nowPlayingSource: null,
      nowPlayingConfig: {},
    })
    .returning();
});

afterAll(async () => {
  stopLorePoller();
  if (!dbAvailable || !station) return;
  await db
    .delete(radioBrowserStationsTable)
    .where(eq(radioBrowserStationsTable.stationId, station.id));
  await db.delete(stationsTable).where(eq(stationsTable.id, station.id));
});

describe("boot-repaired station metadata", () => {
  it("shows the first fresh sample before list-position delay without duplicate rows or loops", async (ctx) => {
    if (!dbAvailable || !station) return ctx.skip();

    vi.useFakeTimers();
    try {
      const outcome = await applyVerifiedRepair(station, {
        kind: "icy",
        outcome: "usable_pair",
        resolvedUrl: repairedStream,
        sampleArtist: "Boot Repair Artist",
        sampleTitle: "Boot Repair Title",
      });
      expect(outcome).toBe("repaired");

      // A second boot repair/enrollment must replace, not stack, the old
      // kickoff. This is the regression that would create duplicate polls.
      const [repaired] = await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.id, station.id));
      expect(repaired!.nowPlayingSource).toBe("radio_browser_icy");
      expect((repaired!.nowPlayingConfig as Record<string, unknown>).repairedBy).toBe(
        "source-coverage-probe",
      );

      enrollStationPoller(repaired!);
      expect(_testOnlyStationTimerCount(station.id)).toBe(1);

      // Repair enrollment is immediate; it must not wait for its normal
      // position in the boot fleet stagger.
      await vi.advanceTimersByTimeAsync(0);
      expect(spinWriter).toHaveBeenCalledTimes(1);
      expect(spinWriter).toHaveBeenCalledWith(
        expect.objectContaining({ id: station.id }),
        { rawArtist: "Fresh Repair Artist", rawTitle: "Fresh Repair Title" },
      );
      expect(_testOnlyStationTimerCount(station.id)).toBe(2);
    } finally {
      stopLorePoller();
      vi.useRealTimers();
    }
  });
});