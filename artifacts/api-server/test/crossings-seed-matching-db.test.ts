// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  tasteSeedsTable,
  recordingsTable,
  stationsTable,
  spinsTable,
} from "@workspace/db";
import app from "../src/app.js";
import {
  _testOnly_clearCrossingsCache,
  _testOnly_setColdComputeDeadline,
  _testOnly_setEmptyCrossingsTtl,
} from "../src/routes/me/crossings.js";

/**
 * Integration tests for GET /api/me/crossings — article-tolerant seed
 * matching and the short-lived empty cache.
 *
 * Matching scenarios (all soft-name path — recordings have no artistMbid):
 *   1. Seed "Clash …"      matches spin credited to "The Clash …".
 *   2. Seed "The Cure …"   matches spin credited to "Cure …" (symmetric).
 *   3. Seed "R.E.M. …"     matches spin credited to "REM …" (punctuation).
 *   4. Seed "The" alone never matches (normalizes to empty → excluded).
 *
 * Empty-cache scenario:
 *   A user with a seed but no matching spin gets a settled empty result; a
 *   matching spin then lands WITHOUT bustCrossingsCache. With the empty TTL
 *   expired, the SWR path serves the stale empty once, schedules a recompute,
 *   and a subsequent poll returns the crossing row — no 30-minute wait.
 */

const run = randomUUID().slice(0, 8);

const restoreColdComputeDeadline = _testOnly_setColdComputeDeadline(120_000);
afterAll(() => restoreColdComputeDeadline());

const SID_ARTICLE = `test-seedm-article-${run}`;
const SID_SYMM    = `test-seedm-symm-${run}`;
const SID_PUNCT   = `test-seedm-punct-${run}`;
const SID_JUNKSEED = `test-seedm-junkseed-${run}`;
const SID_NONLATIN = `test-seedm-nonlatin-${run}`;
const SID_REFRESH = `test-seedm-refresh-${run}`;

const MBID_THE_CLASH = `tsm-spin-clash-${run}`;
const MBID_CURE      = `tsm-spin-cure-${run}`;
const MBID_REM       = `tsm-spin-rem-${run}`;
const MBID_BLANKISH  = `tsm-spin-blankish-${run}`;
const MBID_NONLATIN  = `tsm-spin-nonlatin-${run}`;
const NONLATIN_ARTIST = `宇多田ヒカル${run}`;
const MBID_REFRESH   = `tsm-spin-refresh-${run}`;

const STATION_SLUG = `test-seedm-sta-${run}`;

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let stationId: number | null = null;
const userIds: number[] = [];
let userRefreshId: number | null = null;

async function get(path: string, sid?: string) {
  const headers: Record<string, string> = {};
  if (sid) headers["cookie"] = `lore_sid=${sid}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const sids = [SID_ARTICLE, SID_SYMM, SID_PUNCT, SID_JUNKSEED, SID_NONLATIN, SID_REFRESH];
  for (const sid of sids) {
    await db.insert(spotifyConnectionsTable).values({
      sid,
      accessToken: "t",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }
  for (const sid of sids) {
    const [u] = await db
      .insert(loreUsersTable)
      .values({ spotifyUserId: `seedm-${sid}`, spotifyConnectionId: sid, deviceKey: sid })
      .returning({ id: loreUsersTable.id });
    userIds.push(u!.id);
    if (sid === SID_REFRESH) userRefreshId = u!.id;
  }
  const [uArticle, uSymm, uPunct, uJunk, uNonLatin, uRefresh] = userIds;

  // Seeds — the article/punctuation VARIANTS of what actually airs.
  await db.insert(tasteSeedsTable).values([
    { userId: uArticle!, artistName: `Clash ${run}` },        // spin: "The Clash {run}"
    { userId: uSymm!,    artistName: `The Cure ${run}` },     // spin: "Cure {run}"
    { userId: uPunct!,   artistName: `R.E.M. ${run}` },       // spin: "REM {run}"
    { userId: uJunk!,    artistName: "The" },                 // normalizes to '' → must never match
    { userId: uNonLatin!, artistName: NONLATIN_ARTIST },      // non-Latin script must keep matching
    { userId: uRefresh!, artistName: `Refresh Artist ${run}` }, // spin lands later
  ]);

  // Recordings — soft path only (no artistMbid).
  await db.insert(recordingsTable).values([
    { mbid: MBID_THE_CLASH, title: "t", artist: `The Clash ${run}` },
    { mbid: MBID_CURE,      title: "t", artist: `Cure ${run}` },
    { mbid: MBID_REM,       title: "t", artist: `REM ${run}` },
    // An artist whose name normalizes to empty — the "The" seed must not match it.
    { mbid: MBID_BLANKISH,  title: "t", artist: "--" },
    { mbid: MBID_NONLATIN,  title: "t", artist: NONLATIN_ARTIST },
    { mbid: MBID_REFRESH,   title: "t", artist: `Refresh Artist ${run}` },
  ]);

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG,
      name: `Test Seed Matching Station ${run}`,
      streamUrl: "http://example.invalid/seedm",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  const now = new Date();
  await db.insert(spinsTable).values([
    { stationId: stationId!, mbid: MBID_THE_CLASH, confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: now },
    { stationId: stationId!, mbid: MBID_CURE,      confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 1000) },
    { stationId: stationId!, mbid: MBID_REM,       confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 2000) },
    { stationId: stationId!, mbid: MBID_BLANKISH,  confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 3000) },
    { stationId: stationId!, mbid: MBID_NONLATIN,  confidence: "text", rawTitle: "t", rawArtist: "a", playedAt: new Date(now.getTime() - 4000) },
    // MBID_REFRESH is inserted mid-test, not here.
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;
  const mbids = [MBID_THE_CLASH, MBID_CURE, MBID_REM, MBID_BLANKISH, MBID_NONLATIN, MBID_REFRESH];
  if (stationId != null) await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
  if (userIds.length) await db.delete(tasteSeedsTable).where(inArray(tasteSeedsTable.userId, userIds));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, mbids));
  for (const id of userIds) await _testOnly_clearCrossingsCache(id);
  if (userIds.length) await db.delete(loreUsersTable).where(inArray(loreUsersTable.id, userIds));
  await db.delete(spotifyConnectionsTable).where(
    inArray(spotifyConnectionsTable.sid, [SID_ARTICLE, SID_SYMM, SID_PUNCT, SID_JUNKSEED, SID_NONLATIN, SID_REFRESH]),
  );
  if (stationId != null) await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
});

describe("article-tolerant seed matching", () => {
  it("seed 'Clash' matches a spin credited to 'The Clash'", async () => {
    if (!dbAvailable) return;
    await _testOnly_clearCrossingsCache(userIds[0]!);
    const { status, body } = await get("/api/me/crossings", SID_ARTICLE);
    expect(status).toBe(200);
    const row = body.items.find((r: { stationSlug: string }) => r.stationSlug === STATION_SLUG);
    expect(row).toBeTruthy();
    expect(row.artistCrossings).toBeGreaterThanOrEqual(1);
  });

  it("seed 'The Cure' matches a spin credited to 'Cure' (symmetric)", async () => {
    if (!dbAvailable) return;
    await _testOnly_clearCrossingsCache(userIds[1]!);
    const { status, body } = await get("/api/me/crossings", SID_SYMM);
    expect(status).toBe(200);
    const row = body.items.find((r: { stationSlug: string }) => r.stationSlug === STATION_SLUG);
    expect(row).toBeTruthy();
    expect(row.artistCrossings).toBeGreaterThanOrEqual(1);
  });

  it("seed 'R.E.M.' matches a spin credited to 'REM' (punctuation)", async () => {
    if (!dbAvailable) return;
    await _testOnly_clearCrossingsCache(userIds[2]!);
    const { status, body } = await get("/api/me/crossings", SID_PUNCT);
    expect(status).toBe(200);
    const row = body.items.find((r: { stationSlug: string }) => r.stationSlug === STATION_SLUG);
    expect(row).toBeTruthy();
    expect(row.artistCrossings).toBeGreaterThanOrEqual(1);
  });

  it("a non-Latin seed (CJK) still matches its exact-name spin", async () => {
    if (!dbAvailable) return;
    await _testOnly_clearCrossingsCache(userIds[4]!);
    const { status, body } = await get("/api/me/crossings", SID_NONLATIN);
    expect(status).toBe(200);
    const row = body.items.find((r: { stationSlug: string }) => r.stationSlug === STATION_SLUG);
    expect(row).toBeTruthy();
    expect(row.artistCrossings).toBeGreaterThanOrEqual(1);
  });

  it("a seed that normalizes to empty ('The') never matches blank-ish artists", async () => {
    if (!dbAvailable) return;
    await _testOnly_clearCrossingsCache(userIds[3]!);
    const { status, body } = await get("/api/me/crossings", SID_JUNKSEED);
    expect(status).toBe(200);
    const row = body.items.find((r: { stationSlug: string }) => r.stationSlug === STATION_SLUG);
    expect(row).toBeUndefined();
  });
});

describe("empty crossings cache is short-lived", () => {
  it("a new matching spin surfaces after the empty TTL without bustCrossingsCache", async () => {
    if (!dbAvailable) return;
    await _testOnly_clearCrossingsCache(userRefreshId!);

    // 1. Settled empty result — cached.
    const first = await get("/api/me/crossings", SID_REFRESH);
    expect(first.status).toBe(200);
    expect(first.body.computing).not.toBe(true);
    expect(
      first.body.items.find((r: { stationSlug: string }) => r.stationSlug === STATION_SLUG),
    ).toBeUndefined();

    // 2. A matching spin lands. No cache bust.
    await db.insert(spinsTable).values({
      stationId: stationId!, mbid: MBID_REFRESH, confidence: "text",
      rawTitle: "t", rawArtist: "a", playedAt: new Date(),
    });

    // 3. Expire the empty TTL (simulates the short window elapsing). The SWR
    //    path may serve the stale empty once while recomputing in the
    //    background; poll until the fresh row lands.
    const restoreTtl = _testOnly_setEmptyCrossingsTtl(0);
    try {
      let found = false;
      for (let i = 0; i < 60 && !found; i++) {
        const { body } = await get("/api/me/crossings", SID_REFRESH);
        found = body.items.some(
          (r: { stationSlug: string }) => r.stationSlug === STATION_SLUG,
        );
        if (!found) await new Promise((r) => setTimeout(r, 1000));
      }
      expect(found).toBe(true);
    } finally {
      restoreTtl();
    }
  }, 120_000);
});
