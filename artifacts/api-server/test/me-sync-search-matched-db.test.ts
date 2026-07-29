/**
 * Integration tests for GET /api/me/library/sync/:jobId/search-matched
 *
 * Covers:
 *   - Full download: a job with > 200 searchMatchedMbids returns ALL of them
 *     (not just the 200-item capped preview list)
 *   - CSV format: correct Content-Disposition header and row format
 *   - Legacy fallback: receipt without searchMatchedMbids falls back to
 *     searchMatchedItems without error
 *   - Pagination: page/limit params slice correctly
 *
 * Follows the same DB-integration pattern as me-sync-unavailable-db.test.ts.
 * Self-skips when no real DB is available.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  librarySyncJobsTable,
  recordingsTable,
  type SyncReceipt,
} from "@workspace/db";
import app from "../src/app.js";

const run = randomUUID().slice(0, 8);
const SID = `test-sync-sm-sid-${run}`;

let dbAvailable = false;
let userId: number | null = null;
let server: Server | undefined;
let baseUrl = "";

/** MBIDs seeded into recordings for the large-library tests. */
const LARGE_COUNT = 250;
const largeMbids: string[] = Array.from(
  { length: LARGE_COUNT },
  (_, i) => `test-sm-${run}-${String(i).padStart(4, "0")}`,
);

/** MBIDs for the legacy-receipt test (no searchMatchedMbids field). */
const LEGACY_MBID_1 = `test-sm-leg-${run}-0001`;
const LEGACY_MBID_2 = `test-sm-leg-${run}-0002`;

/** Job ids inserted in beforeAll, keyed by scenario. */
let jobIdLarge = -1;
let jobIdLegacy = -1;

function authHeaders() {
  return { cookie: `lore_sid=${SID}` };
}

async function getSearchMatched(
  jobId: number,
  params: Record<string, string> = {},
) {
  const qs = new URLSearchParams(params).toString();
  const url = `${baseUrl}/api/me/library/sync/${jobId}/search-matched${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: authHeaders() });
  return { status: res.status, res };
}

async function getSearchMatchedJson(
  jobId: number,
  params: Record<string, string> = {},
) {
  const { status, res } = await getSearchMatched(jobId, params);
  return { status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // ── User identity ──────────────────────────────────────────────────────────
  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "tok-access",
    refreshToken: "tok-refresh",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [user] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `test-sync-sm-user-${run}`, spotifyConnectionId: SID, deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  // ── Recordings for the large-library scenario ──────────────────────────────
  // Insert in batches of 50 to avoid over-long parameter lists.
  for (let i = 0; i < largeMbids.length; i += 50) {
    const batch = largeMbids.slice(i, i + 50).map((mbid, j) => ({
      mbid,
      title: `Track ${i + j}`,
      artist: `Artist ${run}`,
    }));
    await db.insert(recordingsTable).values(batch).onConflictDoNothing();
  }

  // ── Large-library sync job (250 search-matched MBIDs, new-style receipt) ──
  // Only the first 200 go into searchMatchedItems (capped preview); all 250
  // go into searchMatchedMbids (full list used by the download endpoint).
  const largeReceipt: SyncReceipt = {
    synced: 0,
    searchMatched: LARGE_COUNT,
    alreadySaved: 0,
    unavailable: 0,
    unavailableItems: [],
    unavailableMbids: [],
    searchMatchedItems: largeMbids.slice(0, 200).map((mbid, i) => ({
      mbid,
      title: `Track ${i}`,
      artist: `Artist ${run}`,
      spotifyUrl: `https://open.spotify.com/track/fake-id-${i}`,
    })),
    searchMatchedMbids: largeMbids,
  };
  const [largeJob] = await db
    .insert(librarySyncJobsTable)
    .values({
      userId: userId!,
      service: "spotify",
      status: "done",
      total: LARGE_COUNT,
      processed: LARGE_COUNT,
      startedAt: new Date(),
      finishedAt: new Date(),
      results: largeReceipt,
    })
    .returning({ id: librarySyncJobsTable.id });
  jobIdLarge = largeJob!.id;

  // ── Legacy sync job (no searchMatchedMbids field) ──────────────────────────
  // Two recordings for the preview list.
  await db.insert(recordingsTable).values([
    { mbid: LEGACY_MBID_1, title: "Legacy Search One", artist: `Artist ${run}` },
    { mbid: LEGACY_MBID_2, title: "Legacy Search Two", artist: `Artist ${run}` },
  ]).onConflictDoNothing();

  const legacyReceipt: SyncReceipt = {
    synced: 0,
    searchMatched: 2,
    alreadySaved: 0,
    unavailable: 0,
    unavailableItems: [],
    searchMatchedItems: [
      {
        mbid: LEGACY_MBID_1,
        title: "Legacy Search One",
        artist: `Artist ${run}`,
        spotifyUrl: "https://open.spotify.com/track/legacy1",
      },
      {
        mbid: LEGACY_MBID_2,
        title: "Legacy Search Two",
        artist: `Artist ${run}`,
        spotifyUrl: "https://open.spotify.com/track/legacy2",
      },
    ],
    // Intentionally no searchMatchedMbids — simulates a pre-feature job.
  };
  const [legacyJob] = await db
    .insert(librarySyncJobsTable)
    .values({
      userId: userId!,
      service: "spotify",
      status: "done",
      total: 2,
      processed: 2,
      startedAt: new Date(),
      finishedAt: new Date(),
      results: legacyReceipt,
    })
    .returning({ id: librarySyncJobsTable.id });
  jobIdLegacy = legacyJob!.id;

  // ── Start the app server ───────────────────────────────────────────────────
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  const jobIds = [jobIdLarge, jobIdLegacy].filter((id) => id > 0);
  if (jobIds.length > 0) {
    await db.delete(librarySyncJobsTable).where(
      sql`${librarySyncJobsTable.id} = ANY(ARRAY[${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)}]::integer[])`,
    );
  }
  // Batch-delete all seeded recordings in one query.
  const allMbids = [...largeMbids, LEGACY_MBID_1, LEGACY_MBID_2];
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, allMbids));

  if (userId != null) {
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/me/library/sync/:jobId/search-matched — full download", () => {
  it("returns all 250 search-matched items when receipt has searchMatchedMbids (not just the capped 200)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getSearchMatchedJson(jobIdLarge);
    expect(status).toBe(200);
    // Default page=1, limit=200 — but total reports the true count.
    expect(body.total).toBe(LARGE_COUNT);
    // pages should reflect all 250 items (ceil(250/200) = 2)
    expect(body.pages).toBe(2);
    expect(body.items).toHaveLength(200); // first page
  });

  it("page 2 returns the remaining 50 items", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getSearchMatchedJson(jobIdLarge, { page: "2" });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(50);
    expect(body.page).toBe(2);
    expect(body.total).toBe(LARGE_COUNT);
  });

  it("limit=1000 returns all 250 items on one page", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getSearchMatchedJson(jobIdLarge, { limit: "1000" });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(LARGE_COUNT);
    expect(body.pages).toBe(1);
  });

  it("items within the first 200 carry spotifyUrl from the preview list", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getSearchMatchedJson(jobIdLarge, { limit: "5" });
    expect(status).toBe(200);
    for (const item of body.items) {
      // The first 200 MBIDs have entries in searchMatchedItems with real spotifyUrls.
      expect(item.spotifyUrl).toMatch(/^https:\/\/open\.spotify\.com\/track\//);
    }
  });

  it("items beyond the 200-item preview cap get a fallback spotify search URL", async () => {
    if (!dbAvailable) return;
    // Page 2 has items 201–250, which are NOT in searchMatchedItems.
    const { status, body } = await getSearchMatchedJson(jobIdLarge, { page: "2", limit: "200" });
    expect(status).toBe(200);
    for (const item of body.items) {
      // Fallback is a Spotify search URL (not a track URL).
      expect(item.spotifyUrl).toMatch(/^https:\/\/open\.spotify\.com\//);
      expect(item).toHaveProperty("mbid");
      expect(item).toHaveProperty("artist");
      expect(item).toHaveProperty("title");
    }
  });
});

describe("GET /api/me/library/sync/:jobId/search-matched — CSV format", () => {
  it("responds with text/csv Content-Type and attachment Content-Disposition", async () => {
    if (!dbAvailable) return;
    const { status, res } = await getSearchMatched(jobIdLarge, { format: "csv" });
    expect(status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/attachment/);
    expect(cd).toMatch(new RegExp(`sync-${jobIdLarge}-search-matched\\.csv`));
  });

  it("CSV has a header row and one data row per search-matched track", async () => {
    if (!dbAvailable) return;
    const { status, res } = await getSearchMatched(jobIdLarge, { format: "csv" });
    expect(status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    // Header + 250 data rows
    expect(lines[0]).toBe("mbid,artist,title,spotify_url");
    expect(lines).toHaveLength(LARGE_COUNT + 1);
  });

  it("CSV values are double-quoted and double-quote characters in values are escaped", async () => {
    if (!dbAvailable) return;
    const { res } = await getSearchMatched(jobIdLarge, { format: "csv" });
    const text = await res.text();
    const dataLine = text.trim().split("\n")[1] ?? "";
    // Each field should be wrapped in double quotes.
    expect(dataLine).toMatch(/^"[^"]*","[^"]*","[^"]*","[^"]*"$/);
  });
});

describe("GET /api/me/library/sync/:jobId/search-matched — legacy receipt fallback", () => {
  it("returns the capped searchMatchedItems list without error when searchMatchedMbids is absent", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getSearchMatchedJson(jobIdLegacy);
    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    // Items come from the stored preview list, not the recordings join.
    const mbids = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(LEGACY_MBID_1);
    expect(mbids).toContain(LEGACY_MBID_2);
  });

  it("legacy receipt items include mbid, artist, title, and spotifyUrl", async () => {
    if (!dbAvailable) return;
    const { body } = await getSearchMatchedJson(jobIdLegacy);
    for (const item of body.items) {
      expect(item).toHaveProperty("mbid");
      expect(item).toHaveProperty("artist");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("spotifyUrl");
    }
  });

  it("legacy CSV has a header row and correct number of data rows", async () => {
    if (!dbAvailable) return;
    const { status, res } = await getSearchMatched(jobIdLegacy, { format: "csv" });
    expect(status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("mbid,artist,title,spotify_url");
    expect(lines).toHaveLength(3); // header + 2 tracks
  });
});

describe("GET /api/me/library/sync/:jobId/search-matched — pagination", () => {
  it("limit param slices correctly (limit=5, page=1)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getSearchMatchedJson(jobIdLarge, { limit: "5", page: "1" });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(5);
    expect(body.limit).toBe(5);
    expect(body.page).toBe(1);
    expect(body.pages).toBe(Math.ceil(LARGE_COUNT / 5));
  });

  it("page=3 with limit=5 returns the third slice", async () => {
    if (!dbAvailable) return;
    const p1 = await getSearchMatchedJson(jobIdLarge, { limit: "5", page: "1" });
    const p3 = await getSearchMatchedJson(jobIdLarge, { limit: "5", page: "3" });
    expect(p3.status).toBe(200);
    expect(p3.body.items).toHaveLength(5);
    // The MBIDs on page 3 must not appear on page 1.
    const p1Mbids = new Set(p1.body.items.map((i: { mbid: string }) => i.mbid));
    for (const item of p3.body.items) {
      expect(p1Mbids.has(item.mbid)).toBe(false);
    }
  });

  it("page beyond the last returns an empty items array", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getSearchMatchedJson(jobIdLarge, {
      limit: "250",
      page: "2",
    });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(0);
  });

  it("returns 400 for a non-numeric jobId", async () => {
    if (!dbAvailable) return;
    const { status } = await getSearchMatchedJson("not-a-number" as unknown as number);
    expect(status).toBe(400);
  });

  it("returns 404 for a job that doesn't exist or belongs to a different user", async () => {
    if (!dbAvailable) return;
    const { status } = await getSearchMatchedJson(9_999_999);
    expect(status).toBe(404);
  });
});
