import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  recordingsTable,
  spinsTable,
  stationQualityTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration tests for the ✦ first-in-archive (`isFirstSpin`) flag on the
 * now-playing endpoints.
 *
 * Two stations are seeded:
 *   Station A — holds a FRESH MBID whose only spin is today.
 *               Expected: isFirstSpin = true.
 *   Station B — holds a PREVIOUSLY-AIRED MBID that also has a spin
 *               from yesterday. Expected: isFirstSpin = false.
 *
 * All spins are placed a few minutes in the future so they rank above any
 * concurrent live spin for those stations. Fully isolated (unique slugs /
 * MBIDs) and cleaned up. Skips gracefully when no DB is reachable.
 *
 * Endpoints covered:
 *   GET /api/stations/now-playing          (multi-station dial)
 *   GET /api/stations/:slug/now-playing    (single-station)
 */
const run = randomUUID().slice(0, 8);

// MBIDs for the two test recordings.
const FRESH_MBID = `test-fs-fresh-${run}`;
const OLD_MBID = `test-fs-old-${run}`;

// Slugs for the two test stations.
const SLUG_A = `test-fs-a-${run}`;
const SLUG_B = `test-fs-b-${run}`;

const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// The "current" spin lands a couple of minutes in the future so it wins
// `ORDER BY played_at DESC` even while real pollers ingest live data.
const TODAY_SPIN_AT = new Date(Date.now() + 2 * MIN);

// A prior spin for Station B's MBID: placed yesterday so it satisfies
// `played_at::date < CURRENT_DATE` and forces isFirstSpin = false.
const YESTERDAY_SPIN_AT = new Date(Date.now() - DAY);

let dbAvailable = false;
let stationIdA: number | undefined;
let stationIdB: number | undefined;
let server: Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  // Allow up to 30 s: DB seed + app boot can be slow in CI.
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Insert two stations (active=true, hidden=false by default).
  const [sA] = await db
    .insert(stationsTable)
    .values({ slug: SLUG_A, name: `Test FS A ${run}`, streamUrl: "http://example.invalid/fs-a", stationClass: "community" })
    .returning({ id: stationsTable.id });
  stationIdA = sA!.id;

  const [sB] = await db
    .insert(stationsTable)
    .values({ slug: SLUG_B, name: `Test FS B ${run}`, streamUrl: "http://example.invalid/fs-b", stationClass: "community" })
    .returning({ id: stationsTable.id });
  stationIdB = sB!.id;

  // Insert recordings for both MBIDs.
  await db.insert(recordingsTable).values([
    { mbid: FRESH_MBID, title: "Fresh Track", artist: `Test FS Artist ${run}` },
    { mbid: OLD_MBID,   title: "Old Track",   artist: `Test FS Artist ${run}` },
  ]);

  // Station A: one spin only — today (FRESH_MBID has never aired before).
  await db.insert(spinsTable).values({
    stationId: stationIdA,
    mbid: FRESH_MBID,
    confidence: "text" as const,
    rawArtist: "Fresh Artist",
    rawTitle: "Fresh Track",
    playedAt: TODAY_SPIN_AT,
  });

  // Station B: today's spin + a prior spin from yesterday for the same MBID.
  await db.insert(spinsTable).values([
    {
      stationId: stationIdB,
      mbid: OLD_MBID,
      confidence: "text" as const,
      rawArtist: "Old Artist",
      rawTitle: "Old Track",
      playedAt: TODAY_SPIN_AT,
    },
    {
      stationId: stationIdB,
      mbid: OLD_MBID,
      confidence: "text" as const,
      rawArtist: "Old Artist",
      rawTitle: "Old Track",
      playedAt: YESTERDAY_SPIN_AT,
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
}, 90_000);

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  if (stationIdA || stationIdB) {
    const ids = [stationIdA, stationIdB].filter((x): x is number => x != null);
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, ids));
    await db.delete(stationQualityTable).where(inArray(stationQualityTable.stationId, ids));
    await db.delete(stationsTable).where(inArray(stationsTable.id, ids));
  }
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [FRESH_MBID, OLD_MBID]));
}, 90_000);

// Helpers to pick out a specific station's item from the multi-station response.
type NowPlayingItem = { slug: string; nowPlaying: { isFirstSpin: boolean; recording: { mbid: string } | null } | null };
type ListNowPlayingResponse = { items: NowPlayingItem[] };

function findItem(items: NowPlayingItem[], slug: string) {
  return items.find((i) => i.slug === slug);
}

describe("GET /api/stations/now-playing — isFirstSpin", () => {
  // The multi-station endpoint queries all active stations and runs a batch
  // archive check — allow up to 150 s on a loaded shared-Postgres instance
  // with many active stations (was 90 s, which contends under maxWorkers=2).
  it("returns isFirstSpin: true for an MBID with no prior-day spin", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/now-playing`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListNowPlayingResponse;

    const item = findItem(body.items, SLUG_A);
    expect(item, "Station A must appear in the dial").toBeDefined();
    expect(item!.nowPlaying).not.toBeNull();
    expect(item!.nowPlaying!.recording?.mbid).toBe(FRESH_MBID);
    expect(item!.nowPlaying!.isFirstSpin).toBe(true);
  }, 150_000);

  it("returns isFirstSpin: false for an MBID that aired yesterday", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/now-playing`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListNowPlayingResponse;

    const item = findItem(body.items, SLUG_B);
    expect(item, "Station B must appear in the dial").toBeDefined();
    expect(item!.nowPlaying).not.toBeNull();
    expect(item!.nowPlaying!.recording?.mbid).toBe(OLD_MBID);
    expect(item!.nowPlaying!.isFirstSpin).toBe(false);
  }, 150_000);
});

describe("GET /api/stations/:slug/now-playing — isFirstSpin", () => {
  it("returns isFirstSpin: true for a genuinely new MBID on the single-station endpoint", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/${SLUG_A}/now-playing`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nowPlaying: { isFirstSpin: boolean; recording: { mbid: string } | null } | null;
    };
    expect(body.nowPlaying).not.toBeNull();
    expect(body.nowPlaying!.recording?.mbid).toBe(FRESH_MBID);
    expect(body.nowPlaying!.isFirstSpin).toBe(true);
  });

  it("returns isFirstSpin: false for a previously-aired MBID on the single-station endpoint", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/${SLUG_B}/now-playing`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nowPlaying: { isFirstSpin: boolean; recording: { mbid: string } | null } | null;
    };
    expect(body.nowPlaying).not.toBeNull();
    expect(body.nowPlaying!.recording?.mbid).toBe(OLD_MBID);
    expect(body.nowPlaying!.isFirstSpin).toBe(false);
  });
});
