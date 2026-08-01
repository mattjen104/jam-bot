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
 *  - all six stations exist with source="curated"
 *  - CFUV, CJSR, and CKUT have nowPlayingSource="radio_browser_icy" (confirmed
 *    ICY metadata streams)
 *  - CHMR, CISM, and CKCU have nowPlayingSource=null — no publicly accessible
 *    now-playing API was found; their automation systems never populate ICY
 *    StreamTitle, so radio_browser_icy would never produce spins
 *  - each station has the correct verified streamUrl
 *  - CFUV, CJSR, CKUT have active radio_browser_stations health rows linked
 *    back to them; CHMR/CISM/CKCU are omitted from ICY_HEALTH_SEEDS and have
 *    no health row
 *  - re-running the seed is idempotent (no duplicate health rows for CFUV/CJSR/CKUT)
 *
 * Runs against the real DB — same canonical data boot uses. Self-skips without
 * a real DB connection so CI without a DB doesn't fail.
 */

const SLUGS = ["cfuv", "chmr", "cism", "cjsr", "ckcu", "ckut"] as const;

/** Stations with a working ICY metadata stream and health rows. */
const ICY_SLUGS = ["cfuv", "cjsr", "ckut"] as const;

/**
 * Stations whose automation systems never populate ICY StreamTitle.
 * nowPlayingSource is null until a working source is identified.
 *  - CHMR: Centova Cast at 192.99.14.49 requires auth; no public API found.
 *  - CISM: ustream.ca Icecast (port 8000 required); admin panel auth-gated.
 *  - CKCU: StatsRadio API returns NO_PLAYING_SONG; not using song reporting.
 */
const NO_NP_SLUGS = ["chmr", "cism", "ckcu"] as const;

const EXPECTED_STREAM_URLS: Record<string, string> = {
  cfuv: "http://ais-sa1.streamon.fm/7132_64k.aac",
  // :8000 is required — the Icecast mount rejects the default-port (80) URL.
  chmr: "http://192.99.14.49:9005/live128",
  // :8000 is required — the Icecast mount at ustream.ca rejects the default-port URL.
  cism: "http://stream03.ustream.ca:8000/cism128.mp3",
  cjsr: "http://ais-sa1.streamon.fm/7093_24k.aac",
  ckcu: "https://stream2.statsradio.com:8124/stream",
  ckut: "http://delray.ckut.ca:8000/903fm-128-stereo",
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
  it("enrolls all six stations as curated with correct nowPlayingSource", async () => {
    if (!dbAvailable) return;
    const rows = await db
      .select()
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [...SLUGS]));
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.source).toBe("curated");
      // GET /api/stations filters active=true — inactive rows are invisible.
      expect(row.active).toBe(true);

      if ((ICY_SLUGS as readonly string[]).includes(row.slug)) {
        // These three have confirmed ICY metadata streams.
        expect(row.nowPlayingSource).toBe("radio_browser_icy");
      } else {
        // CHMR, CISM, CKCU — nowPlayingSource=null until a working API is found.
        expect(row.nowPlayingSource).toBeNull();
      }
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

  it("stores the correct verified stream URL on each station row", async () => {
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

      if ((ICY_SLUGS as readonly string[]).includes(row.slug)) {
        // ICY stations: nowPlayingConfig.streamUrl drives the adapter directly.
        const config = row.nowPlayingConfig as Record<string, unknown>;
        expect(config?.streamUrl).toBe(expected);
      }
      // CHMR/CISM/CKCU have nowPlayingConfig={} (empty) — no ICY config needed
      // since nowPlayingSource is null and no adapter is running for them.
    }
  });

  it("gives CFUV, CJSR, and CKUT active, linked health rows with integer radioBrowserIds", async () => {
    if (!dbAvailable) return;
    // Only ICY stations are enrolled in ICY_HEALTH_SEEDS.
    // CHMR, CISM, and CKCU are intentionally omitted because their ICY streams
    // never populate StreamTitle — health rows would produce no spins.
    const rows = await db
      .select()
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [...ICY_SLUGS]));
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

  it("is idempotent — re-running ensureIcyHealthRows creates no duplicate health rows for ICY stations", async () => {
    if (!dbAvailable) return;
    // Only CFUV, CJSR, and CKUT are enrolled in ICY_HEALTH_SEEDS.
    // CHMR/CISM/CKCU are omitted (nowPlayingSource=null, no ICY metadata).
    const uuids = [
      "9619dcac-0601-11e8-ae97-52543be04c81", // cfuv
      "961a1782-0601-11e8-ae97-52543be04c81", // cjsr
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
    expect(after).toHaveLength(3);
  });

  it("overwrites a stale spinitron_web config: nowPlayingSource is radio_browser_icy after seed for CKUT", async () => {
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
    expect(config?.streamUrl).toBe("http://delray.ckut.ca:8000/903fm-128-stereo");
  });
});
