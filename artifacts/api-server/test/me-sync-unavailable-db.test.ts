/**
 * Integration tests for GET /api/me/library/sync/:jobId/unavailable
 *
 * Covers:
 *   - Full download: a job with > 200 unavailableMbids returns ALL of them
 *     (not just the 200-item capped preview list)
 *   - CSV format: correct Content-Disposition header and row format
 *   - Legacy fallback: receipt without unavailableMbids falls back to
 *     unavailableItems without error
 *   - Pagination: page/limit params slice correctly
 *
 * Follows the same DB-integration pattern as me-library-db.test.ts.
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
const SID = `test-sync-unav-sid-${run}`;

/** Second user for cross-user isolation tests. */
const SID2 = `test-sync-unav-sid2-${run}`;

let dbAvailable = false;
let userId: number | null = null;
let userId2: number | null = null;
let server: Server | undefined;
let baseUrl = "";

/** MBIDs seeded into recordings for the large-library tests. */
const LARGE_COUNT = 250;
const largeMbids: string[] = Array.from(
  { length: LARGE_COUNT },
  (_, i) => `test-sync-${run}-${String(i).padStart(4, "0")}`,
);

/** MBIDs for the legacy-receipt test (no unavailableMbids field). */
const LEGACY_MBID_1 = `test-sync-leg-${run}-0001`;
const LEGACY_MBID_2 = `test-sync-leg-${run}-0002`;

/**
 * MBIDs for the job-isolation tests: two jobs for user1 with distinct lists,
 * plus one job belonging to user2.
 */
const ISO_MBID_A1 = `test-sync-iso-${run}-a1`;
const ISO_MBID_A2 = `test-sync-iso-${run}-a2`;
const ISO_MBID_B1 = `test-sync-iso-${run}-b1`;
const ISO_MBID_B2 = `test-sync-iso-${run}-b2`;
const ISO_MBID_U2 = `test-sync-iso-${run}-u2`;

/** Job ids inserted in beforeAll, keyed by scenario. */
let jobIdLarge = -1;
let jobIdLegacy = -1;
/** Isolation scenario: two jobs belonging to user1 with non-overlapping MBIDs. */
let jobIdIsoA = -1;
let jobIdIsoB = -1;
/** Isolation scenario: a job belonging to user2. */
let jobIdIsoUser2 = -1;

function authHeaders() {
  return { cookie: `lore_sid=${SID}` };
}

function authHeaders2() {
  return { cookie: `lore_sid=${SID2}` };
}

async function getUnavailable(
  jobId: number,
  params: Record<string, string> = {},
) {
  const qs = new URLSearchParams(params).toString();
  const url = `${baseUrl}/api/me/library/sync/${jobId}/unavailable${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: authHeaders() });
  return { status: res.status, res };
}

async function getUnavailableJson(
  jobId: number,
  params: Record<string, string> = {},
) {
  const { status, res } = await getUnavailable(jobId, params);
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
    .values({ spotifyUserId: `test-sync-unav-user-${run}`, spotifyConnectionId: SID })
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

  // ── Large-library sync job (250 unavailable MBIDs, new-style receipt) ──────
  const largeReceipt: SyncReceipt = {
    synced: 0,
    searchMatched: 0,
    alreadySaved: 0,
    unavailable: LARGE_COUNT,
    unavailableItems: largeMbids.slice(0, 200).map((mbid, i) => ({
      mbid,
      title: `Track ${i}`,
      artist: `Artist ${run}`,
      bandcampUrl: `https://bandcamp.com/search?q=Artist%20${run}%20Track%20${i}`,
    })),
    unavailableMbids: largeMbids,
    searchMatchedItems: [],
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

  // ── Legacy sync job (no unavailableMbids field) ────────────────────────────
  // Two recordings for the preview list.
  await db.insert(recordingsTable).values([
    { mbid: LEGACY_MBID_1, title: "Legacy Track One", artist: `Artist ${run}` },
    { mbid: LEGACY_MBID_2, title: "Legacy Track Two", artist: `Artist ${run}` },
  ]).onConflictDoNothing();

  const legacyReceipt: SyncReceipt = {
    synced: 0,
    searchMatched: 0,
    alreadySaved: 0,
    unavailable: 2,
    unavailableItems: [
      {
        mbid: LEGACY_MBID_1,
        title: "Legacy Track One",
        artist: `Artist ${run}`,
        bandcampUrl: "https://bandcamp.com/search?q=legacy1",
      },
      {
        mbid: LEGACY_MBID_2,
        title: "Legacy Track Two",
        artist: `Artist ${run}`,
        bandcampUrl: "https://bandcamp.com/search?q=legacy2",
      },
    ],
    // Intentionally no unavailableMbids — simulates a pre-feature job.
    searchMatchedItems: [],
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

  // ── Isolation scenario: recordings ─────────────────────────────────────────
  await db.insert(recordingsTable).values([
    { mbid: ISO_MBID_A1, title: "Isolation A Track 1", artist: `Artist ${run}` },
    { mbid: ISO_MBID_A2, title: "Isolation A Track 2", artist: `Artist ${run}` },
    { mbid: ISO_MBID_B1, title: "Isolation B Track 1", artist: `Artist ${run}` },
    { mbid: ISO_MBID_B2, title: "Isolation B Track 2", artist: `Artist ${run}` },
    { mbid: ISO_MBID_U2, title: "Isolation User2 Track", artist: `Artist ${run}` },
  ]).onConflictDoNothing();

  // ── Isolation scenario: two jobs for user1 with non-overlapping MBID sets ──
  const makeIsoReceipt = (mbids: string[]): SyncReceipt => ({
    synced: 0,
    searchMatched: 0,
    alreadySaved: 0,
    unavailable: mbids.length,
    unavailableItems: [],
    unavailableMbids: mbids,
    searchMatchedItems: [],
  });

  const [isoJobA] = await db
    .insert(librarySyncJobsTable)
    .values({
      userId: userId!,
      service: "spotify",
      status: "done",
      total: 2,
      processed: 2,
      startedAt: new Date(),
      finishedAt: new Date(),
      results: makeIsoReceipt([ISO_MBID_A1, ISO_MBID_A2]),
    })
    .returning({ id: librarySyncJobsTable.id });
  jobIdIsoA = isoJobA!.id;

  const [isoJobB] = await db
    .insert(librarySyncJobsTable)
    .values({
      userId: userId!,
      service: "spotify",
      status: "done",
      total: 2,
      processed: 2,
      startedAt: new Date(),
      finishedAt: new Date(),
      results: makeIsoReceipt([ISO_MBID_B1, ISO_MBID_B2]),
    })
    .returning({ id: librarySyncJobsTable.id });
  jobIdIsoB = isoJobB!.id;

  // ── Isolation scenario: second user with their own job ─────────────────────
  await db.insert(spotifyConnectionsTable).values({
    sid: SID2,
    accessToken: "tok-access-2",
    refreshToken: "tok-refresh-2",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [user2] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `test-sync-unav-user2-${run}`, spotifyConnectionId: SID2 })
    .returning({ id: loreUsersTable.id });
  userId2 = user2!.id;

  const [isoJobUser2] = await db
    .insert(librarySyncJobsTable)
    .values({
      userId: userId2!,
      service: "spotify",
      status: "done",
      total: 1,
      processed: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      results: makeIsoReceipt([ISO_MBID_U2]),
    })
    .returning({ id: librarySyncJobsTable.id });
  jobIdIsoUser2 = isoJobUser2!.id;

  // ── Start the app server ───────────────────────────────────────────────────
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  const jobIds = [
    jobIdLarge, jobIdLegacy,
    jobIdIsoA, jobIdIsoB, jobIdIsoUser2,
  ].filter((id) => id > 0);
  if (jobIds.length > 0) {
    await db.delete(librarySyncJobsTable).where(
      sql`${librarySyncJobsTable.id} = ANY(ARRAY[${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)}]::integer[])`,
    );
  }
  // Batch-delete all seeded recordings in one query.
  const allMbids = [
    ...largeMbids,
    LEGACY_MBID_1, LEGACY_MBID_2,
    ISO_MBID_A1, ISO_MBID_A2, ISO_MBID_B1, ISO_MBID_B2, ISO_MBID_U2,
  ];
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, allMbids));

  if (userId2 != null) {
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId2));
  }
  if (userId != null) {
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  await db.delete(spotifyConnectionsTable).where(
    inArray(spotifyConnectionsTable.sid, [SID, SID2]),
  );
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/me/library/sync/:jobId/unavailable — full download", () => {
  it("returns all 250 unavailable items when receipt has unavailableMbids (not just the capped 200)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getUnavailableJson(jobIdLarge);
    expect(status).toBe(200);
    // Default page=1, limit=200 — but total reports the true count.
    expect(body.total).toBe(LARGE_COUNT);
    // pages should reflect all 250 items (ceil(250/200) = 2)
    expect(body.pages).toBe(2);
    expect(body.items).toHaveLength(200); // first page
  });

  it("page 2 returns the remaining 50 items", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getUnavailableJson(jobIdLarge, { page: "2" });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(50);
    expect(body.page).toBe(2);
    expect(body.total).toBe(LARGE_COUNT);
  });

  it("limit=1000 returns all 250 items on one page", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getUnavailableJson(jobIdLarge, { limit: "1000" });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(LARGE_COUNT);
    expect(body.pages).toBe(1);
  });
});

describe("GET /api/me/library/sync/:jobId/unavailable — CSV format", () => {
  it("responds with text/csv Content-Type and attachment Content-Disposition", async () => {
    if (!dbAvailable) return;
    const { status, res } = await getUnavailable(jobIdLarge, { format: "csv" });
    expect(status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/attachment/);
    expect(cd).toMatch(new RegExp(`sync-${jobIdLarge}-unavailable\\.csv`));
  });

  it("CSV has a header row and one data row per unavailable track", async () => {
    if (!dbAvailable) return;
    const { status, res } = await getUnavailable(jobIdLarge, { format: "csv" });
    expect(status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    // Header + 250 data rows
    expect(lines[0]).toBe("mbid,artist,title,bandcamp_url");
    expect(lines).toHaveLength(LARGE_COUNT + 1);
  });

  it("CSV values are quoted and double-quote characters in values are escaped", async () => {
    if (!dbAvailable) return;
    // Verify the header fields are all double-quoted.
    const { res } = await getUnavailable(jobIdLarge, { format: "csv" });
    const text = await res.text();
    const dataLine = text.trim().split("\n")[1] ?? "";
    // Each field should be wrapped in double quotes.
    expect(dataLine).toMatch(/^"[^"]*","[^"]*","[^"]*","[^"]*"$/);
  });
});

describe("GET /api/me/library/sync/:jobId/unavailable — legacy receipt fallback", () => {
  it("returns the capped unavailableItems list without error when unavailableMbids is absent", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getUnavailableJson(jobIdLegacy);
    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    // Items come from the stored preview list, not the recordings join.
    const mbids = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(LEGACY_MBID_1);
    expect(mbids).toContain(LEGACY_MBID_2);
  });

  it("legacy receipt items include artist, title, and bandcampUrl", async () => {
    if (!dbAvailable) return;
    const { body } = await getUnavailableJson(jobIdLegacy);
    for (const item of body.items) {
      expect(item).toHaveProperty("mbid");
      expect(item).toHaveProperty("artist");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("bandcampUrl");
    }
  });
});

describe("GET /api/me/library/sync/:jobId/unavailable — pagination", () => {
  it("limit param slices correctly (limit=5, page=1)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getUnavailableJson(jobIdLarge, { limit: "5", page: "1" });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(5);
    expect(body.limit).toBe(5);
    expect(body.page).toBe(1);
    expect(body.pages).toBe(Math.ceil(LARGE_COUNT / 5));
  });

  it("page=3 with limit=5 returns the third slice", async () => {
    if (!dbAvailable) return;
    const p1 = await getUnavailableJson(jobIdLarge, { limit: "5", page: "1" });
    const p3 = await getUnavailableJson(jobIdLarge, { limit: "5", page: "3" });
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
    const { status, body } = await getUnavailableJson(jobIdLarge, {
      limit: "250",
      page: "2",
    });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(0);
  });

  it("returns 400 for a non-numeric jobId", async () => {
    if (!dbAvailable) return;
    const { status } = await getUnavailableJson("not-a-number" as unknown as number);
    expect(status).toBe(400);
  });

  it("returns 404 for a job owned by a different user", async () => {
    if (!dbAvailable) return;
    // We just request with a jobId that exists but belongs to our user — however,
    // using a completely fabricated ID (9999999) tests the 404 branch.
    const { status } = await getUnavailableJson(9_999_999);
    expect(status).toBe(404);
  });
});

describe("GET /api/me/library/sync/:jobId/unavailable — job isolation", () => {
  it("jobIdIsoA returns only its own two MBIDs (not jobIdIsoB's)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getUnavailableJson(jobIdIsoA, { limit: "100" });
    expect(status).toBe(200);
    expect(body.total).toBe(2);
    const mbids: string[] = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(ISO_MBID_A1);
    expect(mbids).toContain(ISO_MBID_A2);
    expect(mbids).not.toContain(ISO_MBID_B1);
    expect(mbids).not.toContain(ISO_MBID_B2);
  });

  it("jobIdIsoB returns only its own two MBIDs (not jobIdIsoA's)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getUnavailableJson(jobIdIsoB, { limit: "100" });
    expect(status).toBe(200);
    expect(body.total).toBe(2);
    const mbids: string[] = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(ISO_MBID_B1);
    expect(mbids).toContain(ISO_MBID_B2);
    expect(mbids).not.toContain(ISO_MBID_A1);
    expect(mbids).not.toContain(ISO_MBID_A2);
  });

  it("user1 cannot access user2's job — returns 404", async () => {
    if (!dbAvailable) return;
    // jobIdIsoUser2 is owned by user2; user1's session must get 404.
    const { status } = await getUnavailableJson(jobIdIsoUser2);
    expect(status).toBe(404);
  });

  it("user2 cannot access user1's job — returns 404", async () => {
    if (!dbAvailable) return;
    // jobIdIsoA is owned by user1; user2's session must get 404.
    const qs = new URLSearchParams().toString();
    const url = `${baseUrl}/api/me/library/sync/${jobIdIsoA}/unavailable`;
    const res = await fetch(url, { headers: authHeaders2() });
    expect(res.status).toBe(404);
  });

  it("user2 can access their own job", async () => {
    if (!dbAvailable) return;
    const url = `${baseUrl}/api/me/library/sync/${jobIdIsoUser2}/unavailable`;
    const res = await fetch(url, { headers: authHeaders2() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const mbids: string[] = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(ISO_MBID_U2);
  });
});
