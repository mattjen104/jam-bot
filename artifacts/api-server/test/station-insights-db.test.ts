import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import { db, stationsTable, recordingsTable, spinsTable } from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration test for GET /api/stations/:slug/insights — persisted-first
 * behavior. A station with cached `genreProfile`/`discoveryScore` columns
 * must be served straight from those columns (the insights job's output),
 * while a station the job has never scored (both columns null) falls back
 * to a live aggregation over its resolved spin history.
 *
 * Fully isolated (unique slug/MBIDs per run) and cleaned up. Skips
 * gracefully when no DB is reachable.
 */
const run = randomUUID().slice(0, 8);
const MBID = `test-si-${run}`;

let dbAvailable = false;
const stationIds: number[] = [];
let server: Server | undefined;
let baseUrl = "";

const CACHED_SLUG = `test-si-cached-${run}`;
const LIVE_SLUG = `test-si-live-${run}`;

const CACHED_PROFILE = {
  top: [
    { genre: "shoegaze", count: 42 },
    { genre: "dream pop", count: 17 },
  ],
  unknownCount: 3,
  totalCount: 60,
};

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const inserted = await db
    .insert(stationsTable)
    .values([
      {
        slug: CACHED_SLUG,
        name: `Test SI Cached ${run}`,
        streamUrl: "http://example.invalid/si-cached",
        stationClass: "community",
        genreProfile: CACHED_PROFILE,
        // 82 => "new-music" per labelFromScore thresholds.
        discoveryScore: 82,
      },
      {
        slug: LIVE_SLUG,
        name: `Test SI Live ${run}`,
        streamUrl: "http://example.invalid/si-live",
        stationClass: "community",
      },
    ])
    .returning({ id: stationsTable.id, slug: stationsTable.slug });
  for (const row of inserted) stationIds.push(row.id);

  const liveId = inserted.find((r) => r.slug === LIVE_SLUG)!.id;

  // Give the un-scored station one resolved spin with genre + release-year
  // data so the live fallback has something honest to aggregate.
  await db.insert(recordingsTable).values([
    {
      mbid: MBID,
      title: "SI",
      artist: `Test SI ${run}`,
      genres: ["ambient", "drone"],
      releaseYear: 2024,
    },
  ]);
  await db.insert(spinsTable).values([
    {
      stationId: liveId,
      mbid: MBID,
      confidence: "text" as const,
      rawArtist: `Test SI ${run}`,
      rawTitle: "SI",
      playedAt: new Date(),
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable || stationIds.length === 0) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID]));
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
});

type InsightsResponse = {
  station: { slug: string; name: string; stationClass: string };
  insights: {
    genreBreakdown: {
      top: { genre: string; count: number }[];
      unknownCount: number;
      totalCount: number;
    };
    discoveryScore: {
      medianAgeYears: number | null;
      score: number | null;
      label: string;
      sampleSize: number;
      unknownCount: number;
    };
  };
};

describe("GET /api/stations/:slug/insights", () => {
  it("404s for an unknown station slug", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/does-not-exist-${run}/insights`);
    expect(res.status).toBe(404);
  });

  it("serves the persisted genreProfile + discoveryScore columns when present", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/${CACHED_SLUG}/insights`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as InsightsResponse;

    expect(body.station.slug).toBe(CACHED_SLUG);
    // Exactly the persisted profile — no live recompute could produce these
    // counts, since the station has zero logged spins.
    expect(body.insights.genreBreakdown).toEqual(CACHED_PROFILE);
    expect(body.insights.discoveryScore.score).toBe(82);
    expect(body.insights.discoveryScore.label).toBe("new-music");
    // Not persisted — degraded, never fabricated.
    expect(body.insights.discoveryScore.medianAgeYears).toBeNull();
  });

  it("falls back to live aggregation for a never-scored station", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/${LIVE_SLUG}/insights`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as InsightsResponse;

    expect(body.station.slug).toBe(LIVE_SLUG);
    const genres = body.insights.genreBreakdown.top.map((g) => g.genre).sort();
    expect(genres).toEqual(["ambient", "drone"]);
    expect(body.insights.genreBreakdown.totalCount).toBe(1);
    // 2024 release aired now — brand new, so the live score is computable.
    expect(body.insights.discoveryScore.score).not.toBeNull();
    expect(body.insights.discoveryScore.sampleSize).toBe(1);
  });
});
