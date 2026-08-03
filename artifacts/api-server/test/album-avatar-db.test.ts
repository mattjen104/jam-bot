// @vitest-environment node
/**
 * Integration tests for the anonymous album-cover listener identity.
 *
 * Covers:
 *   1. GET /me/avatar returns empty when user has no library
 *   2. GET /me/avatar returns candidates with artwork from library
 *   3. needsChoice=true before any selection; needsChoice=false after PUT
 *   4. PUT /me/avatar persists the selection server-side
 *   5. PUT /me/avatar rejects a recording that is not in the user's candidates
 *   6. PUT /me/avatar rejects a request with no recordingMbid body
 *   7. Rotation is skipped when an active listening session is present
 *   8. Rotation cycles to the next candidate at visit boundary
 *   9. Presence endpoint returns avatars below privacy threshold (< 10 users)
 *  10. Presence endpoint withholds avatars at or above threshold (≥ 10 users)
 *  11. Presence endpoint deduplicates sessions by user (same user = count 1)
 *  12. Presence endpoint always includes the `avatars` key in the response
 *  13. Legacy emoji avatar field (bottle notes) is untouched by album-avatar ops
 *
 * All rows are self-contained (unique slugs/ISRCs per run) and cleaned up in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  recordingsTable,
  libraryItemsTable,
  listenSessionsTable,
  stationsTable,
} from "@workspace/db";
import app from "../src/app.js";

const run = randomUUID().slice(0, 8);

// Session IDs double as deviceKey — requireUserMiddleware matches on the cookie value.
const SID_A = `test-aa-a-${run}`;    // user A — has library with artwork
const SID_B = `test-aa-b-${run}`;    // user B — no library
const SID_C = `test-aa-c-${run}`;    // user C — has 2 library items (rotation)
const SID_PRES = `test-aa-pres-${run}`; // for presence tests

const MBID_ART  = `aa-art1-${run}`;  // has artwork
const MBID_ART2 = `aa-art2-${run}`;  // has artwork — second candidate
const MBID_NOART = `aa-noart-${run}`; // no artwork — must not appear in candidates

const STATION_SLUG = `test-aa-sta-${run}`;

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let userAId: number | undefined;
let userBId: number | undefined;
let userCId: number | undefined;
let stationId: number | undefined;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function apiGet(path: string, sid: string) {
  const r = await fetch(`${baseUrl}${path}`, {
    headers: { cookie: `lore_sid=${sid}` },
  });
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}

async function apiPut(path: string, sid: string, body: unknown) {
  const r = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie: `lore_sid=${sid}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Apply migration (idempotent) so album-avatar columns exist.
  const { applyBottlesMigration } = await import("../src/lore/bottles-migration.js");
  await applyBottlesMigration();

  // Recordings
  await db.insert(recordingsTable).values([
    { mbid: MBID_ART,   title: `AA Track 1 ${run}`, artist: `AA Artist ${run}`,
      artworkUrl: `https://img.example.com/aa-art1-${run}.jpg` },
    { mbid: MBID_ART2,  title: `AA Track 2 ${run}`, artist: `AA Artist ${run}`,
      artworkUrl: `https://img.example.com/aa-art2-${run}.jpg` },
    { mbid: MBID_NOART, title: `AA Track 3 ${run}`, artist: `AA Artist ${run}` },
  ]).onConflictDoNothing();

  // Station (needed for listen_sessions FK)
  const [sta] = await db.insert(stationsTable).values({
    slug: STATION_SLUG,
    name: `AA Sta ${run}`,
    streamUrl: "http://example.invalid/aa",
    stationClass: "community",
  }).returning({ id: stationsTable.id });
  stationId = sta!.id;

  // Users — deviceKey matches the SID cookie
  const [uA] = await db.insert(loreUsersTable).values({ deviceKey: SID_A })
    .returning({ id: loreUsersTable.id });
  userAId = uA!.id;

  const [uB] = await db.insert(loreUsersTable).values({ deviceKey: SID_B })
    .returning({ id: loreUsersTable.id });
  userBId = uB!.id;

  const [uC] = await db.insert(loreUsersTable).values({ deviceKey: SID_C })
    .returning({ id: loreUsersTable.id });
  userCId = uC!.id;

  // Library items — user A has one artworked track
  await db.insert(libraryItemsTable).values({
    userId: userAId!,
    mbid: MBID_ART,
    provenance: { kind: "keep" },
  }).onConflictDoNothing();

  // user A also has the no-artwork track — should not appear as candidate
  await db.insert(libraryItemsTable).values({
    userId: userAId!,
    mbid: MBID_NOART,
    provenance: { kind: "keep" },
  }).onConflictDoNothing();

  // user C has two artworked tracks (needed for rotation tests)
  await db.insert(libraryItemsTable).values([
    { userId: userCId!, mbid: MBID_ART,  provenance: { kind: "keep" } },
    { userId: userCId!, mbid: MBID_ART2, provenance: { kind: "keep" } },
  ]).onConflictDoNothing();

  // HTTP server on an ephemeral port
  server = app.listen(0);
  await new Promise<void>((r) => server!.once("listening", r));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  // Tear down in FK-safe order
  const allUserIds = [userAId, userBId, userCId].filter(Boolean) as number[];
  await db.delete(listenSessionsTable)
    .where(inArray(listenSessionsTable.userId, allUserIds));
  await db.delete(libraryItemsTable)
    .where(inArray(libraryItemsTable.userId, allUserIds));
  await db.delete(loreUsersTable)
    .where(inArray(loreUsersTable.id, allUserIds));
  await db.delete(recordingsTable)
    .where(inArray(recordingsTable.mbid, [MBID_ART, MBID_ART2, MBID_NOART]));
  if (stationId) {
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
  // Clean up any extra presence test users
  await db.execute(sql`
    DELETE FROM listen_sessions WHERE user_id IN (
      SELECT id FROM lore_users WHERE device_key LIKE ${`test-aa-pres-${run}%`}
    )
  `);
  await db.execute(sql`
    DELETE FROM lore_users WHERE device_key LIKE ${`test-aa-pres-${run}%`}
  `);
});

// ── Tests: candidate eligibility ──────────────────────────────────────────────

describe("GET /me/avatar — candidate eligibility", () => {
  it("returns empty candidates and eligible=false when user has no library", async (ctx) => {
    if (!dbAvailable || !userBId) return ctx.skip();
    const { status, body } = await apiGet("/api/me/avatar", SID_B);
    expect(status).toBe(200);
    expect(body.eligible).toBe(false);
    expect(body.candidates).toEqual([]);
    expect(body.current).toBeNull();
    expect(body.needsChoice).toBe(false);
  });

  it("returns candidates with https artwork from the user's own library", async (ctx) => {
    if (!dbAvailable || !userAId) return ctx.skip();
    const { status, body } = await apiGet("/api/me/avatar", SID_A);
    expect(status).toBe(200);
    expect(body.eligible).toBe(true);
    const candidates = body.candidates as Array<{ recordingMbid: string; artworkUrl: string; source: string }>;
    // Only the artworked track should appear
    expect(candidates.every((c) => /^https?:\/\//i.test(c.artworkUrl))).toBe(true);
    expect(candidates.map((c) => c.recordingMbid)).toContain(MBID_ART);
    // No-artwork track must not appear
    expect(candidates.map((c) => c.recordingMbid)).not.toContain(MBID_NOART);
    expect(candidates.every((c) => c.source === "library")).toBe(true);
  });

  it("sets needsChoice=true before any selection is made", async (ctx) => {
    if (!dbAvailable || !userAId) return ctx.skip();
    // Reset any prior selection for this user
    await db.update(loreUsersTable)
      .set({ avatarRecordingMbid: null, avatarArtworkUrl: null, avatarAlbumTitle: null, avatarArtist: null })
      .where(eq(loreUsersTable.id, userAId!));

    const { body } = await apiGet("/api/me/avatar", SID_A);
    expect(body.needsChoice).toBe(true);
    expect(body.current).toBeNull();
  });
});

// ── Tests: explicit selection ─────────────────────────────────────────────────

describe("PUT /me/avatar — explicit selection", () => {
  it("persists a valid candidate and returns needsChoice=false", async (ctx) => {
    if (!dbAvailable || !userAId) return ctx.skip();
    // Reset selection
    await db.update(loreUsersTable)
      .set({ avatarRecordingMbid: null, avatarArtworkUrl: null, avatarAlbumTitle: null, avatarArtist: null })
      .where(eq(loreUsersTable.id, userAId!));

    const { status, body } = await apiPut("/api/me/avatar", SID_A, { recordingMbid: MBID_ART });
    expect(status).toBe(200);
    expect(body.needsChoice).toBe(false);
    const current = body.current as { recordingMbid: string; artworkUrl: string; selectedAt: string } | null;
    expect(current?.recordingMbid).toBe(MBID_ART);
    expect(current?.artworkUrl).toMatch(/^https?:\/\//);
    expect(typeof current?.selectedAt).toBe("string");
  });

  it("GET after PUT confirms selection is stable (current not null, needsChoice false)", async (ctx) => {
    if (!dbAvailable || !userAId) return ctx.skip();
    // Ensure a selection is in place
    await apiPut("/api/me/avatar", SID_A, { recordingMbid: MBID_ART });

    const { body } = await apiGet("/api/me/avatar", SID_A);
    expect(body.needsChoice).toBe(false);
    const current = body.current as { recordingMbid: string } | null;
    expect(current?.recordingMbid).toBe(MBID_ART);
  });

  it("rejects a recording that is not in the user's candidates", async (ctx) => {
    if (!dbAvailable || !userAId) return ctx.skip();
    // user B has no library — so MBID_ART is not eligible for them
    const { status, body } = await apiPut("/api/me/avatar", SID_B, { recordingMbid: MBID_ART });
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when recordingMbid is missing from body", async (ctx) => {
    if (!dbAvailable || !userAId) return ctx.skip();
    const { status, body } = await apiPut("/api/me/avatar", SID_A, {});
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
  });
});

// ── Tests: visit-boundary rotation ───────────────────────────────────────────

describe("GET /me/avatar — visit-boundary rotation", () => {
  it("does NOT rotate when an active listening session is present", async (ctx) => {
    if (!dbAvailable || !userCId || !stationId) return ctx.skip();
    // Set initial avatar to MBID_ART with a visit start > 30 min ago
    const oldVisit = new Date(Date.now() - 35 * 60_000);
    await db.update(loreUsersTable)
      .set({
        avatarRecordingMbid: MBID_ART,
        avatarArtworkUrl: `https://img.example.com/aa-art1-${run}.jpg`,
        avatarAlbumTitle: "Test Album",
        avatarArtist: "Test Artist",
        avatarSource: "library",
        avatarVisitStartedAt: oldVisit,
        avatarVisitRecordingMbid: MBID_ART,
      })
      .where(eq(loreUsersTable.id, userCId!));

    // Insert an active listening session (heartbeat within 4h)
    await db.insert(listenSessionsTable).values({
      userId: userCId!,
      stationId: stationId!,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
    }).onConflictDoNothing();

    const { body } = await apiGet("/api/me/avatar", SID_C);
    const current = body.current as { recordingMbid: string } | null;
    // Should NOT have rotated
    expect(current?.recordingMbid).toBe(MBID_ART);

    // Clean up session
    await db.delete(listenSessionsTable).where(
      and(eq(listenSessionsTable.userId, userCId!), eq(listenSessionsTable.stationId, stationId!)),
    );
  });

  it("rotates to the next candidate when visit gap has elapsed and no active session", async (ctx) => {
    if (!dbAvailable || !userCId) return ctx.skip();
    // Set initial avatar with a very old visit
    const veryOld = new Date(Date.now() - 2 * 60 * 60_000);
    await db.update(loreUsersTable)
      .set({
        avatarRecordingMbid: MBID_ART,
        avatarArtworkUrl: `https://img.example.com/aa-art1-${run}.jpg`,
        avatarAlbumTitle: "Test Album",
        avatarArtist: "Test Artist",
        avatarSource: "library",
        avatarVisitStartedAt: veryOld,
        avatarVisitRecordingMbid: MBID_ART,
      })
      .where(eq(loreUsersTable.id, userCId!));

    // No active session — rotation should fire
    const { body } = await apiGet("/api/me/avatar", SID_C);
    const current = body.current as { recordingMbid: string } | null;
    // Should have rotated to the other candidate
    expect(current?.recordingMbid).toBe(MBID_ART2);
  });
});

// ── Tests: legacy emoji avatar untouched ─────────────────────────────────────

describe("album-avatar: legacy emoji avatar untouched", () => {
  it("emoji avatar field is not overwritten by album-avatar PUT", async (ctx) => {
    if (!dbAvailable || !userAId) return ctx.skip();
    // Write a legacy emoji avatar directly
    await db.update(loreUsersTable)
      .set({ avatar: "🎸" })
      .where(eq(loreUsersTable.id, userAId!));

    // Do a PUT to set album avatar
    await apiPut("/api/me/avatar", SID_A, { recordingMbid: MBID_ART });

    // Verify emoji is still intact
    const [row] = await db.select({ avatar: loreUsersTable.avatar })
      .from(loreUsersTable)
      .where(eq(loreUsersTable.id, userAId!));
    expect(row?.avatar).toBe("🎸");
  });
});

// ── Tests: station presence privacy threshold ─────────────────────────────────

describe("GET /api/stations/social/presence — album-cover avatars", () => {
  it("always includes the avatars key in the response", async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();
    // Query with a station that has no sessions
    const r = await apiGet(`/api/stations/social/presence?ids=${stationId}`, SID_A);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("avatars");
  });

  it("returns avatars for a station with < 10 distinct users below threshold", async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();
    // Create a fresh presence user with an album avatar
    const devKey = `${SID_PRES}-pres1`;
    const [presUser] = await db.insert(loreUsersTable).values({
      deviceKey: devKey,
      avatarRecordingMbid: MBID_ART,
      avatarArtworkUrl: `https://img.example.com/aa-art1-${run}.jpg`,
      avatarAlbumTitle: "Album A",
      avatarArtist: "Artist A",
      avatarSource: "library",
    }).returning({ id: loreUsersTable.id });

    const now = new Date();
    await db.insert(listenSessionsTable).values({
      userId: presUser!.id,
      stationId: stationId!,
      startedAt: now,
      lastHeartbeatAt: now,
    });

    const r = await apiGet(`/api/stations/social/presence?ids=${stationId}`, SID_A);
    expect(r.status).toBe(200);
    const avatars = r.body.avatars as Record<string, Array<{ artworkUrl: string }>>;
    expect(avatars[stationId!]).toBeDefined();
    expect(avatars[stationId!]!.length).toBeGreaterThan(0);
    expect(avatars[stationId!]![0]!.artworkUrl).toMatch(/^https?:\/\//);

    // Cleanup
    await db.delete(listenSessionsTable).where(eq(listenSessionsTable.userId, presUser!.id));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, presUser!.id));
  });

  it("withholds avatars for a station with ≥ 10 distinct users (privacy threshold)", async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();
    const presUserIds: number[] = [];

    // Create 10 distinct users all listening to the same station
    for (let i = 0; i < 10; i++) {
      const [u] = await db.insert(loreUsersTable).values({
        deviceKey: `${SID_PRES}-thresh-${i}`,
        avatarRecordingMbid: MBID_ART,
        avatarArtworkUrl: `https://img.example.com/aa-art1-${run}.jpg`,
        avatarAlbumTitle: "Album A",
        avatarArtist: "Artist A",
        avatarSource: "library",
      }).returning({ id: loreUsersTable.id });
      presUserIds.push(u!.id);

      const now = new Date();
      await db.insert(listenSessionsTable).values({
        userId: u!.id,
        stationId: stationId!,
        startedAt: now,
        lastHeartbeatAt: now,
      });
    }

    const r = await apiGet(`/api/stations/social/presence?ids=${stationId}`, SID_A);
    expect(r.status).toBe(200);
    const presence = r.body.presence as Record<string, number>;
    expect(Number(presence[stationId!])).toBeGreaterThanOrEqual(10);
    const avatars = r.body.avatars as Record<string, unknown[]>;
    // At the threshold, avatars key should be absent for this station
    expect(avatars[stationId!]).toBeUndefined();

    // Cleanup
    await db.delete(listenSessionsTable)
      .where(inArray(listenSessionsTable.userId, presUserIds));
    await db.delete(loreUsersTable)
      .where(inArray(loreUsersTable.id, presUserIds));
  });

  it("deduplicates sessions: same user with two sessions counted once", async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();
    const devKey = `${SID_PRES}-dedup`;
    const [u] = await db.insert(loreUsersTable).values({
      deviceKey: devKey,
      avatarArtworkUrl: `https://img.example.com/aa-art1-${run}.jpg`,
      avatarAlbumTitle: "Album A",
      avatarArtist: "Artist A",
      avatarSource: "library",
    }).returning({ id: loreUsersTable.id });

    const now = new Date();
    // Two sessions for the same user
    await db.insert(listenSessionsTable).values([
      { userId: u!.id, stationId: stationId!, startedAt: now, lastHeartbeatAt: now },
      { userId: u!.id, stationId: stationId!, startedAt: now, lastHeartbeatAt: now },
    ]);

    const r = await apiGet(`/api/stations/social/presence?ids=${stationId}`, SID_A);
    expect(r.status).toBe(200);
    const presence = r.body.presence as Record<string, number>;
    // Should count as 1, not 2 (dedup by userId)
    expect(Number(presence[stationId!])).toBe(1);

    // Cleanup
    await db.delete(listenSessionsTable).where(eq(listenSessionsTable.userId, u!.id));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, u!.id));
  });

  it("returns avatars:{} (not missing) for an empty ids query", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const r = await apiGet("/api/stations/social/presence?ids=", SID_A);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("avatars");
    expect(r.body.avatars).toEqual({});
  });
});
