import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import request from "supertest";
import { inArray, sql } from "drizzle-orm";
import { db, recordingsTable, spinsTable, stationsTable } from "@workspace/db";
import app from "../src/app.js";

const run = randomUUID().slice(0, 8);
const artist = `Recommendation Artist ${run}`;
const genre = `Recommendation Genre ${run}`;
const artistMbid = `test-rec-artist-${run}`;
const substringArtistMbid = `test-rec-substring-${run}`;
const genreMbid = `test-rec-genre-${run}`;
const hiddenArtistMbid = `test-rec-hidden-${run}`;
const inactiveArtistMbid = `test-rec-inactive-${run}`;

let available = false;
let server: Server | undefined;
const stationIds: number[] = [];
const recordingMbids = [
  artistMbid,
  substringArtistMbid,
  genreMbid,
  hiddenArtistMbid,
  inactiveArtistMbid,
];

async function createStation(slug: string, hidden = false, active = true): Promise<number> {
  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: `test-recommendation-${run}-${slug}`,
      name: `Test Recommendation ${slug} ${run}`,
      streamUrl: "http://example.invalid/recommendation",
      stationClass: "community",
      hidden,
      active,
    })
    .returning({ id: stationsTable.id });
  stationIds.push(station!.id);
  return station!.id;
}

describe("GET /api/recommendations/stations", () => {
  beforeAll(async () => {
    try {
      await db.execute(sql`select 1`);
      available = true;
    } catch {
      return;
    }

    const visibleArtistStation = await createStation("artist-visible");
    const substringStation = await createStation("artist-substring");
    const hiddenStation = await createStation("artist-hidden", true);
    const inactiveStation = await createStation("artist-inactive", false, false);
    const visibleGenreStation = await createStation("genre-visible");
    const hiddenGenreStation = await createStation("genre-hidden", true);

    await db.insert(recordingsTable).values([
      { mbid: artistMbid, title: "Exact match", artist, genres: ["indie rock"] },
      { mbid: substringArtistMbid, title: "Substring only", artist: `${artist} Ensemble` },
      { mbid: genreMbid, title: "Genre match", artist: `Genre Artist ${run}`, genres: [genre] },
      { mbid: hiddenArtistMbid, title: "Hidden match", artist, genres: ["indie rock"] },
      { mbid: inactiveArtistMbid, title: "Inactive match", artist, genres: ["indie rock"] },
    ]);

    const now = Date.now();
    await db.insert(spinsTable).values([
      // Future-dated test rows sit ahead of concurrent live poller traffic.
      { stationId: visibleArtistStation, mbid: artistMbid, playedAt: new Date(now + 2 * 60_000) },
      { stationId: visibleArtistStation, mbid: artistMbid, playedAt: new Date(now + 31 * 24 * 60 * 60_000) },
      { stationId: substringStation, mbid: substringArtistMbid, playedAt: new Date(now + 60_000) },
      { stationId: hiddenStation, mbid: hiddenArtistMbid, playedAt: new Date(now + 60_000) },
      { stationId: inactiveStation, mbid: inactiveArtistMbid, playedAt: new Date(now + 60_000) },
      { stationId: visibleGenreStation, mbid: genreMbid, playedAt: new Date(now + 60_000) },
      { stationId: hiddenGenreStation, mbid: genreMbid, playedAt: new Date(now + 60_000) },
    ]);

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
  });

  afterAll(async () => {
    server?.close();
    if (!available) return;
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
    await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, recordingMbids));
    await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
  });

  it("returns exact artist matches with 30/90-day sampled evidence and hides ineligible stations", async () => {
    if (!available) return;
    const response = await request(server!)
      .get("/api/recommendations/stations")
      .query({ kind: "artist", q: artist });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("artist");
    expect(response.body.recommendations).toHaveLength(1);
    expect(response.body.recommendations[0]).toMatchObject({
      station: { slug: `test-recommendation-${run}-artist-visible` },
      matchKind: "artist",
      evidence: { spinCount30d: 1, spinCount90d: 2 },
    });
    expect(response.body.recommendations[0].evidence.latestSpinAt).toBeTruthy();
    expect(response.body.sample).toMatchObject({
      windowDays: 90,
      spinCap: 50_000,
    });
    expect(response.body.sample.sampledSpinCount).toBeGreaterThanOrEqual(7);
    expect(response.body.sample.sampledSpinCount).toBeLessThanOrEqual(50_000);
    expect(response.body.sample.capReached).toBe(
      response.body.sample.sampledSpinCount === 50_000,
    );
  });

  it("matches a recording genre exactly and reports the match kind", async () => {
    if (!available) return;
    const response = await request(server!)
      .get("/api/recommendations/stations")
      .query({ kind: "genre", q: genre.toUpperCase() });

    expect(response.status).toBe(200);
    expect(response.body.recommendations).toHaveLength(1);
    expect(response.body.recommendations[0]).toMatchObject({
      station: { slug: `test-recommendation-${run}-genre-visible` },
      matchKind: "genre",
      evidence: { spinCount30d: 1, spinCount90d: 1 },
    });
  });

  it("returns no recommendation without observed evidence and treats taste as data", async () => {
    if (!available) return;
    for (const query of [
      { kind: "artist", q: `Unsupported ${run}` },
      { kind: "artist", q: `${artist}' OR true; DROP TABLE stations; --` },
    ]) {
      const response = await request(server!)
        .get("/api/recommendations/stations")
        .query(query);
      expect(response.status).toBe(200);
      expect(response.body.recommendations).toEqual([]);
    }
  });

  it("rejects oversized taste and result limits, and caps result count", async () => {
    if (!available) return;
    const oversizedTaste = await request(server!)
      .get("/api/recommendations/stations")
      .query({ kind: "artist", q: "x".repeat(101) });
    const oversizedLimit = await request(server!)
      .get("/api/recommendations/stations")
      .query({ kind: "artist", q: artist, limit: 21 });
    expect(oversizedTaste.status).toBe(400);
    expect(oversizedLimit.status).toBe(400);

    const bounded = await request(server!)
      .get("/api/recommendations/stations")
      .query({ kind: "artist", q: artist, limit: 20 });
    expect(bounded.status).toBe(200);
    expect(bounded.body.recommendations.length).toBeLessThanOrEqual(20);
    expect(bounded.body.sample.spinCap).toBe(50_000);
  });
});