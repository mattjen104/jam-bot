import { describe, it, expect, beforeAll } from "vitest";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  radioBrowserStationsTable,
} from "@workspace/db";
import { seedStations, ensureIcyHealthRows } from "../src/lore/seed.js";

/**
 * Integration test: six curated Canadian campus stations that were previously
 * configured as `spinitron_web` with callsign-based URLs that return 404.
 *
 * Verifies that after `seedStations()` (the same call boot makes):
 *  - all six stations exist with source="curated" and nowPlayingSource="radio_browser_icy"
 *  - each has a verified ICY streamUrl in nowPlayingConfig (the adapter reads
 *    this field; a missing/wrong URL silently never polls)
 *  - each has favorite=true so the poller assigns a persistent watcher socket
 *    instead of routing through the mux (which reads empty status.xsl)
 *  - each has an active radio_browser_stations health row linked back to it
 *    with a radioBrowserId that is a number (the adapter's FK into that table)
 *  - re-running the seed is idempotent (no duplicate health rows)
 *
 * Runs against the real DB — same canonical data boot uses. Self-skips without
 * a real DB connection so CI without a DB doesn't fail.
 */

const SLUGS = ["cfuv", "chmr", "cism", "cjsr", "ckcu", "ckut"] as const;

const EXPECTED_STREAM_URLS: Record<string, string> = {
  cfuv: "http://ais-sa1.streamon.fm/7132_64k.aac",
  chmr: "http://192.99.14.49:9005/live128",
  cism: "http://stream03.ustream.ca/cism128.mp3",
  cjsr: "http://ais-sa1.streamon.fm/7093_24k.aac",
  ckcu: "https://stream2.statsradio.com:8124/stream",
  ckut: "https://ckut.out.airtime.pro/ckut_a",
};

let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
  if (dbAvailable) {
    await seedStations();
  }
}, 60_000);

describe("Canadian campus station seed enrollment", () => {
  it("enrolls all six stations as curated with radio_browser_icy source", async () => {
    if (!dbAvailable) return;
    const rows = await db
      .select()
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [...SLUGS]));
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.source).toBe("curated");
      expect(row.nowPlayingSource).toBe("radio_browser_icy");
      // GET /api/stations filters active=true — inactive rows are invisible.
      expect(row.active).toBe(true);
    }
  });

  it("sets favorite=true on each station so the poller starts a persistent ICY watcher", async () => {
    if (!dbAvailable) return;
    const rows = await db
      .select({ slug: stationsTable.slug, favorite: stationsTable.favorite })
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [...SLUGS]));
    for (const row of rows) {
      expect(row.favorite).toBe(true);
    }
  });

  it("stores the correct verified ICY stream URL in nowPlayingConfig", async () => {
    if (!dbAvailable) return;
    const rows = await db
      .select({
        slug: stationsTable.slug,
        streamUrl: stationsTable.streamUrl,
        nowPlayingConfig: stationsTable.nowPlayingConfig,
      })
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [...SLUGS]));
    for (const row of rows) {
      const expected = EXPECTED_STREAM_URLS[row.slug];
      expect(row.streamUrl).toBe(expected);
      const config = row.nowPlayingConfig as Record<string, unknown>;
      // The radio_browser_icy adapter reads config.streamUrl exclusively.
      // A missing value causes silent no-poll — this is the exact failure mode
      // the original spinitron_web config created.
      expect(config?.streamUrl).toBe(expected);
    }
  });

  it("gives each station an active, linked health row with an integer radioBrowserId", async () => {
    if (!dbAvailable) return;
    const rows = await db
      .select()
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [...SLUGS]));
    for (const row of rows) {
      const config = row.nowPlayingConfig as Record<string, unknown>;
      // radioBrowserId must be a number (PK of radio_browser_stations),
      // not a UUID string — the adapter uses it as a FK lookup.
      expect(typeof config?.radioBrowserId).toBe("number");

      const rbId = config.radioBrowserId as number;
      const [rbRow] = await db
        .select()
        .from(radioBrowserStationsTable)
        .where(
          sql`${radioBrowserStationsTable.id} = ${rbId}`,
        )
        .limit(1);
      expect(rbRow).toBeDefined();
      expect(rbRow?.stationId).toBe(row.id);
      expect(rbRow?.streamUrl).toBe(row.streamUrl);
      expect(rbRow?.icyStatus).toBe("active");
    }
  });

  it("is idempotent — re-running ensureIcyHealthRows creates no duplicate health rows", async () => {
    if (!dbAvailable) return;
    const uuids = [
      "9619dcac-0601-11e8-ae97-52543be04c81", // cfuv
      "578192b2-6656-41c7-802a-19f1dfa472e0", // chmr
      "961b9db8-0601-11e8-ae97-52543be04c81", // cism
      "961a1782-0601-11e8-ae97-52543be04c81", // cjsr
      "f8b2cd78-5142-4978-a222-5d0435fe10dd", // ckcu
      "c25963ed-7ef5-4789-b8ca-190cbb110154", // ckut
    ];
    const before = await db
      .select({ id: radioBrowserStationsTable.id })
      .from(radioBrowserStationsTable)
      .where(inArray(radioBrowserStationsTable.radioBrowserUuid, uuids));
    await ensureIcyHealthRows();
    const after = await db
      .select({ id: radioBrowserStationsTable.id })
      .from(radioBrowserStationsTable)
      .where(inArray(radioBrowserStationsTable.radioBrowserUuid, uuids));
    expect(after.map((r) => r.id).sort()).toEqual(
      before.map((r) => r.id).sort(),
    );
    expect(after).toHaveLength(6);
  });

  it("overwrites a stale spinitron_web config: nowPlayingSource is radio_browser_icy after seed", async () => {
    if (!dbAvailable) return;
    // The beforeAll already ran seedStations(), so whatever spinitron_web config
    // the Spinitron roster seeder may have written beforehand has been overridden.
    // Verify the end state directly — avoids a second seedStations() call that
    // would race against other seed-DB test files sharing the same DB.
    const [row] = await db
      .select({
        nowPlayingSource: stationsTable.nowPlayingSource,
        nowPlayingConfig: stationsTable.nowPlayingConfig,
      })
      .from(stationsTable)
      .where(sql`${stationsTable.slug} = ${"ckut"}`)
      .limit(1);

    expect(row?.nowPlayingSource).toBe("radio_browser_icy");
    const config = row?.nowPlayingConfig as Record<string, unknown>;
    expect(config?.streamUrl).toBe("https://ckut.out.airtime.pro/ckut_a");
  });
});
