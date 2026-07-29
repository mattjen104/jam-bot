/**
 * Integration tests for the listening ledger endpoints:
 *   POST   /api/me/listens
 *   PATCH  /api/me/listens/:id
 *   GET    /api/me/albums/completed
 *   DELETE /api/me/listens (bulk clear)
 *
 * Self-skips when no real DB is reachable (same pattern as me-library-db.test.ts).
 * Uses unique run-scoped identifiers so parallel test runs never collide.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  libraryItemsTable,
  listensTable,
  stationsTable,
} from "@workspace/db";
import app from "../src/app.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);
const SID = `test-listens-sid-${run}`;

// Recording with a known duration: 5 minutes (300 000 ms).
// 70 % threshold = 210 000 ms; 4-min cap = 240 000 ms → threshold = 210 000 ms.
const MBID_LONG = `test-listens-long-${run}`;
const DURATION_LONG = 300_000; // 5 min

// Recording with a short duration: 3 minutes (180 000 ms).
// 70 % threshold = 126 000 ms; 4-min cap = 240 000 ms → threshold = 126 000 ms.
const MBID_SHORT = `test-listens-short-${run}`;
const DURATION_SHORT = 180_000; // 3 min

// Release group for MBID_LONG — used to test releaseGroupMbid denormalization.
const RG_MBID = `test-listens-rg-${run}`;

let dbAvailable = false;
let userId: number | null = null;
let server: Server | undefined;
let baseUrl = "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cookie() {
  return `lore_sid=${SID}`;
}

async function postListen(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/me/listens`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function patchListen(id: number, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/me/listens/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getAlbumsCompleted() {
  const res = await fetch(`${baseUrl}/api/me/albums/completed`, {
    headers: { cookie: cookie() },
  });
  return { status: res.status, body: await res.json() };
}

async function deleteAllListens(params?: Record<string, string>) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${baseUrl}/api/me/listens${qs}`, {
    method: "DELETE",
    headers: { cookie: cookie() },
  });
  return {
    status: res.status,
    body: res.status === 204 ? null : await res.json(),
  };
}

// Toggle ledgerEnabled for the test user directly in the DB.
async function setLedger(enabled: boolean) {
  await db
    .update(loreUsersTable)
    .set({ ledgerEnabled: enabled })
    .where(eq(loreUsersTable.id, userId!));
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

  // Provision a spotify_connections stub so loreUsersTable.spotifyConnectionId FK resolves.
  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "t",
    refreshToken: "r",
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  // Provision a lore_user with deviceKey = SID (auth reads lore_users.deviceKey).
  const [u] = await db
    .insert(loreUsersTable)
    .values({
      spotifyUserId: `test-listens-user-${run}`,
      spotifyConnectionId: SID,
      deviceKey: SID,
      ledgerEnabled: false, // starts disabled
    })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // Seed two recordings with known durations.
  await db.insert(recordingsTable).values([
    { mbid: MBID_LONG, title: `Long Track ${run}`, artist: `Artist ${run}`, durationMs: DURATION_LONG },
    { mbid: MBID_SHORT, title: `Short Track ${run}`, artist: `Artist ${run}`, durationMs: DURATION_SHORT },
  ]);

  // Seed a release group linking MBID_LONG.
  await db.insert(recordingReleaseGroupsTable).values({
    recordingMbid: MBID_LONG,
    releaseGroupMbid: RG_MBID,
    isPrimary: true,
    title: `Test Album ${run}`,
  });

  server = app.listen(0);
  const addr = server.address() as { port: number };
  baseUrl = `http://localhost:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable || userId === null) return;
  // Cascade: listens are deleted first via user delete (onDelete: cascade).
  await db.delete(recordingReleaseGroupsTable).where(
    eq(recordingReleaseGroupsTable.recordingMbid, MBID_LONG),
  );
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_LONG));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_SHORT));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  await db
    .delete(spotifyConnectionsTable)
    .where(eq(spotifyConnectionsTable.sid, SID));
});

// ---------------------------------------------------------------------------
// POST /api/me/listens
// ---------------------------------------------------------------------------

describe("POST /api/me/listens", () => {
  it("returns { id: null } and writes no row when ledgerEnabled=false", async () => {
    if (!dbAvailable) return;

    await setLedger(false);
    const { status, body } = await postListen({
      mbid: MBID_LONG,
      context: "broadcast",
      outputService: "broadcast",
    });

    expect(status).toBe(200);
    expect(body.id).toBeNull();

    // Confirm nothing actually written.
    const rows = await db
      .select({ id: listensTable.id })
      .from(listensTable)
      .where(and(eq(listensTable.userId, userId!), eq(listensTable.mbid, MBID_LONG)));
    expect(rows).toHaveLength(0);
  });

  it("requires context and outputService", async () => {
    if (!dbAvailable) return;

    await setLedger(true);
    const { status } = await postListen({ mbid: MBID_LONG });
    expect(status).toBe(400);
  });

  it("writes a row and returns an integer id when ledgerEnabled=true", async () => {
    if (!dbAvailable) return;

    await setLedger(true);
    const { status, body } = await postListen({
      mbid: MBID_LONG,
      context: "broadcast",
      outputService: "broadcast",
    });

    expect(status).toBe(200);
    expect(typeof body.id).toBe("number");

    // Clean up for subsequent tests.
    await db.delete(listensTable).where(eq(listensTable.id, body.id));
  });

  it("denormalises releaseGroupMbid from recording_release_groups when isPrimary=true", async () => {
    if (!dbAvailable) return;

    await setLedger(true);
    const { body } = await postListen({
      mbid: MBID_LONG,
      context: "ride",
      outputService: "spotify",
    });

    const [row] = await db
      .select({ releaseGroupMbid: listensTable.releaseGroupMbid })
      .from(listensTable)
      .where(eq(listensTable.id, body.id));

    expect(row?.releaseGroupMbid).toBe(RG_MBID);

    await db.delete(listensTable).where(eq(listensTable.id, body.id));
  });

  it("stores null releaseGroupMbid for a recording with no release-group link", async () => {
    if (!dbAvailable) return;

    await setLedger(true);
    const { body } = await postListen({
      mbid: MBID_SHORT, // no recording_release_groups row
      context: "broadcast",
      outputService: "broadcast",
    });

    const [row] = await db
      .select({ releaseGroupMbid: listensTable.releaseGroupMbid })
      .from(listensTable)
      .where(eq(listensTable.id, body.id));

    expect(row?.releaseGroupMbid).toBeNull();

    await db.delete(listensTable).where(eq(listensTable.id, body.id));
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/me/listens/:id
// ---------------------------------------------------------------------------

describe("PATCH /api/me/listens/:id", () => {
  /** Seed a listen row and return its id. */
  async function seedListen(mbid: string): Promise<number> {
    const [row] = await db
      .insert(listensTable)
      .values({
        userId: userId!,
        mbid,
        context: "broadcast",
        outputService: "broadcast",
        startedAt: new Date(),
      })
      .returning({ id: listensTable.id });
    return row!.id;
  }

  it("returns 400 for an invalid listen id", async () => {
    if (!dbAvailable) return;
    const { status } = await patchListen(NaN, { msPlayed: 1000 });
    expect(status).toBe(400);
  });

  it("returns 404 for a non-existent listen", async () => {
    if (!dbAvailable) return;
    const { status } = await patchListen(999_999_999, { msPlayed: 1000 });
    expect(status).toBe(404);
  });

  it("returns 400 when msPlayed is missing or negative", async () => {
    if (!dbAvailable) return;
    const id = await seedListen(MBID_LONG);

    const { status: s1 } = await patchListen(id, {});
    expect(s1).toBe(400);

    const { status: s2 } = await patchListen(id, { msPlayed: -1 });
    expect(s2).toBe(400);

    await db.delete(listensTable).where(eq(listensTable.id, id));
  });

  it("does NOT flip completed below the 70% threshold", async () => {
    if (!dbAvailable) return;

    const id = await seedListen(MBID_LONG);
    // 70% of 300 000 ms = 210 000 ms. Play only 200 000 ms.
    const { body } = await patchListen(id, { msPlayed: 200_000 });
    expect(body.completed).toBe(false);

    await db.delete(listensTable).where(eq(listensTable.id, id));
  });

  it("flips completed to true at exactly the 70% threshold", async () => {
    if (!dbAvailable) return;

    const id = await seedListen(MBID_LONG);
    // Exactly 70% of 300 000 ms = 210 000 ms.
    const { body } = await patchListen(id, { msPlayed: 210_000 });
    expect(body.completed).toBe(true);

    await db.delete(listensTable).where(eq(listensTable.id, id));
  });

  it("flips completed to true at the 4-minute cap (short track, 70% > 4 min case for long)", async () => {
    if (!dbAvailable) return;

    // MBID_SHORT: 3-min track. 70% of 180 000 ms = 126 000 ms (< 4-min cap).
    const id = await seedListen(MBID_SHORT);
    const { body } = await patchListen(id, { msPlayed: 126_000 });
    expect(body.completed).toBe(true);

    await db.delete(listensTable).where(eq(listensTable.id, id));
  });

  it("completed is sticky — a later lower msPlayed never unflips it", async () => {
    if (!dbAvailable) return;

    const id = await seedListen(MBID_LONG);

    // First patch: cross the threshold.
    const { body: first } = await patchListen(id, { msPlayed: 210_000 });
    expect(first.completed).toBe(true);

    // Second patch: send a lower value (e.g. the user seeked back).
    const { body: second } = await patchListen(id, { msPlayed: 5_000 });
    expect(second.completed).toBe(true);

    // Confirm in DB too.
    const [dbRow] = await db
      .select({ completed: listensTable.completed })
      .from(listensTable)
      .where(eq(listensTable.id, id));
    expect(dbRow?.completed).toBe(true);

    await db.delete(listensTable).where(eq(listensTable.id, id));
  });

  it("flips completed for a listen with no mbid/duration (null duration → never completes below 4 min)", async () => {
    if (!dbAvailable) return;

    // Seed a listen with no mbid so durationMs is null.
    const [row] = await db
      .insert(listensTable)
      .values({
        userId: userId!,
        mbid: null,
        context: "broadcast",
        outputService: "broadcast",
        startedAt: new Date(),
      })
      .returning({ id: listensTable.id });
    const id = row!.id;

    // Without a duration, isListenCompleted returns false for anything < 4 min.
    const { body: below4 } = await patchListen(id, { msPlayed: 200_000 });
    expect(below4.completed).toBe(false);

    // At exactly 4 minutes it flips.
    const { body: at4 } = await patchListen(id, { msPlayed: 4 * 60 * 1000 });
    expect(at4.completed).toBe(true);

    await db.delete(listensTable).where(eq(listensTable.id, id));
  });
});

// ---------------------------------------------------------------------------
// GET /api/me/albums/completed
// ---------------------------------------------------------------------------

describe("GET /api/me/albums/completed", () => {
  it("returns an empty albums array when the user has no listens", async () => {
    if (!dbAvailable) return;

    // Ensure a clean slate.
    await db.delete(listensTable).where(eq(listensTable.userId, userId!));

    const { status, body } = await getAlbumsCompleted();
    expect(status).toBe(200);
    expect(body.albums).toEqual([]);
  });

  it("returns heardTracks=0 when listens exist but none are completed", async () => {
    if (!dbAvailable) return;

    await db.delete(listensTable).where(eq(listensTable.userId, userId!));

    // Seed a non-completed listen with a releaseGroupMbid.
    await db.insert(listensTable).values({
      userId: userId!,
      mbid: MBID_LONG,
      context: "broadcast",
      outputService: "broadcast",
      startedAt: new Date(),
      releaseGroupMbid: RG_MBID,
      completed: false,
    });

    const { body } = await getAlbumsCompleted();

    // The release group must appear (it was heard), with heardTracks=0.
    const album = body.albums.find(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_MBID,
    );
    expect(album).toBeTruthy();
    expect(album.heardTracks).toBe(0);

    await db.delete(listensTable).where(eq(listensTable.userId, userId!));
  });

  it("counts only distinct completed mbids per release group as heardTracks", async () => {
    if (!dbAvailable) return;

    await db.delete(listensTable).where(eq(listensTable.userId, userId!));

    const base = new Date();

    // Two completed listens for MBID_LONG (same track — should count once).
    await db.insert(listensTable).values([
      {
        userId: userId!,
        mbid: MBID_LONG,
        context: "broadcast",
        outputService: "broadcast",
        startedAt: new Date(base.getTime()),
        releaseGroupMbid: RG_MBID,
        completed: true,
      },
      {
        userId: userId!,
        mbid: MBID_LONG,
        context: "ride",
        outputService: "spotify",
        startedAt: new Date(base.getTime() + 1000),
        releaseGroupMbid: RG_MBID,
        completed: true,
      },
    ]);

    const { body } = await getAlbumsCompleted();
    const album = body.albums.find(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_MBID,
    );
    expect(album).toBeTruthy();
    // Two listens, same MBID — distinct count is 1.
    expect(album.heardTracks).toBe(1);

    await db.delete(listensTable).where(eq(listensTable.userId, userId!));
  });

  it("returns album title from recording_release_groups", async () => {
    if (!dbAvailable) return;

    await db.delete(listensTable).where(eq(listensTable.userId, userId!));

    await db.insert(listensTable).values({
      userId: userId!,
      mbid: MBID_LONG,
      context: "broadcast",
      outputService: "broadcast",
      startedAt: new Date(),
      releaseGroupMbid: RG_MBID,
      completed: true,
    });

    const { body } = await getAlbumsCompleted();
    const album = body.albums.find(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_MBID,
    );
    expect(album?.title).toBe(`Test Album ${run}`);

    await db.delete(listensTable).where(eq(listensTable.userId, userId!));
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/me/listens (bulk wipe)
// ---------------------------------------------------------------------------

describe("DELETE /api/me/listens", () => {
  /** Seed N rows for the test user. */
  async function seedN(n: number) {
    const rows = Array.from({ length: n }, (_, i) => ({
      userId: userId!,
      mbid: null as string | null,
      context: "broadcast",
      outputService: "broadcast",
      startedAt: new Date(Date.now() - i * 1000),
    }));
    await db.insert(listensTable).values(rows);
  }

  async function countListens(): Promise<number> {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(listensTable)
      .where(eq(listensTable.userId, userId!));
    return n;
  }

  it("returns 400 without ?confirm=true", async () => {
    if (!dbAvailable) return;

    await seedN(2);
    const { status, body } = await deleteAllListens();
    expect(status).toBe(400);
    expect(body.error).toMatch(/confirm/i);

    // Rows still present.
    expect(await countListens()).toBeGreaterThan(0);
    await db.delete(listensTable).where(eq(listensTable.userId, userId!));
  });

  it("returns 400 with confirm=false (not 'true')", async () => {
    if (!dbAvailable) return;

    await seedN(2);
    const { status } = await deleteAllListens({ confirm: "false" });
    expect(status).toBe(400);
    await db.delete(listensTable).where(eq(listensTable.userId, userId!));
  });

  it("deletes all listens and returns 204 with ?confirm=true", async () => {
    if (!dbAvailable) return;

    await seedN(3);
    expect(await countListens()).toBe(3);

    const { status, body } = await deleteAllListens({ confirm: "true" });
    expect(status).toBe(204);
    expect(body).toBeNull();
    expect(await countListens()).toBe(0);
  });

  it("is idempotent — a second wipe on an empty ledger still returns 204", async () => {
    if (!dbAvailable) return;

    const { status } = await deleteAllListens({ confirm: "true" });
    expect(status).toBe(204);
    expect(await countListens()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Full listen-then-keep flow
// ---------------------------------------------------------------------------

describe("listen-then-keep integration", () => {
  it("listen completes, keep inserts library row, listen row is unaffected, album still appears", async () => {
    if (!dbAvailable) return;

    // Start with a clean slate for this user.
    await db.delete(listensTable).where(eq(listensTable.userId, userId!));
    await db
      .delete(libraryItemsTable)
      .where(
        and(
          eq(libraryItemsTable.userId, userId!),
          eq(libraryItemsTable.mbid, MBID_LONG),
        ),
      );

    // 1. Enable ledger and open a listen for MBID_LONG.
    await setLedger(true);
    const { status: postStatus, body: postBody } = await postListen({
      mbid: MBID_LONG,
      context: "broadcast",
      outputService: "broadcast",
    });
    expect(postStatus).toBe(200);
    const listenId: number = postBody.id;
    expect(typeof listenId).toBe("number");

    // 2. Mark the listen completed (70 % of 300 000 ms = 210 000 ms).
    const { status: patchStatus, body: patchBody } = await patchListen(
      listenId,
      { msPlayed: 210_000 },
    );
    expect(patchStatus).toBe(200);
    expect(patchBody.completed).toBe(true);

    // 3. Keep the track.
    const keepRes = await fetch(`${baseUrl}/api/me/keep`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie() },
      body: JSON.stringify({ mbid: MBID_LONG }),
    });
    expect(keepRes.status).toBe(200);
    const keepBody = await keepRes.json();
    expect(keepBody.keptToLore).toBe(true);

    // 4. library_items row must exist for this user + MBID_LONG.
    const libRows = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(
        and(
          eq(libraryItemsTable.userId, userId!),
          eq(libraryItemsTable.mbid, MBID_LONG),
        ),
      );
    expect(libRows).toHaveLength(1);

    // 5. The listen row must still be completed with releaseGroupMbid intact.
    const [dbListen] = await db
      .select({
        completed: listensTable.completed,
        releaseGroupMbid: listensTable.releaseGroupMbid,
      })
      .from(listensTable)
      .where(eq(listensTable.id, listenId));
    expect(dbListen?.completed).toBe(true);
    expect(dbListen?.releaseGroupMbid).toBe(RG_MBID);

    // 6. GET /me/albums/completed must still return the album.
    const { status: albumStatus, body: albumBody } = await getAlbumsCompleted();
    expect(albumStatus).toBe(200);
    const album = albumBody.albums.find(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_MBID,
    );
    expect(album).toBeTruthy();
    expect(album.heardTracks).toBeGreaterThanOrEqual(1);

    // Cleanup.
    await db.delete(listensTable).where(eq(listensTable.id, listenId));
    await db
      .delete(libraryItemsTable)
      .where(
        and(
          eq(libraryItemsTable.userId, userId!),
          eq(libraryItemsTable.mbid, MBID_LONG),
        ),
      );
  });
});
