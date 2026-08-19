import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import { db, stationsTable, spinsTable, stationQualityTable } from "@workspace/db";
import app from "../src/app.js";
import {
  _testOnly_setNpColdFillWaitMs,
  _testOnly_resetNpCaches,
} from "../src/routes/lore/stations.js";

// Under full-suite DB contention the cold base fill can outlive the short
// production deadline; pin a generous wait so assertions see full payloads.
const restoreNpColdFillWait = _testOnly_setNpColdFillWaitMs(120_000);

/**
 * Integration tests for ?includeModePools=true on GET /api/stations/now-playing.
 *
 * The default station snapshot is active + non-hidden + crossing-eligible, so
 * stations that only exist in the sleep / era-genre mode pools (intentionally
 * hidden from the default list) never appear in the dial pulse — and the Scan
 * lens, which tunes those stations, would have no now-playing rows for them.
 *
 * Seeds one hidden sleep-mode station and one hidden era-genre-mode station,
 * each with a spin, and asserts:
 *   - default request: neither station appears;
 *   - includeModePools=true: both appear, with their now-playing payload;
 *   - a plain hidden station (no mode flag) still never appears.
 *
 * Fully isolated (unique slugs) and cleaned up. Skips gracefully when no DB
 * is reachable.
 */
const run = randomUUID().slice(0, 8);
const SLUG_SLEEP = `test-mp-sleep-${run}`;
const SLUG_ERA = `test-mp-era-${run}`;
const SLUG_HIDDEN = `test-mp-hidden-${run}`;

let dbAvailable = false;
let stationIds: number[] = [];
let server: Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const rows = await db
    .insert(stationsTable)
    .values([
      { slug: SLUG_SLEEP, name: `Test MP Sleep ${run}`, streamUrl: "http://example.invalid/mp-sleep", stationClass: "community", hidden: true, sleepMode: true },
      { slug: SLUG_ERA, name: `Test MP Era ${run}`, streamUrl: "http://example.invalid/mp-era", stationClass: "community", hidden: true, eraGenreMode: true },
      { slug: SLUG_HIDDEN, name: `Test MP Hidden ${run}`, streamUrl: "http://example.invalid/mp-hidden", stationClass: "community", hidden: true },
    ])
    .returning({ id: stationsTable.id });
  stationIds = rows.map((r) => r.id);

  // Played a couple of minutes in the future so each spin wins
  // ORDER BY played_at DESC against any concurrent live ingest.
  const spinAt = new Date(Date.now() + 2 * 60 * 1000);
  await db.insert(spinsTable).values(
    stationIds.map((stationId, i) => ({
      stationId,
      confidence: "text" as const,
      rawArtist: `Test MP Artist ${run} ${i}`,
      rawTitle: "Mode Pool Track",
      playedAt: spinAt,
    })),
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
}, 90_000);

afterAll(async () => {
  restoreNpColdFillWait();
  server?.close();
  if (!dbAvailable) return;
  if (stationIds.length > 0) {
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
    await db.delete(stationQualityTable).where(inArray(stationQualityTable.stationId, stationIds));
    await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
  }
}, 90_000);

type NowPlayingItem = { slug: string; nowPlaying: { rawArtist: string | null } | null };
type ListNowPlayingResponse = { items: NowPlayingItem[] };

async function fetchItems(query = ""): Promise<NowPlayingItem[]> {
  const res = await fetch(`${baseUrl}/api/stations/now-playing${query}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListNowPlayingResponse;
  return body.items;
}

describe("GET /api/stations/now-playing — includeModePools", () => {
  // Allow up to 240 s: the multi-station endpoint runs a heavy base scan on a
  // loaded shared-Postgres instance (same budget as the sibling NP db tests).
  it("excludes hidden mode-pool stations from the default response", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    _testOnly_resetNpCaches();
    const items = await fetchItems();
    const slugs = new Set(items.map((i) => i.slug));
    expect(slugs.has(SLUG_SLEEP)).toBe(false);
    expect(slugs.has(SLUG_ERA)).toBe(false);
    expect(slugs.has(SLUG_HIDDEN)).toBe(false);
  }, 240_000);

  it("unions sleep + era-genre pools when includeModePools=true, still excluding plain-hidden", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    _testOnly_resetNpCaches();
    const items = await fetchItems("?includeModePools=true");
    const bySlug = new Map(items.map((i) => [i.slug, i]));
    expect(bySlug.get(SLUG_SLEEP)?.nowPlaying?.rawArtist).toContain("Test MP Artist");
    expect(bySlug.get(SLUG_ERA)?.nowPlaying?.rawArtist).toContain("Test MP Artist");
    // hidden=true without a mode flag is still excluded — the param widens to
    // the curated mode pools only, not to everything hidden.
    expect(bySlug.has(SLUG_HIDDEN)).toBe(false);
  }, 240_000);
});
