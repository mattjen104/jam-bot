import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  recordingsTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Covers the two onboarding suggestion endpoints:
 *  - GET /api/stations/popular-artists (7-day window, top by play count)
 *  - GET /api/stations/recent-artists  (rolling 4-hour window, newest first,
 *    immune to calendar-midnight boundaries — spins just outside the window
 *    must not appear, spins just inside must, regardless of UTC date)
 * Fixture includes stale spins, hidden/inactive stations, and canonical
 * alias grouping. Each endpoint is fetched ONCE (module-level caches).
 */
const run = randomUUID().slice(0, 8);
const stationSlugs = [
  `onboard-rows-${run}`,
  `onboard-rows-b-${run}`,
  `onboard-rows-hidden-${run}`,
  `onboard-rows-inactive-${run}`,
];
const recordingMbids = [
  `onboard-recent-${run}`,
  `onboard-recent-alias-${run}`,
  `onboard-stale4h-${run}`,
  `onboard-popular-${run}`,
  `onboard-stale7d-${run}`,
  `onboard-hidden-${run}`,
  `onboard-inactive-${run}`,
];

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let stationIds: number[] = [];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const stations = await db.insert(stationsTable).values([
    { slug: stationSlugs[0]!, name: `Onboard Rows ${run}`, streamUrl: "http://example.invalid/a" },
    { slug: stationSlugs[1]!, name: `Onboard Rows B ${run}`, streamUrl: "http://example.invalid/b" },
    { slug: stationSlugs[2]!, name: `Onboard Hidden ${run}`, streamUrl: "http://example.invalid/h", hidden: true },
    { slug: stationSlugs[3]!, name: `Onboard Inactive ${run}`, streamUrl: "http://example.invalid/i", active: false },
  ]).returning({ id: stationsTable.id });
  stationIds = stations.map((station) => station.id);

  await db.insert(recordingsTable).values([
    { mbid: recordingMbids[0]!, title: "Recent", artist: `Recent Artist ${run}`, artistMbid: `onboard-mbid-recent-${run}` },
    { mbid: recordingMbids[1]!, title: "Recent Alias", artist: `Alias Recent ${run}`, artistMbid: `onboard-mbid-recent-${run}` },
    { mbid: recordingMbids[2]!, title: "Stale 4h", artist: `Stale FourHour ${run}`, artistMbid: `onboard-mbid-stale4h-${run}` },
    { mbid: recordingMbids[3]!, title: "Popular", artist: `Popular Artist ${run}`, artistMbid: `onboard-mbid-popular-${run}` },
    { mbid: recordingMbids[4]!, title: "Stale 7d", artist: `Stale Week ${run}`, artistMbid: `onboard-mbid-stale7d-${run}` },
    { mbid: recordingMbids[5]!, title: "Hidden", artist: `Hidden Recent ${run}`, artistMbid: `onboard-mbid-hidden-${run}` },
    { mbid: recordingMbids[6]!, title: "Inactive", artist: `Inactive Recent ${run}`, artistMbid: `onboard-mbid-inactive-${run}` },
  ]);

  const now = Date.now();
  await db.insert(spinsTable).values([
    // Recent Artist: canonical alias grouping across two stations; latest spin
    // on station B so the endpoint must report B as its context.
    { stationId: stationIds[0]!, mbid: recordingMbids[0]!, rawArtist: "r", rawTitle: "1", confidence: "text", playedAt: new Date(now - 3 * HOUR) },
    { stationId: stationIds[0]!, mbid: recordingMbids[1]!, rawArtist: "r", rawTitle: "2", confidence: "text", playedAt: new Date(now - 2 * HOUR) },
    { stationId: stationIds[1]!, mbid: recordingMbids[0]!, rawArtist: "r", rawTitle: "3", confidence: "text", playedAt: new Date(now - 1 * 60 * 1000) },
    // Aired 5h ago — outside the rolling 4h window, must NOT appear even
    // though it is the same UTC calendar day for most of the day.
    { stationId: stationIds[0]!, mbid: recordingMbids[2]!, rawArtist: "s", rawTitle: "1", confidence: "text", playedAt: new Date(now - 5 * HOUR) },
    // Hidden/inactive stations spinning right now must not appear.
    { stationId: stationIds[2]!, mbid: recordingMbids[5]!, rawArtist: "h", rawTitle: "1", confidence: "text", playedAt: new Date(now - 10 * 60 * 1000) },
    { stationId: stationIds[3]!, mbid: recordingMbids[6]!, rawArtist: "i", rawTitle: "1", confidence: "text", playedAt: new Date(now - 10 * 60 * 1000) },
    // Popular fixture: 8-day-old spins must not count toward the 7-day total.
    { stationId: stationIds[0]!, mbid: recordingMbids[4]!, rawArtist: "w", rawTitle: "1", confidence: "text", playedAt: new Date(now - 8 * DAY) },
  ]);
  // Popular Artist: enough recent plays to enter the bounded top-12 even on a
  // dev database with a large archive (top archived artist ≈ 236 weekly plays).
  await db.insert(spinsTable).values(
    Array.from({ length: 500 }, (_, i) => ({
      stationId: stationIds[0]!,
      mbid: recordingMbids[3]!,
      rawArtist: "p",
      rawTitle: String(i),
      confidence: "text",
      playedAt: new Date(now - 2 * DAY),
    })),
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, recordingMbids));
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
});

describe("GET /api/stations/recent-artists", () => {
  it("returns only artists inside the rolling 4h window with latest-spin station context", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const response = await fetch(`${baseUrl}/api/stations/recent-artists`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      artists: { artist: string; artistMbid: string | null; playCount: number; stationSlug: string; stationName: string }[];
    };

    const fixture = body.artists.filter((a) => a.artist.endsWith(run));
    expect(fixture).toEqual([
      expect.objectContaining({
        // min(artist) across the canonical alias group
        artist: `Alias Recent ${run}`,
        artistMbid: `onboard-mbid-recent-${run}`,
        playCount: 3,
        stationSlug: stationSlugs[1],
        stationName: `Onboard Rows B ${run}`,
      }),
    ]);
    expect(body.artists.some((a) => a.artist === `Stale FourHour ${run}`)).toBe(false);
    expect(body.artists.some((a) => a.artist === `Hidden Recent ${run}`)).toBe(false);
    expect(body.artists.some((a) => a.artist === `Inactive Recent ${run}`)).toBe(false);
    expect(body.artists.length).toBeLessThanOrEqual(24);
  });
});

describe("GET /api/stations/popular-artists", () => {
  it("counts only the trailing 7 days and excludes stale-only artists", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const response = await fetch(`${baseUrl}/api/stations/popular-artists`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      artists: { artist: string; artistMbid: string | null; playCount: number }[];
    };

    const popular = body.artists.find((a) => a.artist === `Popular Artist ${run}`);
    expect(popular).toEqual({
      artist: `Popular Artist ${run}`,
      artistMbid: `onboard-mbid-popular-${run}`,
      playCount: 500,
    });
    // Aired only 8 days ago — outside the window entirely.
    expect(body.artists.some((a) => a.artist === `Stale Week ${run}`)).toBe(false);
    expect(body.artists.length).toBeLessThanOrEqual(12);
  });
});
