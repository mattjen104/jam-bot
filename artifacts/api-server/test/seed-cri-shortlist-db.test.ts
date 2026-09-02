import { beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  radioBrowserStationsTable,
  stationsTable,
} from "@workspace/db";
import {
  CRI_SHORTLIST_SLUGS,
  SEED_STATIONS,
  ensureIcyHealthRows,
  seedStations,
} from "../src/lore/seed.js";
import { isPollable } from "../src/lore/adapters.js";

const EXPECTED = {
  "kiosk-radio": {
    city: "Brussels",
    country: "BE",
    format: "aac",
    quality: "192kbps AAC",
    uuid: "bae70c5c-9f3f-42fc-a83d-6c13920590e0",
  },
  "lahmacun-radio": {
    city: "Budapest",
    country: "HU",
    format: "mp3",
    quality: "128kbps MP3",
    uuid: "93d9e19c-c8ce-487e-a57b-a3b62fc922f9",
  },
  "oroko-radio": {
    city: "Accra",
    country: "GH",
    format: "mp3",
    quality: "320kbps MP3",
    uuid: "7babd377-ed7c-4a63-9778-47b0fd94983b",
  },
  "lyl-radio": {
    city: "Lyon",
    country: "FR",
    format: "mp3",
    quality: "192kbps MP3",
    uuid: "e11c170a-474f-11e9-aa55-52543be04c81",
  },
} as const;

let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
    await seedStations();
  } catch {
    dbAvailable = false;
  }
}, 60_000);

describe("Community Radio Index curated shortlist", () => {
  it("contains only complete, HTTPS, pollable curated station definitions", () => {
    const seeds = SEED_STATIONS.filter((station) =>
      (CRI_SHORTLIST_SLUGS as readonly string[]).includes(station.slug),
    );

    expect(seeds).toHaveLength(CRI_SHORTLIST_SLUGS.length);
    for (const seed of seeds) {
      const expected = EXPECTED[seed.slug as keyof typeof EXPECTED];
      expect(expected).toBeDefined();
      expect(seed.city).toBe(expected.city);
      expect(seed.country).toBe(expected.country);
      expect(seed.streamUrl.startsWith("https://")).toBe(true);
      expect(seed.streamFormat).toBe(expected.format);
      expect(seed.streamQuality).toBe(expected.quality);
      expect(seed.homepageUrl?.startsWith("https://")).toBe(true);
      expect(seed.source).toBe("curated");
      expect(seed.tier).toBe("longtail");
      expect(seed.tags?.length).toBeGreaterThan(0);
      expect(seed.nowPlayingSource).toBe("radio_browser_icy");
      expect(isPollable(seed.nowPlayingSource)).toBe(true);
      expect(
        (seed.nowPlayingConfig as Record<string, unknown>)?.streamUrl,
      ).toBe(seed.streamUrl);
    }
  });

  it("seeds one public row per reviewed station and preserves ids on rerun", async () => {
    if (!dbAvailable) return;

    const before = await db
      .select()
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [...CRI_SHORTLIST_SLUGS]));
    expect(before).toHaveLength(CRI_SHORTLIST_SLUGS.length);

    await seedStations();

    const after = await db
      .select()
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [...CRI_SHORTLIST_SLUGS]));
    expect(after).toHaveLength(CRI_SHORTLIST_SLUGS.length);
    expect(after.map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );

    for (const row of after) {
      expect(row.source).toBe("curated");
      expect(row.tier).toBe("longtail");
      expect(row.active).toBe(true);
      expect(row.hidden).toBe(false);
      expect(row.nowPlayingSource).toBe("radio_browser_icy");
    }
  });

  it("links each station to one active ICY health row without duplicates", async () => {
    if (!dbAvailable) return;

    const uuids = Object.values(EXPECTED).map((entry) => entry.uuid);
    const before = await db
      .select()
      .from(radioBrowserStationsTable)
      .where(inArray(radioBrowserStationsTable.radioBrowserUuid, uuids));

    await ensureIcyHealthRows();

    const after = await db
      .select()
      .from(radioBrowserStationsTable)
      .where(inArray(radioBrowserStationsTable.radioBrowserUuid, uuids));
    expect(after).toHaveLength(CRI_SHORTLIST_SLUGS.length);
    expect(after.map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );

    const stations = await db
      .select()
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [...CRI_SHORTLIST_SLUGS]));
    for (const station of stations) {
      const config = station.nowPlayingConfig as Record<string, unknown>;
      expect(typeof config.radioBrowserId).toBe("number");
      const health = after.find((row) => row.id === config.radioBrowserId);
      expect(health?.stationId).toBe(station.id);
      expect(health?.streamUrl).toBe(station.streamUrl);
      expect(health?.icyStatus).toBe("active");
    }
  });
});