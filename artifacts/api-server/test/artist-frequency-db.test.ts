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
 * Covers the public Lore-wide artist pool used by no-library onboarding.
 * The fixture deliberately includes canonical aliases, fallback names, a
 * hidden station, and an inactive station so the endpoint's grouping and
 * visibility rules are exercised together.
 */
const run = randomUUID().slice(0, 8);
const stationSlugs = [`artist-frequency-${run}`, `artist-frequency-hidden-${run}`, `artist-frequency-inactive-${run}`];
const recordingMbids = [
  `artist-frequency-a-${run}`,
  `artist-frequency-a2-${run}`,
  `artist-frequency-b-${run}`,
  `artist-frequency-fallback-${run}`,
  `artist-frequency-hidden-${run}`,
  `artist-frequency-inactive-${run}`,
];

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let stationIds: number[] = [];
// Sized in beforeAll from the live archive: the endpoint returns only the
// global top 60 by play count, so the fixture must outrank whatever the
// shared development database currently holds (a fixed count rots as the
// archive grows — 500 plays fell below the 60th-place boundary of 516).
let alphaPlays = 0;
let betaPlays = 0;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const stations = await db.insert(stationsTable).values([
    { slug: stationSlugs[0]!, name: `Artist Frequency ${run}`, streamUrl: "http://example.invalid/frequency" },
    { slug: stationSlugs[1]!, name: `Hidden Frequency ${run}`, streamUrl: "http://example.invalid/hidden", hidden: true },
    { slug: stationSlugs[2]!, name: `Inactive Frequency ${run}`, streamUrl: "http://example.invalid/inactive", active: false },
  ]).returning({ id: stationsTable.id });
  stationIds = stations.map((station) => station.id);

  await db.insert(recordingsTable).values([
    { mbid: recordingMbids[0]!, title: "Canonical One", artist: `Zeta Alias ${run}`, artistMbid: `artist-mbid-a-${run}` },
    { mbid: recordingMbids[1]!, title: "Canonical Two", artist: `Alpha Alias ${run}`, artistMbid: `artist-mbid-a-${run}` },
    { mbid: recordingMbids[2]!, title: "Canonical B", artist: `Beta ${run}`, artistMbid: `artist-mbid-b-${run}` },
    { mbid: recordingMbids[3]!, title: "Fallback", artist: `Fallback & Name ${run}` },
    { mbid: recordingMbids[4]!, title: "Hidden", artist: `Hidden Artist ${run}`, artistMbid: `artist-mbid-hidden-${run}` },
    { mbid: recordingMbids[5]!, title: "Inactive", artist: `Inactive Artist ${run}`, artistMbid: `artist-mbid-inactive-${run}` },
  ]);

  await db.insert(spinsTable).values([
    { stationId: stationIds[0]!, mbid: recordingMbids[0]!, rawArtist: "alias", rawTitle: "one", confidence: "text" },
    { stationId: stationIds[0]!, mbid: recordingMbids[1]!, rawArtist: "alias", rawTitle: "two", confidence: "text" },
    { stationId: stationIds[0]!, mbid: recordingMbids[2]!, rawArtist: "beta", rawTitle: "one", confidence: "text" },
    { stationId: stationIds[0]!, mbid: recordingMbids[3]!, rawArtist: "fallback", rawTitle: "one", confidence: "text" },
    { stationId: stationIds[1]!, mbid: recordingMbids[4]!, rawArtist: "hidden", rawTitle: "one", confidence: "text" },
    { stationId: stationIds[2]!, mbid: recordingMbids[5]!, rawArtist: "inactive", rawTitle: "one", confidence: "text" },
  ]);
  // Keep the fixture inside the bounded top set even when the shared
  // development database already has a large Lore archive: read the live
  // 60th-place play count (same resolved set the endpoint queries) and
  // outrank it by a wide margin. Bulk-insert via generate_series — one
  // round trip no matter how large the archive has grown.
  const boundaryRows = await db.execute<{ boundary: number | null }>(sql`
    WITH resolved AS (
      SELECT COALESCE(
        'mbid:' || r.artist_mbid,
        'name:' || lower(regexp_replace(r.artist, '[^[:alnum:]]', '', 'g'))
      ) AS k
      FROM spins sp
      INNER JOIN stations s
        ON s.id = sp.station_id
       AND s.active = true
       AND s.hidden = false
      INNER JOIN recordings r ON r.mbid = sp.mbid
      WHERE sp.mbid IS NOT NULL
        AND r.artist IS NOT NULL
        AND length(trim(r.artist)) > 0
    ), counts AS (
      SELECT count(*) AS c FROM resolved GROUP BY k ORDER BY c DESC LIMIT 60
    )
    SELECT min(c)::int AS boundary FROM counts
  `);
  const boundary = boundaryRows.rows[0]?.boundary ?? 0;
  // One spin per recording was already inserted above; top up to targets.
  alphaPlays = boundary + 400;
  betaPlays = boundary + 200;
  const stationId = stationIds[0]!;
  for (const [mbid, target, already] of [
    // The canonical group holds TWO recordings (Zeta + Alpha Alias share
    // artist-mbid-a), so it already has 2 spins from the fixture above.
    [recordingMbids[0]!, alphaPlays, 2],
    [recordingMbids[2]!, betaPlays, 1], // Beta
    [recordingMbids[3]!, betaPlays, 1], // Fallback & Name (deterministic tie)
  ] as const) {
    await db.execute(sql`
      INSERT INTO spins (station_id, mbid, raw_artist, raw_title, confidence)
      SELECT ${stationId}, ${mbid}, 'bulk', 'bulk', 'text'
      FROM generate_series(1, ${target - already})
    `);
  }

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, recordingMbids));
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
});

describe("GET /api/stations/artist-frequency", () => {
  it("groups canonical artists, keeps deterministic ties, and excludes hidden/inactive stations", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const response = await fetch(`${baseUrl}/api/stations/artist-frequency`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      artists: { artist: string; artistMbid: string | null; playCount: number }[];
    };

    const fixtureArtists = body.artists.filter((artist) =>
      artist.artist.endsWith(run),
    );
    expect(fixtureArtists).toEqual([
      {
        artist: `Alpha Alias ${run}`,
        artistMbid: `artist-mbid-a-${run}`,
        playCount: alphaPlays,
      },
      {
        artist: `Beta ${run}`,
        artistMbid: `artist-mbid-b-${run}`,
        playCount: betaPlays,
      },
      {
        artist: `Fallback & Name ${run}`,
        artistMbid: null,
        playCount: betaPlays,
      },
    ]);
    expect(body.artists.some((artist) => artist.artist.includes("Hidden"))).toBe(false);
    expect(body.artists.some((artist) => artist.artist.includes("Inactive"))).toBe(false);
  });
});