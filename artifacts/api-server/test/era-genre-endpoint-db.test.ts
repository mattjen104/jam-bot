// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import { db, stationsTable, radioBrowserStationsTable } from "@workspace/db";
import app from "../src/app.js";
import {
  upsertRadioBrowserStations,
  type RadioBrowserStation,
} from "../src/lore/radio-browser.js";
import { applyEraGenreStationsMigration } from "../src/lore/era-genre-stations-migration.js";
import { applyStationBlocklistHideMigration } from "../src/lore/station-blocklist-hide-migration.js";

/**
 * DB-backed coverage for the era/genre browse mode (Task 67):
 *   - GET /api/stations?mode=era-genre returns ONLY active era/genre rows and
 *     leaks neither normal, sleep, nor ordinary-hidden stations.
 *   - the normal (no-mode) and sleep responses are unaffected by era/genre rows.
 *   - unknown mode values still 400.
 *   - the radio-browser ingest path classifies a newly discovered era/genre
 *     match as era_genre_mode=true + hidden=true (never surfaces on the dial).
 *
 * Fully isolated by a per-run slug prefix and cleaned up; self-skips without a
 * real DB.
 */

const run = randomUUID().slice(0, 8);
const PREFIX = `t67-${run}`;

const SLUG_NORMAL = `${PREFIX}-normal`;
const SLUG_ERA = `${PREFIX}-era`; // era pattern: oldies
const SLUG_GENRE = `${PREFIX}-genre`; // genre pattern: jazz
const SLUG_SLEEP = `${PREFIX}-sleep`;
const SLUG_HIDDEN = `${PREFIX}-hidden`;
const SLUG_INGEST = `${PREFIX}-ingest`;
const SLUG_BLOCKED = `${PREFIX}-blocked`; // blocklist ("lofi hip hop") + genre keyword ("hip hop")

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";

function rbStation(overrides: Partial<RadioBrowserStation>): RadioBrowserStation {
  return {
    stationuuid: `${PREFIX}-${randomUUID().slice(0, 8)}`,
    name: "X",
    url_resolved: `https://stream.example.invalid/${randomUUID().slice(0, 8)}`,
    url: "",
    tags: "jazz",
    country: "US",
    homepage: "https://example.invalid",
    favicon: "",
    codec: "MP3",
    bitrate: 128,
    votes: 500,
    clickcount: 100,
    lastcheckok: 1,
    ...overrides,
  };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await db.insert(stationsTable).values([
    {
      slug: SLUG_NORMAL,
      name: `${PREFIX} Normal Station`,
      streamUrl: "http://example.invalid/normal",
      stationClass: "community" as const,
      active: true,
      hidden: false,
      crossingEligible: true,
    },
    {
      slug: SLUG_ERA,
      name: `${PREFIX} All Oldies Channel`,
      streamUrl: "http://example.invalid/era",
      stationClass: "curated" as const,
      active: true,
      hidden: true,
      eraGenreMode: true,
    },
    {
      slug: SLUG_GENRE,
      name: `${PREFIX} Jazz FM`,
      streamUrl: "http://example.invalid/genre",
      stationClass: "curated" as const,
      active: true,
      hidden: true,
      eraGenreMode: true,
      // FIP-style: era/genre rows may be crossing-ineligible but must still
      // appear in the era-genre browse mode.
      crossingEligible: false,
    },
    {
      slug: SLUG_SLEEP,
      name: `${PREFIX} White Noise`,
      streamUrl: "http://example.invalid/sleep",
      stationClass: "curated" as const,
      active: true,
      hidden: true,
      sleepMode: true,
    },
    {
      slug: SLUG_HIDDEN,
      name: `${PREFIX} Ordinary Hidden`,
      streamUrl: "http://example.invalid/hidden",
      stationClass: "community" as const,
      active: true,
      hidden: true,
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
}, 90_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;
  const slugs = [SLUG_NORMAL, SLUG_ERA, SLUG_GENRE, SLUG_SLEEP, SLUG_HIDDEN, SLUG_INGEST, SLUG_BLOCKED];
  const rows = await db
    .select({ id: stationsTable.id })
    .from(stationsTable)
    .where(inArray(stationsTable.slug, slugs));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    // FK: radio_browser_stations references stations — clear enrollment first.
    await db
      .delete(radioBrowserStationsTable)
      .where(inArray(radioBrowserStationsTable.stationId, ids));
  }
  await db.delete(stationsTable).where(inArray(stationsTable.slug, slugs));
});

async function fetchStations(query = ""): Promise<{ status: number; slugs: string[] }> {
  const res = await fetch(`${baseUrl}/api/stations${query}`);
  if (res.status !== 200) return { status: res.status, slugs: [] };
  const body = (await res.json()) as { stations: { slug: string }[] };
  return { status: res.status, slugs: body.stations.map((s) => s.slug) };
}

describe("GET /api/stations?mode=era-genre", () => {
  it("returns only active era/genre rows (no normal, sleep, or hidden leak)", async () => {
    if (!dbAvailable) return;
    const { status, slugs } = await fetchStations("?mode=era-genre");
    expect(status).toBe(200);
    const mine = slugs.filter((s) => s.startsWith(PREFIX));
    expect(mine.sort()).toEqual([SLUG_ERA, SLUG_GENRE].sort());
    expect(mine).not.toContain(SLUG_NORMAL);
    expect(mine).not.toContain(SLUG_SLEEP);
    expect(mine).not.toContain(SLUG_HIDDEN);
  });

  it("normal (no-mode) response excludes era/genre + sleep + hidden rows", async () => {
    if (!dbAvailable) return;
    const { status, slugs } = await fetchStations();
    expect(status).toBe(200);
    const mine = slugs.filter((s) => s.startsWith(PREFIX));
    expect(mine).toEqual([SLUG_NORMAL]);
  });

  it("sleep response excludes era/genre rows", async () => {
    if (!dbAvailable) return;
    const { status, slugs } = await fetchStations("?mode=sleep");
    expect(status).toBe(200);
    const mine = slugs.filter((s) => s.startsWith(PREFIX));
    expect(mine).toEqual([SLUG_SLEEP]);
  });

  it("unknown mode values still 400", async () => {
    if (!dbAvailable) return;
    const res = await fetch(`${baseUrl}/api/stations?mode=bogus`);
    expect(res.status).toBe(400);
  });
});

describe("blocklist precedence across boot-order migrations", () => {
  it("a visible blocklisted station with a genre keyword never enters era/genre mode", async () => {
    if (!dbAvailable) return;
    // Regression: boot runs the era/genre migration BEFORE the blocklist hide
    // migration. A pre-existing, still-visible blocklisted row whose name also
    // matches a genre keyword ("Lofi Hip Hop Radio" via "hip hop") must NOT be
    // era-flagged — otherwise the blocklist migration skips it (already
    // hidden) and it leaks out through GET /api/stations?mode=era-genre.
    await db.insert(stationsTable).values({
      slug: SLUG_BLOCKED,
      name: `${PREFIX} Lofi Hip Hop Radio`,
      streamUrl: "http://example.invalid/blocked",
      stationClass: "community" as const,
      active: true,
      hidden: false,
    });

    // Run both migrations in real boot order.
    await applyEraGenreStationsMigration();
    await applyStationBlocklistHideMigration();

    const rows = await db
      .select({
        hidden: stationsTable.hidden,
        eraGenreMode: stationsTable.eraGenreMode,
      })
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [SLUG_BLOCKED]));
    expect(rows.length).toBe(1);
    // Blocklist wins: permanently hidden, no era flag.
    expect(rows[0]!.hidden).toBe(true);
    expect(rows[0]!.eraGenreMode).toBe(false);

    // And it must not surface through the era/genre browse mode.
    const { status, slugs } = await fetchStations("?mode=era-genre");
    expect(status).toBe(200);
    expect(slugs).not.toContain(SLUG_BLOCKED);
  }, 60_000);

  it("the repair step strips the era flag from a previously misclassified blocklisted row", async () => {
    if (!dbAvailable) return;
    // Simulate the pre-fix state: blocklisted row era-flagged + hidden.
    await db
      .update(stationsTable)
      .set({ eraGenreMode: true, hidden: true })
      .where(inArray(stationsTable.slug, [SLUG_BLOCKED]));

    await applyEraGenreStationsMigration();

    const rows = await db
      .select({
        hidden: stationsTable.hidden,
        eraGenreMode: stationsTable.eraGenreMode,
      })
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [SLUG_BLOCKED]));
    expect(rows.length).toBe(1);
    expect(rows[0]!.eraGenreMode).toBe(false); // repaired
    expect(rows[0]!.hidden).toBe(true); // stays permanently hidden
  }, 60_000);
});

describe("radio-browser ingest classifies era/genre matches", () => {
  it("inserts a newly discovered genre match hidden + era_genre_mode=true", async () => {
    if (!dbAvailable) return;
    await upsertRadioBrowserStations(
      [
        rbStation({
          stationuuid: `${PREFIX}-ingest-uuid`,
          name: `${PREFIX} Radio Caprice Reggae`,
          url_resolved: `https://stream.example.invalid/${SLUG_INGEST}`,
        }),
      ],
      "reggae",
    );
    const rows = await db
      .select({
        slug: stationsTable.slug,
        hidden: stationsTable.hidden,
        eraGenreMode: stationsTable.eraGenreMode,
      })
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [`${PREFIX}-radio-caprice-reggae`]));
    expect(rows.length).toBe(1);
    expect(rows[0]!.hidden).toBe(true);
    expect(rows[0]!.eraGenreMode).toBe(true);
    // Track the actual slug for cleanup.
    await db
      .update(stationsTable)
      .set({ slug: SLUG_INGEST })
      .where(inArray(stationsTable.slug, [`${PREFIX}-radio-caprice-reggae`]));
  });
});
