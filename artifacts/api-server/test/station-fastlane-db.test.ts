import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  recordingsTable,
  spinsTable,
  type Station,
} from "@workspace/db";
import app from "../src/app.js";
import {
  _testOnly_setFastLaneRefresh,
  _testOnly_resetFastLaneDebounce,
} from "../src/routes/player.js";

/**
 * Integration tests for the station-landing fast lane
 * (GET /api/player/station/:slug/now):
 *  - warm path: a fresh stored spin returns the read-model shape with
 *    freshness "fresh" and does NOT trigger a refresh;
 *  - stale path: an old observation triggers exactly one targeted refresh,
 *    and an immediate second landing is debounced;
 *  - unknown slug 404s.
 *
 * The one-shot refresh implementation is swapped for a recorder via the
 * _testOnly seam, so no real source poll runs. Unique slugs; cleaned up;
 * skips without a DB.
 */
const run = randomUUID().slice(0, 8);
const MBID = `test-fl-a-${run}`;
const freshSlug = `test-fl-fresh-${run}`;
const staleSlug = `test-fl-stale-${run}`;
const MIN = 60 * 1000;

let dbAvailable = false;
let stationIds: number[] = [];
let server: Server | undefined;
let baseUrl = "";
let restoreRefresh: (() => void) | undefined;
const refreshedStations: Station[] = [];

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  restoreRefresh = _testOnly_setFastLaneRefresh(async (station) => {
    refreshedStations.push(station);
  });
  _testOnly_resetFastLaneDebounce();

  const stations = await db
    .insert(stationsTable)
    .values([
      {
        slug: freshSlug,
        name: `Test FL Fresh ${run}`,
        streamUrl: "http://example.invalid/fl-fresh",
        stationClass: "curated",
        nowPlayingSource: "radio_browser_icy",
      },
      {
        slug: staleSlug,
        name: `Test FL Stale ${run}`,
        streamUrl: "http://example.invalid/fl-stale",
        stationClass: "curated",
        nowPlayingSource: "radio_browser_icy",
      },
    ])
    .returning({ id: stationsTable.id });
  stationIds = stations.map((s) => s.id);

  await db.insert(recordingsTable).values([
    { mbid: MBID, title: "Fast Song", artist: `Fast Artist ${run}` },
  ]);

  const now = Date.now();
  await db.insert(spinsTable).values([
    // Fresh: observed seconds ago — well inside the 2× 30s ICY budget.
    {
      stationId: stationIds[0]!,
      mbid: MBID,
      confidence: "text",
      source: "radio_browser_icy",
      rawArtist: "raw-fl-a",
      rawTitle: "raw-fl-a-t",
      playedAt: new Date(now - 5_000),
      observedAt: new Date(now - 5_000),
    },
    // Stale: observed 10 minutes ago — far past the ICY freshness budget.
    {
      stationId: stationIds[1]!,
      confidence: "text",
      source: "radio_browser_icy",
      rawArtist: `Stale Artist ${run}`,
      rawTitle: "Stale Track",
      playedAt: new Date(now - 10 * MIN),
      observedAt: new Date(now - 10 * MIN),
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  restoreRefresh?.();
  _testOnly_resetFastLaneDebounce();
  if (!dbAvailable || stationIds.length === 0) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID]));
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
});

describe("GET /api/player/station/:slug/now", () => {
  it("returns the fresh stored state without triggering a refresh (warm path)", async () => {
    if (!dbAvailable) return;
    const res = await fetch(`${baseUrl}/api/player/station/${freshSlug}/now`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      station: { slug: string; name: string };
      now: {
        mbid: string | null;
        title: string;
        artist: string;
        playedAt: string;
        observedAt: string;
        freshness: string;
        resolved: boolean;
      } | null;
      refreshTriggered: boolean;
    };
    expect(body.station.slug).toBe(freshSlug);
    expect(body.now).not.toBeNull();
    expect(body.now!.mbid).toBe(MBID);
    expect(body.now!.title).toBe("Fast Song");
    expect(body.now!.artist).toBe(`Fast Artist ${run}`);
    expect(body.now!.resolved).toBe(true);
    expect(body.now!.freshness).toBe("fresh");
    expect(typeof body.now!.observedAt).toBe("string");
    expect(body.refreshTriggered).toBe(false);
    expect(refreshedStations.some((s) => s.slug === freshSlug)).toBe(false);
  });

  it("triggers a one-shot refresh for a stale observation, then debounces", async () => {
    if (!dbAvailable) return;
    const res = await fetch(`${baseUrl}/api/player/station/${staleSlug}/now`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      now: { freshness: string; resolved: boolean } | null;
      refreshTriggered: boolean;
    };
    expect(body.now).not.toBeNull();
    expect(body.now!.freshness).toBe("stale");
    expect(body.refreshTriggered).toBe(true);
    const refreshes = () => refreshedStations.filter((s) => s.slug === staleSlug).length;
    expect(refreshes()).toBe(1);

    // Immediate second landing: still stale, but inside the debounce window —
    // no second refresh.
    const res2 = await fetch(`${baseUrl}/api/player/station/${staleSlug}/now`);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { refreshTriggered: boolean };
    expect(body2.refreshTriggered).toBe(false);
    expect(refreshes()).toBe(1);

    // After the debounce resets, the next stale landing triggers again.
    _testOnly_resetFastLaneDebounce();
    const res3 = await fetch(`${baseUrl}/api/player/station/${staleSlug}/now`);
    const body3 = (await res3.json()) as { refreshTriggered: boolean };
    expect(body3.refreshTriggered).toBe(true);
    expect(refreshes()).toBe(2);
  });

  it("404s for an unknown station", async () => {
    if (!dbAvailable) return;
    const res = await fetch(`${baseUrl}/api/player/station/test-fl-missing-${run}/now`);
    expect(res.status).toBe(404);
  });
});
