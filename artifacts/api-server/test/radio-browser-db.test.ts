import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  radioBrowserStationsTable,
  type Station,
} from "@workspace/db";
import {
  upsertRadioBrowserStations,
  backfillRadioBrowserIcyEnrollment,
  type RadioBrowserStation,
} from "../src/lore/radio-browser.js";

/**
 * Integration test for ICY auto-enrollment against a real DB — the parts the
 * mocked unit tests can't reach:
 *   - first discovery of a station creates BOTH the stations row and its
 *     radio_browser_stations ICY-tracking row, and wires nowPlayingConfig to
 *     point at it;
 *   - a station rediscovered on a later scheduled sync (same stationuuid,
 *     same slug) does NOT create a duplicate radio_browser_stations row and
 *     does NOT clobber the existing nowPlayingConfig pointer;
 *   - `backfillRadioBrowserIcyEnrollment` is a no-op once a station is
 *     already enrolled (nowPlayingSource already set).
 * Fully isolated (unique slug/uuid per run) and cleaned up; self-skips
 * without a real DB.
 */
const run = randomUUID().slice(0, 8);
const STATION_NAME = `Test RB Station ${run}`;
const STATION_UUID = `rb-uuid-${run}`;
const STREAM_URL = `https://stream.example.com/rb-${run}`;

function makeStation(overrides: Partial<RadioBrowserStation> = {}): RadioBrowserStation {
  return {
    stationuuid: STATION_UUID,
    name: STATION_NAME,
    url_resolved: STREAM_URL,
    url: STREAM_URL,
    tags: "ambient",
    country: "US",
    homepage: "https://example.com",
    favicon: "https://example.com/favicon.ico",
    codec: "MP3",
    bitrate: 128,
    votes: 200,
    clickcount: 100,
    lastcheckok: 1,
    ...overrides,
  };
}

let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  const rows = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.name, STATION_NAME));
  for (const row of rows) {
    await db
      .delete(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.stationId, row.id));
  }
  await db.delete(stationsTable).where(eq(stationsTable.name, STATION_NAME));
  await db
    .delete(radioBrowserStationsTable)
    .where(eq(radioBrowserStationsTable.radioBrowserUuid, STATION_UUID));
});

describe("ICY auto-enrollment (DB)", () => {
  it("first discovery enrolls the station for ICY polling", async () => {
    if (!dbAvailable) return;

    const count = await upsertRadioBrowserStations([makeStation()], "ambient");
    expect(count).toBe(1);

    const [station] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.name, STATION_NAME));
    expect(station).toBeDefined();
    expect(station!.nowPlayingSource).toBe("radio_browser_icy");
    expect(station!.nowPlayingConfig).toBeTruthy();
    expect(
      (station!.nowPlayingConfig as Record<string, unknown>)["streamUrl"],
    ).toBe(STREAM_URL);

    const rbRows = await db
      .select()
      .from(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.radioBrowserUuid, STATION_UUID));
    expect(rbRows).toHaveLength(1);
    expect(rbRows[0]!.stationId).toBe(station!.id);

    const configuredRbId = (
      station!.nowPlayingConfig as Record<string, unknown>
    )["radioBrowserId"];
    expect(configuredRbId).toBe(rbRows[0]!.id);
  });

  it("a later rediscovery does not duplicate the ICY row or clobber nowPlayingConfig", async () => {
    if (!dbAvailable) return;

    // Simulate a later scheduled sync rediscovering the same station —
    // possibly with an updated favicon/clickcount, but the same uuid+slug.
    const count = await upsertRadioBrowserStations(
      [makeStation({ favicon: "https://example.com/new-favicon.ico", clickcount: 500 })],
      "ambient",
    );
    expect(count).toBe(1);

    const stationRows = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.name, STATION_NAME));
    expect(stationRows).toHaveLength(1); // no duplicate station row

    const rbRows = await db
      .select()
      .from(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.radioBrowserUuid, STATION_UUID));
    expect(rbRows).toHaveLength(1); // no duplicate ICY-tracking row
    expect(rbRows[0]!.faviconUrl).toBe("https://example.com/new-favicon.ico");

    const station = stationRows[0]!;
    expect(station.nowPlayingSource).toBe("radio_browser_icy");
    expect(
      (station.nowPlayingConfig as Record<string, unknown>)["radioBrowserId"],
    ).toBe(rbRows[0]!.id);
  });

  it("backfillRadioBrowserIcyEnrollment is a no-op on an already-enrolled station", async () => {
    if (!dbAvailable) return;

    const before = await db
      .select()
      .from(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.radioBrowserUuid, STATION_UUID));
    expect(before).toHaveLength(1);

    // The station from the tests above already has nowPlayingSource set, so
    // the backfill query (which only targets NULL nowPlayingSource) should
    // not touch it at all.
    const enrolledCount = await backfillRadioBrowserIcyEnrollment();

    const after = await db
      .select()
      .from(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.radioBrowserUuid, STATION_UUID));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[0]!.updatedAt.getTime()).toBe(before[0]!.updatedAt.getTime());

    // Sanity: our test station specifically was not among any enrolled rows.
    // (Other legacy rows in the DB might exist, so we only assert on the
    // return value being a non-negative count and our row being untouched.)
    expect(enrolledCount).toBeGreaterThanOrEqual(0);
  });
});
