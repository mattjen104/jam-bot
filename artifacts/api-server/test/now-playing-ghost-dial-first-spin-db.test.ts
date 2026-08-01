// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import { db, stationsTable, recordingsTable, spinsTable } from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration tests for the ✦ first-in-archive (`isFirstSpin`) flag on the
 * two date-filtered ghost-dial endpoints.
 *
 * Endpoints covered:
 *   GET /api/stations/now-playing?date=YYYY-MM-DD   (query-param ghost-dial)
 *   GET /api/stations/at/:date/now-playing           (path-param ghost-dial)
 *
 * --- Query-param variant (?date=YYYY-MM-DD) ---
 * The archive check compares against CURRENT_DATE (not the requested date).
 * Spins are placed on today's date so the check `played_at::date < CURRENT_DATE`
 * does NOT capture them, letting isFirstSpin=true when there is no prior-day spin.
 *
 *   Station QA — FRESH MBID, today-only spin.  Expected: isFirstSpin=true.
 *   Station QB — OLD MBID, today's spin + yesterday's spin. Expected: isFirstSpin=false.
 *
 * --- Path-param variant (/at/:date/now-playing) ---
 * The archive check compares against the *requested* dateFilter (not CURRENT_DATE).
 * Spins are placed on a fixed past date so the date parameter is historical and the
 * comparison works correctly.
 *
 *   Station PA — FRESH MBID, spin only on TARGET_DATE.  Expected: isFirstSpin=true.
 *   Station PB — OLD MBID, spin on TARGET_DATE + even-earlier spin. Expected: isFirstSpin=false.
 *
 * All test data uses unique run-scoped slugs/MBIDs and is fully cleaned up.
 * Skips gracefully when no DB is reachable.
 */

const run = randomUUID().slice(0, 8);

// ─── MBIDs ────────────────────────────────────────────────────────────────────
const Q_FRESH_MBID = `test-gd-qfresh-${run}`;
const Q_OLD_MBID   = `test-gd-qold-${run}`;
const P_FRESH_MBID = `test-gd-pfresh-${run}`;
const P_OLD_MBID   = `test-gd-pold-${run}`;

const ALL_MBIDS = [Q_FRESH_MBID, Q_OLD_MBID, P_FRESH_MBID, P_OLD_MBID];

// ─── Slugs ────────────────────────────────────────────────────────────────────
const SLUG_QA = `test-gd-qa-${run}`;
const SLUG_QB = `test-gd-qb-${run}`;
const SLUG_PA = `test-gd-pa-${run}`;
const SLUG_PB = `test-gd-pb-${run}`;

// ─── Time helpers ─────────────────────────────────────────────────────────────
const DAY = 24 * 60 * 60 * 1000;

// Derive UTC date strings from epoch offsets, then anchor spin timestamps to
// noon UTC of that date string.  This avoids edge-cases where a late UTC clock
// would push a "Date.now() + 2min" spin onto the next UTC calendar day, or
// where adding hours to a late-day epoch would cross the date boundary.
function utcDateString(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
}
function noonUtc(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00.000Z`);
}

// Query-param tests (?date=TODAY_DATE).
// QA has only a today spin → isFirstSpin=true.
// QB has a today spin + a yesterday spin → isFirstSpin=false.
// Spins sit at noon UTC of their respective date strings so the
// `played_at::date = ?date::date` filter matches exactly and the
// `played_at::date < CURRENT_DATE` archive check is correctly applied.
const TODAY_DATE          = utcDateString(0);
const YESTERDAY_DATE      = utcDateString(-DAY);
const Q_TODAY_SPIN_AT     = noonUtc(TODAY_DATE);
const Q_YESTERDAY_SPIN_AT = noonUtc(YESTERDAY_DATE);

// Path-param tests (/at/:date/now-playing).
// PA has only a spin on TARGET_DATE → isFirstSpin=true.
// PB has a spin on TARGET_DATE + a spin on PRIOR_DATE → isFirstSpin=false.
// The route compares against dateFilter, so historical dates work correctly.
const TARGET_DATE    = utcDateString(-30 * DAY);
const PRIOR_DATE     = utcDateString(-31 * DAY);
const P_SPIN_ON_TARGET = noonUtc(TARGET_DATE);
const P_PRIOR_SPIN     = noonUtc(PRIOR_DATE);

// ─── State ────────────────────────────────────────────────────────────────────
let dbAvailable = false;
let stationIds: number[] = [];
let server: Server | undefined;
let baseUrl = "";

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Insert all four stations.
  const inserted = await db
    .insert(stationsTable)
    .values([
      { slug: SLUG_QA, name: `Test GD QA ${run}`, streamUrl: "http://example.invalid/gd-qa", stationClass: "community" },
      { slug: SLUG_QB, name: `Test GD QB ${run}`, streamUrl: "http://example.invalid/gd-qb", stationClass: "community" },
      { slug: SLUG_PA, name: `Test GD PA ${run}`, streamUrl: "http://example.invalid/gd-pa", stationClass: "community" },
      { slug: SLUG_PB, name: `Test GD PB ${run}`, streamUrl: "http://example.invalid/gd-pb", stationClass: "community" },
    ])
    .returning({ id: stationsTable.id, slug: stationsTable.slug });

  stationIds = inserted.map((r) => r.id);

  const bySlug = Object.fromEntries(inserted.map((r) => [r.slug, r.id]));
  const idQA = bySlug[SLUG_QA]!;
  const idQB = bySlug[SLUG_QB]!;
  const idPA = bySlug[SLUG_PA]!;
  const idPB = bySlug[SLUG_PB]!;

  // Insert recordings.
  await db.insert(recordingsTable).values([
    { mbid: Q_FRESH_MBID, title: "GD Q Fresh Track", artist: `Test GD Artist ${run}` },
    { mbid: Q_OLD_MBID,   title: "GD Q Old Track",   artist: `Test GD Artist ${run}` },
    { mbid: P_FRESH_MBID, title: "GD P Fresh Track",  artist: `Test GD Artist ${run}` },
    { mbid: P_OLD_MBID,   title: "GD P Old Track",    artist: `Test GD Artist ${run}` },
  ]);

  // ── Query-param stations ───────────────────────────────────────────────────
  // Station QA: one spin today (near future) — no prior-day spin.
  await db.insert(spinsTable).values({
    stationId: idQA,
    mbid: Q_FRESH_MBID,
    confidence: "text" as const,
    rawArtist: "GD Q Fresh Artist",
    rawTitle: "GD Q Fresh Track",
    playedAt: Q_TODAY_SPIN_AT,
  });

  // Station QB: today's spin + yesterday's spin — same MBID, so isFirstSpin=false.
  await db.insert(spinsTable).values([
    {
      stationId: idQB,
      mbid: Q_OLD_MBID,
      confidence: "text" as const,
      rawArtist: "GD Q Old Artist",
      rawTitle: "GD Q Old Track",
      playedAt: Q_TODAY_SPIN_AT,
    },
    {
      stationId: idQB,
      mbid: Q_OLD_MBID,
      confidence: "text" as const,
      rawArtist: "GD Q Old Artist",
      rawTitle: "GD Q Old Track",
      playedAt: Q_YESTERDAY_SPIN_AT,
    },
  ]);

  // ── Path-param stations ────────────────────────────────────────────────────
  // Station PA: one spin on TARGET_DATE only — isFirstSpin=true.
  await db.insert(spinsTable).values({
    stationId: idPA,
    mbid: P_FRESH_MBID,
    confidence: "text" as const,
    rawArtist: "GD P Fresh Artist",
    rawTitle: "GD P Fresh Track",
    playedAt: P_SPIN_ON_TARGET,
  });

  // Station PB: spin on TARGET_DATE + an earlier spin — isFirstSpin=false.
  await db.insert(spinsTable).values([
    {
      stationId: idPB,
      mbid: P_OLD_MBID,
      confidence: "text" as const,
      rawArtist: "GD P Old Artist",
      rawTitle: "GD P Old Track",
      playedAt: P_SPIN_ON_TARGET,
    },
    {
      stationId: idPB,
      mbid: P_OLD_MBID,
      confidence: "text" as const,
      rawArtist: "GD P Old Artist",
      rawTitle: "GD P Old Track",
      playedAt: P_PRIOR_SPIN,
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
}, 30_000);

// ─── Teardown ─────────────────────────────────────────────────────────────────
afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  if (stationIds.length > 0) {
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
    await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
  }
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, ALL_MBIDS));
}, 30_000);

// ─── Types ────────────────────────────────────────────────────────────────────
type NowPlayingItem = {
  slug: string;
  nowPlaying: { isFirstSpin: boolean; recording: { mbid: string } | null } | null;
};
type ListNowPlayingResponse = { items: NowPlayingItem[] };

function findItem(items: NowPlayingItem[], slug: string) {
  return items.find((i) => i.slug === slug);
}

// ─── Tests: query-param variant ───────────────────────────────────────────────
describe("GET /api/stations/now-playing?date=YYYY-MM-DD — isFirstSpin", () => {
  it("returns isFirstSpin: true for an MBID with no prior-day spin on the requested date", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/now-playing?date=${TODAY_DATE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListNowPlayingResponse;

    const item = findItem(body.items, SLUG_QA);
    expect(item, `Station ${SLUG_QA} must appear in the dial`).toBeDefined();
    expect(item!.nowPlaying).not.toBeNull();
    expect(item!.nowPlaying!.recording?.mbid).toBe(Q_FRESH_MBID);
    expect(item!.nowPlaying!.isFirstSpin).toBe(true);
  }, 30_000);

  it("returns isFirstSpin: false for an MBID that aired on a prior day", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/now-playing?date=${TODAY_DATE}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListNowPlayingResponse;

    const item = findItem(body.items, SLUG_QB);
    expect(item, `Station ${SLUG_QB} must appear in the dial`).toBeDefined();
    expect(item!.nowPlaying).not.toBeNull();
    expect(item!.nowPlaying!.recording?.mbid).toBe(Q_OLD_MBID);
    expect(item!.nowPlaying!.isFirstSpin).toBe(false);
  }, 30_000);
});

// ─── Tests: path-param variant ────────────────────────────────────────────────
describe("GET /api/stations/at/:date/now-playing — isFirstSpin", () => {
  it("returns isFirstSpin: true for an MBID with no spin before the requested archive date", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/at/${TARGET_DATE}/now-playing`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListNowPlayingResponse;

    const item = findItem(body.items, SLUG_PA);
    expect(item, `Station ${SLUG_PA} must appear in the archive view`).toBeDefined();
    expect(item!.nowPlaying).not.toBeNull();
    expect(item!.nowPlaying!.recording?.mbid).toBe(P_FRESH_MBID);
    expect(item!.nowPlaying!.isFirstSpin).toBe(true);
  }, 30_000);

  it("returns isFirstSpin: false for an MBID that aired on an even earlier date", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/at/${TARGET_DATE}/now-playing`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListNowPlayingResponse;

    const item = findItem(body.items, SLUG_PB);
    expect(item, `Station ${SLUG_PB} must appear in the archive view`).toBeDefined();
    expect(item!.nowPlaying).not.toBeNull();
    expect(item!.nowPlaying!.recording?.mbid).toBe(P_OLD_MBID);
    expect(item!.nowPlaying!.isFirstSpin).toBe(false);
  }, 30_000);
});
