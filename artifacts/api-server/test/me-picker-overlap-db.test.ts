// @vitest-environment node
/**
 * Integration tests for GET /api/me/pickers/overlap (Task 3).
 *
 * Covers:
 *   1. Full-library coverage — overlap counted over all MBIDs, not first 60.
 *   2. Distinct counts for two pickers that share a display name.
 *   3. Release-group widening — an album-mate of a library track counts.
 *   4. Cross-user isolation — user B's empty library never leaks user A's results.
 *   5. Schedule endpoint threads pickerId through show runs correctly.
 *
 * All seeds use a run-isolated prefix; cleanup runs in afterAll in FK order.
 * Tests skip silently when no DB is reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  pickersTable,
  picksTable,
  stationsTable,
  showsTable,
  spinsTable,
} from "@workspace/db";
import app from "../src/app.js";
import { _testOnly_clearPickerOverlapCache } from "../src/routes/me/overlaps.js";

const run = randomUUID().slice(0, 8);

// ── Session IDs ───────────────────────────────────────────────────────────────
const SID_A = `test-po-a-${run}`; // user with library items
const SID_B = `test-po-b-${run}`; // empty library (isolation baseline)

// ── Test state ────────────────────────────────────────────────────────────────
let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let userAId: number | null = null;
let userBId: number | null = null;

// IDs populated during setup (needed for cleanup).
const allRecordingMbids: string[] = [];
const allPickerIds: number[] = [];
const allPickIds: number[] = [];
let scheduleStationId: number | null = null;
let scheduleShowId: number | null = null;
let schedulePickerId: number | null = null;

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function get(path: string, sid?: string) {
  const headers: Record<string, string> = {};
  if (sid) headers["cookie"] = `lore_sid=${sid}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  try {
    await db.execute({ sql: "select 1", params: [], typings: [] } as never);
    dbAvailable = true;
  } catch {
    return;
  }

  // ── Spotify connections + lore users ──────────────────────────────────────
  for (const sid of [SID_A, SID_B]) {
    await db.insert(spotifyConnectionsTable).values({
      sid,
      accessToken: "t",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }
  const [uA] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `po-a-${run}`, spotifyConnectionId: SID_A, deviceKey: SID_A })
    .returning({ id: loreUsersTable.id });
  userAId = uA!.id;

  const [uB] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `po-b-${run}`, spotifyConnectionId: SID_B, deviceKey: SID_B })
    .returning({ id: loreUsersTable.id });
  userBId = uB!.id;

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 1: full-library (62 MBIDs, all picked by the same DJ)
  // ──────────────────────────────────────────────────────────────────────────
  const FULL_COUNT = 62;
  const [fullPicker] = await db
    .insert(pickersTable)
    .values({ name: `Full DJ ${run}`, handle: `full-dj-${run}`, pickerType: "dj" })
    .returning({ id: pickersTable.id });
  const fullPickerId = fullPicker!.id;
  allPickerIds.push(fullPickerId);

  const fullMbids = Array.from({ length: FULL_COUNT }, (_, i) => `po-full-${run}-${i}`);
  allRecordingMbids.push(...fullMbids);

  await db.insert(recordingsTable).values(
    fullMbids.map((mbid, i) => ({
      mbid,
      title: `Full Track ${i}`,
      artist: `Full Artist ${run}`,
    })),
  );

  const fullPickRows = await db
    .insert(picksTable)
    .values(
      fullMbids.map((mbid) => ({
        pickerId: fullPickerId,
        mbid,
        source: "spin",
        confidence: "recording_id" as const,
      })),
    )
    .returning({ id: picksTable.id });
  allPickIds.push(...fullPickRows.map((r) => r.id));

  // All 62 in user A's library
  await db.insert(libraryItemsTable).values(
    fullMbids.map((mbid) => ({
      userId: userAId!,
      mbid,
      provenance: { kind: "keep" },
      addedAt: new Date(),
    })),
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 2: two pickers with identical display names
  // ──────────────────────────────────────────────────────────────────────────
  const DUPE_NAME = `Dupe DJ ${run}`;
  const MBID_DUPE_1 = `po-dupe1-${run}`;
  const MBID_DUPE_2 = `po-dupe2-${run}`;
  allRecordingMbids.push(MBID_DUPE_1, MBID_DUPE_2);

  await db.insert(recordingsTable).values([
    { mbid: MBID_DUPE_1, title: "Dupe Track 1", artist: "Dupe Artist" },
    { mbid: MBID_DUPE_2, title: "Dupe Track 2", artist: "Dupe Artist" },
  ]);

  const dupePickers = await db
    .insert(pickersTable)
    .values([
      { name: DUPE_NAME, handle: `dupe-dj-1-${run}`, pickerType: "dj" },
      { name: DUPE_NAME, handle: `dupe-dj-2-${run}`, pickerType: "dj" },
    ])
    .returning({ id: pickersTable.id });
  const [dupePickerId1, dupePickerId2] = dupePickers.map((r) => r.id);
  allPickerIds.push(dupePickerId1!, dupePickerId2!);

  const dupePickRows = await db
    .insert(picksTable)
    .values([
      { pickerId: dupePickerId1!, mbid: MBID_DUPE_1, source: "spin", confidence: "recording_id" as const },
      // Dupe picker 2 has BOTH tracks so its count is 2 vs dupe picker 1's count of 1.
      { pickerId: dupePickerId2!, mbid: MBID_DUPE_1, source: "spin", confidence: "recording_id" as const },
      { pickerId: dupePickerId2!, mbid: MBID_DUPE_2, source: "spin", confidence: "recording_id" as const },
    ])
    .returning({ id: picksTable.id });
  allPickIds.push(...dupePickRows.map((r) => r.id));

  await db.insert(libraryItemsTable).values([
    { userId: userAId!, mbid: MBID_DUPE_1, provenance: { kind: "keep" }, addedAt: new Date() },
    { userId: userAId!, mbid: MBID_DUPE_2, provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 3: release-group widening
  // ──────────────────────────────────────────────────────────────────────────
  const MBID_RG_LIB  = `po-rg-lib-${run}`;   // in user A's library
  const MBID_RG_PICK = `po-rg-pick-${run}`;  // picked by DJ, shares RG with above
  const RG_MBID      = `po-rg-${run}`;
  allRecordingMbids.push(MBID_RG_LIB, MBID_RG_PICK);

  await db.insert(recordingsTable).values([
    { mbid: MBID_RG_LIB,  title: "RG Lib Track",  artist: `RG Artist ${run}` },
    { mbid: MBID_RG_PICK, title: "RG Pick Track", artist: `RG Artist ${run}` },
  ]);
  await db.insert(recordingReleaseGroupsTable).values([
    { recordingMbid: MBID_RG_LIB,  releaseGroupMbid: RG_MBID, isPrimary: true, title: `RG Album ${run}` },
    { recordingMbid: MBID_RG_PICK, releaseGroupMbid: RG_MBID, isPrimary: true, title: `RG Album ${run}` },
  ]);

  const [rgPicker] = await db
    .insert(pickersTable)
    .values({ name: `RG DJ ${run}`, handle: `rg-dj-${run}`, pickerType: "dj" })
    .returning({ id: pickersTable.id });
  const rgPickerId = rgPicker!.id;
  allPickerIds.push(rgPickerId);

  const rgPickRows = await db
    .insert(picksTable)
    .values([
      { pickerId: rgPickerId, mbid: MBID_RG_PICK, source: "spin", confidence: "recording_id" as const },
    ])
    .returning({ id: picksTable.id });
  allPickIds.push(...rgPickRows.map((r) => r.id));

  // Library has the lib-side recording (NOT the pick-side one)
  await db.insert(libraryItemsTable).values([
    { userId: userAId!, mbid: MBID_RG_LIB, provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 5: schedule endpoint threads pickerId through show runs
  // ──────────────────────────────────────────────────────────────────────────
  const [schedPicker] = await db
    .insert(pickersTable)
    .values({ name: `Schedule DJ ${run}`, handle: `sched-dj-${run}`, pickerType: "dj" })
    .returning({ id: pickersTable.id });
  schedulePickerId = schedPicker!.id;
  allPickerIds.push(schedulePickerId);

  const [schedStation] = await db
    .insert(stationsTable)
    .values({
      slug: `po-sched-${run}`,
      name: `PO Schedule Station ${run}`,
      streamUrl: "http://example.invalid/po-sched",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  scheduleStationId = schedStation!.id;

  const [schedShow] = await db
    .insert(showsTable)
    .values({
      stationId: scheduleStationId,
      name: `PO Show ${run}`,
      djName: `Schedule DJ ${run}`,
      pickerId: schedulePickerId,
    })
    .returning({ id: showsTable.id });
  scheduleShowId = schedShow!.id;

  // Insert a spin for today so the schedule endpoint returns a run.
  const MBID_SCHED = `po-sched-${run}`;
  allRecordingMbids.push(MBID_SCHED);
  await db.insert(recordingsTable).values({ mbid: MBID_SCHED, title: "Sched Track", artist: "Sched Artist" });
  await db.insert(spinsTable).values({
    stationId: scheduleStationId,
    showId: scheduleShowId,
    mbid: MBID_SCHED,
    confidence: "text",
    rawTitle: "Sched Track",
    rawArtist: "Sched Artist",
    playedAt: new Date(),
  });

  // ── Server ────────────────────────────────────────────────────────────────
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  // FK order: spins, shows, stations, picks, library_items, recordings, rg bridge, pickers, users, connections
  if (scheduleStationId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, scheduleStationId));
  }
  if (scheduleShowId != null) {
    await db.delete(showsTable).where(eq(showsTable.id, scheduleShowId));
  }
  if (scheduleStationId != null) {
    await db.delete(stationsTable).where(eq(stationsTable.id, scheduleStationId));
  }
  if (allPickIds.length > 0) {
    await db.delete(picksTable).where(inArray(picksTable.id, allPickIds));
  }
  if (userAId != null) {
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userAId));
  }
  if (userBId != null) {
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userBId));
  }
  // RG bridge rows
  for (const mbid of allRecordingMbids) {
    await db.delete(recordingReleaseGroupsTable).where(eq(recordingReleaseGroupsTable.recordingMbid, mbid));
  }
  if (allRecordingMbids.length > 0) {
    await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, allRecordingMbids));
  }
  if (allPickerIds.length > 0) {
    await db.delete(pickersTable).where(inArray(pickersTable.id, allPickerIds));
  }
  for (const userId of [userAId, userBId]) {
    if (userId != null) {
      await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
    }
  }
  for (const sid of [SID_A, SID_B]) {
    await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, sid));
  }
});

const TEST_TIMEOUT = 30_000;

type OverlapItem = { pickerId: number; pickerName: string; overlapCount: number };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/me/pickers/overlap — full library (not first 60)", () => {
  it("counts all 62 library MBIDs, not just the first 60 sampled by the old approach", async () => {
    if (!dbAvailable) return;
    _testOnly_clearPickerOverlapCache(userAId!);

    const { status, body } = await get("/api/me/pickers/overlap", SID_A);
    expect(status).toBe(200);

    const items: OverlapItem[] = body.items;
    const fullDjItem = items.find((i) => i.pickerName === `Full DJ ${run}`);

    expect(fullDjItem).toBeDefined();
    // The old 60-MBID sample would cap this at 60; the endpoint must return 62.
    expect(fullDjItem!.overlapCount).toBe(62);
  }, TEST_TIMEOUT);
});

describe("GET /api/me/pickers/overlap — two pickers with identical display names", () => {
  it("returns distinct entries for each pickerId even when names collide", async () => {
    if (!dbAvailable) return;
    _testOnly_clearPickerOverlapCache(userAId!);

    const { status, body } = await get("/api/me/pickers/overlap", SID_A);
    expect(status).toBe(200);

    const items: OverlapItem[] = body.items;
    const DUPE_NAME = `Dupe DJ ${run}`;
    const dupeItems = items.filter((i) => i.pickerName === DUPE_NAME);

    // Both pickers must appear — they are separate rows with distinct pickerId values.
    expect(dupeItems.length).toBe(2);

    // Verify they have different pickerIds and different counts.
    const ids = new Set(dupeItems.map((i) => i.pickerId));
    expect(ids.size).toBe(2);

    const counts = dupeItems.map((i) => i.overlapCount).sort((a, b) => a - b);
    // Dupe picker 1 picked only MBID_DUPE_1 (overlap 1).
    // Dupe picker 2 picked both MBIDs (overlap 2).
    expect(counts).toEqual([1, 2]);
  }, TEST_TIMEOUT);
});

describe("GET /api/me/pickers/overlap — release-group widening", () => {
  it("counts a pick when its recording shares a primary RG with a library item (album-mate)", async () => {
    if (!dbAvailable) return;
    _testOnly_clearPickerOverlapCache(userAId!);

    const { status, body } = await get("/api/me/pickers/overlap", SID_A);
    expect(status).toBe(200);

    const items: OverlapItem[] = body.items;
    const rgDjItem = items.find((i) => i.pickerName === `RG DJ ${run}`);

    // The picker picked MBID_RG_PICK; the library has MBID_RG_LIB.
    // They share RG_MBID as primary → RG widening must fire overlapCount ≥ 1.
    expect(rgDjItem).toBeDefined();
    expect(rgDjItem!.overlapCount).toBeGreaterThanOrEqual(1);
  }, TEST_TIMEOUT);
});

describe("GET /api/me/pickers/overlap — cross-user isolation", () => {
  it("returns an empty list for user B who has no library items", async () => {
    if (!dbAvailable) return;
    _testOnly_clearPickerOverlapCache(userBId!);

    const { status, body } = await get("/api/me/pickers/overlap", SID_B);
    expect(status).toBe(200);
    // User B has zero library items — no picker can overlap with nothing.
    expect(body.items).toEqual([]);
  }, TEST_TIMEOUT);
});

describe("GET /api/stations/schedule — pickerId threaded through show runs", () => {
  it("includes pickerId on the show object for runs whose show has a linked picker", async () => {
    if (!dbAvailable) return;

    const today = new Date().toISOString().slice(0, 10);
    const { status, body } = await get(`/api/stations/schedule?date=${today}`);
    expect(status).toBe(200);

    type ShowRun = {
      runId: unknown;
      show: { name: string; djName: string | null; pickerId: number | null } | null;
    };
    type StationItem = { stationSlug: string; runs: ShowRun[] };

    const stationItem = (body.items as StationItem[]).find(
      (i) => i.stationSlug === `po-sched-${run}`,
    );

    expect(stationItem).toBeDefined();
    expect(stationItem!.runs.length).toBeGreaterThan(0);

    const run0 = stationItem!.runs[0]!;
    expect(run0.show).not.toBeNull();
    // The show is linked to schedulePickerId; the endpoint must thread it through.
    expect(run0.show!.pickerId).toBe(schedulePickerId);
  }, TEST_TIMEOUT);
});
