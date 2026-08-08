// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  spotifyLibraryItemsTable,
  recordingsTable,
  stationsTable,
  spinsTable,
} from "@workspace/db";
import app from "../src/app.js";
import { _testOnly_clearCrossingsCache } from "../src/routes/me/crossings.js";
import {
  buildLibraryHitContext,
  _testOnly_clearLibraryHitCache,
} from "../src/lore/library-hits.js";
import { loadActiveLibraryItems } from "../src/lore/library-sync.js";

/**
 * Integration tests for the library active/removed state:
 *
 *  - POST /api/me/library/removal marks a resolved row removed / restores it
 *    (and the same for unresolved soft rows via spotifyId).
 *  - Removed rows STILL appear in GET /api/me/library, flagged removed.
 *  - Removed rows are EXCLUDED from GET /api/me/crossings and from
 *    buildLibraryHitContext (library-hit highlighting); restore brings them
 *    back — both via cache busts, no server restart.
 *  - Deselecting NEVER calls Spotify (no unsave request leaves the server).
 *
 * Run-isolated seeds; cleanup in afterAll; skips silently without a DB.
 */

const run = randomUUID().slice(0, 8);
const SID = `test-librm-sid-${run}`;
const MBID_KEEP = `test-librm-keep-${run}`;    // resolved keep — gets removed/restored
const MBID_OTHER = `test-librm-other-${run}`;  // resolved keep — stays active
const SPOTIFY_ID = `test-librm-soft-${run}`;   // unresolved soft row
const SOFT_ARTIST = `Librm Soft Artist ${run}`;
const STATION_SLUG = `test-librm-sta-${run}`;

let dbAvailable = false;
let userId: number | null = null;
let stationId: number | null = null;
let server: Server | undefined;
let baseUrl = "";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      cookie: `lore_sid=${SID}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  return { status: res.status, body: await res.json() };
}

const postRemoval = (body: unknown) =>
  api("/api/me/library/removal", { method: "POST", body: JSON.stringify(body) });

async function freshCrossings() {
  await _testOnly_clearCrossingsCache(userId!);
  return api("/api/me/crossings");
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "t",
    refreshToken: "r",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [user] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `librm-user-${run}`, spotifyConnectionId: SID, deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBID_KEEP, title: "Removable Track", artist: `Librm Artist ${run}` },
    { mbid: MBID_OTHER, title: "Staying Track", artist: `Librm Other ${run}` },
  ]);
  await db.insert(libraryItemsTable).values([
    { userId, mbid: MBID_KEEP, provenance: { kind: "keep" } },
    { userId, mbid: MBID_OTHER, provenance: { kind: "import", service: "spotify" } },
  ]);
  await db.insert(spotifyLibraryItemsTable).values({
    userId,
    spotifyId: SPOTIFY_ID,
    title: "Unmatched Soft Track",
    artist: SOFT_ARTIST,
  });

  // Station + a recent spin of the removable track → 1 exact crossing.
  const [sta] = await db
    .insert(stationsTable)
    .values({ slug: STATION_SLUG, name: `Librm FM ${run}`, streamUrl: `https://example.com/${STATION_SLUG}.mp3`, hidden: false })
    .returning({ id: stationsTable.id });
  stationId = sta!.id;
  await db.insert(spinsTable).values({
    stationId,
    mbid: MBID_KEEP,
    rawArtist: `Librm Artist ${run}`,
    rawTitle: "Removable Track",
    playedAt: new Date(Date.now() - 60 * 60 * 1000),
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;
  if (stationId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
  if (userId != null) {
    await db.delete(spotifyLibraryItemsTable).where(eq(spotifyLibraryItemsTable.userId, userId));
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_KEEP));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_OTHER));
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
});

describe("POST /api/me/library/removal", () => {
  it("validates the body", async () => {
    if (!dbAvailable) return;
    expect((await postRemoval({ removed: true })).status).toBe(400);
    expect((await postRemoval({ mbid: MBID_KEEP })).status).toBe(400);
  });

  it("404s for a row the user does not have", async () => {
    if (!dbAvailable) return;
    expect((await postRemoval({ mbid: `nope-${run}`, removed: true })).status).toBe(404);
    expect((await postRemoval({ spotifyId: `nope-${run}`, removed: true })).status).toBe(404);
  });

  it("never calls Spotify when deselecting (no unsave)", async () => {
    if (!dbAvailable) return;
    const realFetch = globalThis.fetch;
    const spotifyCalls: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(((input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      if (url.includes("spotify.com")) spotifyCalls.push(url);
      return realFetch(input, init);
    }) as typeof fetch);
    try {
      const { status, body } = await postRemoval({ mbid: MBID_KEEP, removed: true });
      expect(status).toBe(200);
      expect(body.removed).toBe(true);
      expect(typeof body.removedAt).toBe("string");
      expect(spotifyCalls).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the removed row in the library list, flagged removed", async () => {
    if (!dbAvailable) return;
    const { status, body } = await api("/api/me/library?limit=50");
    expect(status).toBe(200);
    const removedRow = body.items.find((i: any) => i.mbid === MBID_KEEP);
    expect(removedRow).toBeTruthy();
    expect(removedRow.removed).toBe(true);
    expect(typeof removedRow.removedAt).toBe("string");
    const activeRow = body.items.find((i: any) => i.mbid === MBID_OTHER);
    expect(activeRow.removed).toBeUndefined();
  });

  it("excludes removed rows from crossings and library hits; restore brings them back", async () => {
    if (!dbAvailable) return;

    // Removed (from previous test) → no crossing for the station.
    const removedRes = await freshCrossings();
    expect(removedRes.status).toBe(200);
    const rowWhileRemoved = removedRes.body.items.find(
      (i: any) => i.stationSlug === STATION_SLUG,
    );
    expect(rowWhileRemoved?.crossings ?? 0).toBe(0);

    _testOnly_clearLibraryHitCache(userId!);
    const ctxRemoved = await buildLibraryHitContext(userId!);
    expect(ctxRemoved.libMbids.has(MBID_KEEP)).toBe(false);
    expect(ctxRemoved.libMbids.has(MBID_OTHER)).toBe(true);

    // Restore → crossing and hit context return WITHOUT any server restart
    // (the endpoint busts both caches itself; crossings L1/L2 are cleared by
    // bustCrossingsCache, we only force a fresh compute for determinism).
    const restore = await postRemoval({ mbid: MBID_KEEP, removed: false });
    expect(restore.status).toBe(200);
    expect(restore.body.removed).toBe(false);
    expect(restore.body.removedAt).toBeNull();

    const restoredRes = await freshCrossings();
    const rowRestored = restoredRes.body.items.find(
      (i: any) => i.stationSlug === STATION_SLUG,
    );
    expect(rowRestored?.crossings).toBeGreaterThanOrEqual(1);

    _testOnly_clearLibraryHitCache(userId!);
    const ctxRestored = await buildLibraryHitContext(userId!);
    expect(ctxRestored.libMbids.has(MBID_KEEP)).toBe(true);
  });

  it("excludes removed rows from /me/library/mbids (incl. soft artists)", async () => {
    if (!dbAvailable) return;
    await postRemoval({ mbid: MBID_KEEP, removed: true });
    await postRemoval({ spotifyId: SPOTIFY_ID, removed: true });

    const { status, body } = await api("/api/me/library/mbids");
    expect(status).toBe(200);
    expect(body.mbids).not.toContain(MBID_KEEP);
    expect(body.mbids).toContain(MBID_OTHER);
    expect(body.softArtists ?? []).not.toContain(SOFT_ARTIST);

    // Restore both for later tests.
    await postRemoval({ mbid: MBID_KEEP, removed: false });
    await postRemoval({ spotifyId: SPOTIFY_ID, removed: false });
    const after = await api("/api/me/library/mbids");
    expect(after.body.mbids).toContain(MBID_KEEP);
    expect(after.body.softArtists).toContain(SOFT_ARTIST);
  });

  it("excludes removed rows from /player/lore-counts keptSince, restored rows return", async () => {
    if (!dbAvailable) return;
    const loreCounts = () =>
      api(`/api/player/lore-counts?mbids=${MBID_KEEP},${MBID_OTHER}`);

    await postRemoval({ mbid: MBID_KEEP, removed: true });
    let { status, body } = await loreCounts();
    expect(status).toBe(200);
    const removedItem = body.items.find((i: any) => i.mbid === MBID_KEEP);
    const otherItem = body.items.find((i: any) => i.mbid === MBID_OTHER);
    expect(removedItem.keptSince).toBeNull();
    expect(otherItem.keptSince).not.toBeNull();

    await postRemoval({ mbid: MBID_KEEP, removed: false });
    ({ status, body } = await loreCounts());
    expect(status).toBe(200);
    expect(body.items.find((i: any) => i.mbid === MBID_KEEP).keptSince).not.toBeNull();
  });

  it("keeps a removed row removed across import-style upserts, and explicit keep restores it", async () => {
    if (!dbAvailable) return;
    await postRemoval({ mbid: MBID_KEEP, removed: true });

    // Import-style insert (onConflictDoNothing) must NOT reactivate the row.
    await db
      .insert(libraryItemsTable)
      .values({ userId: userId!, mbid: MBID_KEEP, provenance: { kind: "import", service: "spotify" } })
      .onConflictDoNothing();
    const [rowAfterImport] = await db
      .select({ removedAt: libraryItemsTable.removedAt })
      .from(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, userId!), eq(libraryItemsTable.mbid, MBID_KEEP)));
    expect(rowAfterImport!.removedAt).not.toBeNull();

    // An explicit keep is a deliberate listener action → restores the row.
    const keepRes = await api("/api/me/keep", {
      method: "POST",
      body: JSON.stringify({ mbid: MBID_KEEP }),
    });
    expect(keepRes.status).toBe(200);
    const [rowAfterKeep] = await db
      .select({ removedAt: libraryItemsTable.removedAt })
      .from(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, userId!), eq(libraryItemsTable.mbid, MBID_KEEP)));
    expect(rowAfterKeep!.removedAt).toBeNull();
  });

  it("excludes removed rows from the Spotify sync selection; restore brings them back", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    // Deselect the keep row, then the sync worker's selection must not
    // contain it — removed tracks are never synced back to Spotify.
    await postRemoval({ mbid: MBID_KEEP, removed: true });
    const removedItems = await loadActiveLibraryItems(userId!);
    expect(removedItems.some((item) => item.mbid === MBID_KEEP)).toBe(false);
    expect(removedItems.some((item) => item.mbid === MBID_OTHER)).toBe(true);
    // Restore → eligible for sync again.
    await postRemoval({ mbid: MBID_KEEP, removed: false });
    const restoredItems = await loadActiveLibraryItems(userId!);
    expect(restoredItems.some((item) => item.mbid === MBID_KEEP)).toBe(true);
  }, 120_000);

  it("excludes removed rows from avatar candidates and from active-library eligibility", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    // Give the removable recording artwork so it is an avatar candidate,
    // and strip artwork from the other row so eligibility hinges on it.
    await db.execute(
      sql`UPDATE recordings SET artwork_url = 'https://example.com/librm-art.jpg' WHERE mbid = ${MBID_KEEP}`,
    );
    await db.execute(sql`UPDATE recordings SET artwork_url = NULL WHERE mbid = ${MBID_OTHER}`);

    const active = await api("/api/me/avatar");
    expect(active.status).toBe(200);
    expect(
      (active.body.candidates as { recordingMbid: string }[]).some((c) => c.recordingMbid === MBID_KEEP),
    ).toBe(true);

    await postRemoval({ mbid: MBID_KEEP, removed: true });
    const afterRemoval = await api("/api/me/avatar");
    expect(afterRemoval.status).toBe(200);
    // Removed rows are neither avatar candidates nor evidence of an active
    // library (no manufactured identity from deselected tracks).
    expect(
      (afterRemoval.body.candidates as { recordingMbid: string }[]).some((c) => c.recordingMbid === MBID_KEEP),
    ).toBe(false);

    await postRemoval({ mbid: MBID_KEEP, removed: false });
    const restored = await api("/api/me/avatar");
    expect(
      (restored.body.candidates as { recordingMbid: string }[]).some((c) => c.recordingMbid === MBID_KEEP),
    ).toBe(true);
  }, 120_000);

  it("excludes removed rows from keep/status, and legacy unkeep soft-removes (timeline preserved)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    // Active row reports kept.
    const before = await api(`/api/me/keep/status?mbids=${MBID_KEEP},${MBID_OTHER}`);
    expect(before.body.kept).toContain(MBID_KEEP);

    // Deselect → no longer "kept" in the player, but the row still exists.
    await postRemoval({ mbid: MBID_KEEP, removed: true });
    const during = await api(`/api/me/keep/status?mbids=${MBID_KEEP},${MBID_OTHER}`);
    expect(during.body.kept).not.toContain(MBID_KEEP);
    expect(during.body.kept).toContain(MBID_OTHER);

    await postRemoval({ mbid: MBID_KEEP, removed: false });

    // Legacy unkeep must soft-remove: row survives with removedAt set.
    const del = await fetch(`${baseUrl}/api/me/keep/${MBID_OTHER}`, {
      method: "DELETE",
      headers: { cookie: `lore_sid=${SID}` },
    });
    expect(del.status).toBe(204);
    const [row] = await db
      .select({ removedAt: libraryItemsTable.removedAt })
      .from(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, userId!), eq(libraryItemsTable.mbid, MBID_OTHER)));
    expect(row).toBeDefined();
    expect(row!.removedAt).not.toBeNull();
    const after = await api(`/api/me/keep/status?mbids=${MBID_KEEP},${MBID_OTHER}`);
    expect(after.body.kept).not.toContain(MBID_OTHER);
    // Restore for later tests.
    await postRemoval({ mbid: MBID_OTHER, removed: false });
  }, 120_000);

  it("removes and restores soft rows via spotifyId, excluding soft-artist matching", async () => {
    if (!dbAvailable) return;
    const remove = await postRemoval({ spotifyId: SPOTIFY_ID, removed: true });
    expect(remove.status).toBe(200);
    expect(remove.body.removed).toBe(true);

    // Still listed, flagged removed.
    const list = await api("/api/me/library?limit=50");
    const softRow = list.body.items.find((i: any) => i.spotifyId === SPOTIFY_ID);
    expect(softRow).toBeTruthy();
    expect(softRow.removed).toBe(true);

    // Excluded from soft-artist hit matching…
    _testOnly_clearLibraryHitCache(userId!);
    const ctx = await buildLibraryHitContext(userId!);
    expect(ctx.softArtistNames.has(SOFT_ARTIST.toLowerCase())).toBe(false);

    // …and back after restore.
    const restore = await postRemoval({ spotifyId: SPOTIFY_ID, removed: false });
    expect(restore.status).toBe(200);
    _testOnly_clearLibraryHitCache(userId!);
    const ctx2 = await buildLibraryHitContext(userId!);
    expect(ctx2.softArtistNames.has(SOFT_ARTIST.toLowerCase())).toBe(true);
  });
});
