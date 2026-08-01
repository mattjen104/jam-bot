// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  spotifyLibraryItemsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  listEntriesTable,
  listsTable,
  listSourcesTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration tests for GET /api/me/library?source=critic
 *
 * The critic filter relies on an EXISTS subquery:
 *   recording_release_groups → list_entries (confidence='exact' OR confirmed=true)
 *
 * Seeds:
 *   - PRIMARY user with four items in their library:
 *       · MBID_CRITIC: recording linked to a release group that has a
 *         confirmed list entry (confidence='exact'). Must appear.
 *       · MBID_CONFIRMED: recording linked to a release group that has a
 *         fuzzy entry with confirmed=true. Must appear (confirmed=true path).
 *       · MBID_FUZZY: recording linked to a release group whose only list
 *         entry is fuzzy and NOT confirmed. Must NOT appear.
 *       · MBID_NONE: recording with NO release-group link at all.
 *         Must NOT appear.
 *   - A soft (unresolved) spotify_library_items row belonging to PRIMARY user.
 *     Must NOT appear because source=critic excludes soft rows.
 *   - EMPTY user with no library items → must get an empty list, not an error.
 *
 * All seeds are run-isolated. Cleaned up in FK order. Silently skips when no
 * DB is reachable.
 */

const run = randomUUID().slice(0, 8);

// ── Session IDs (doubled as deviceKey so the cookie resolves correctly) ────────
const SID       = `test-crit-${run}`;
const SID_EMPTY = `test-crit-empty-${run}`;

// ── Release groups ─────────────────────────────────────────────────────────────
const RG_EXACT     = `test-crit-rg-exact-${run}`;      // exact confidence → included
const RG_CONFIRMED = `test-crit-rg-confirmed-${run}`;  // fuzzy+confirmed  → included
const RG_FUZZY     = `test-crit-rg-fuzzy-${run}`;      // fuzzy, not confirmed → excluded

// ── Recordings ─────────────────────────────────────────────────────────────────
const MBID_CRITIC    = `test-crit-m-exact-${run}`;      // maps to RG_EXACT
const MBID_CONFIRMED = `test-crit-m-confirmed-${run}`;  // maps to RG_CONFIRMED
const MBID_FUZZY     = `test-crit-m-fuzzy-${run}`;      // maps to RG_FUZZY
const MBID_NONE      = `test-crit-m-none-${run}`;       // no release-group link

// ── DB IDs for cleanup ─────────────────────────────────────────────────────────
let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let userId: number | null = null;
let emptyUserId: number | null = null;
let sourceId: number | null = null;
let listId: number | null = null;
let softTableAvailable = false;

// ── Helpers ────────────────────────────────────────────────────────────────────
async function getLibrary(sid: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl}/api/me/library?${qs}`, {
    headers: { cookie: `lore_sid=${sid}` },
  });
  return { status: res.status, body: await res.json() };
}

// ── Setup ──────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Legacy spotify_connections rows required by lore_users FK.
  for (const sid of [SID, SID_EMPTY]) {
    await db.insert(spotifyConnectionsTable).values({
      sid,
      accessToken: "t",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  // Primary test user.
  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `crit-u-${run}`, spotifyConnectionId: SID, deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // Empty user — no library items, no critic coverage.
  const [uEmpty] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `crit-empty-${run}`, spotifyConnectionId: SID_EMPTY, deviceKey: SID_EMPTY })
    .returning({ id: loreUsersTable.id });
  emptyUserId = uEmpty!.id;

  // Recording spine rows.
  await db.insert(recordingsTable).values([
    { mbid: MBID_CRITIC,    title: "Critic Track",     artist: `Band ${run}` },
    { mbid: MBID_CONFIRMED, title: "Confirmed Track",  artist: `Band ${run}` },
    { mbid: MBID_FUZZY,     title: "Fuzzy Track",      artist: `Band ${run}` },
    { mbid: MBID_NONE,      title: "Unlinked Track",   artist: `Band ${run}` },
  ]);

  // Link recordings to release groups (MBID_NONE intentionally has no link).
  await db.insert(recordingReleaseGroupsTable).values([
    { recordingMbid: MBID_CRITIC,    releaseGroupMbid: RG_EXACT,     isPrimary: true,  title: `Album Exact ${run}`,     releaseYear: 2020 },
    { recordingMbid: MBID_CONFIRMED, releaseGroupMbid: RG_CONFIRMED, isPrimary: true,  title: `Album Confirmed ${run}`, releaseYear: 2021 },
    { recordingMbid: MBID_FUZZY,     releaseGroupMbid: RG_FUZZY,     isPrimary: true,  title: `Album Fuzzy ${run}`,     releaseYear: 2022 },
  ]);

  // Library items for the primary user.
  const base = Date.now();
  await db.insert(libraryItemsTable).values([
    { userId: userId!, mbid: MBID_CRITIC,    provenance: { kind: "keep" }, addedAt: new Date(base) },
    { userId: userId!, mbid: MBID_CONFIRMED, provenance: { kind: "keep" }, addedAt: new Date(base - 1000) },
    { userId: userId!, mbid: MBID_FUZZY,     provenance: { kind: "keep" }, addedAt: new Date(base - 2000) },
    { userId: userId!, mbid: MBID_NONE,      provenance: { kind: "keep" }, addedAt: new Date(base - 3000) },
  ]);

  // Soft (unresolved) row for the primary user — no mbid, should never appear
  // under source=critic.
  try {
    await db.insert(spotifyLibraryItemsTable).values({
      userId: userId!,
      spotifyId: `soft-crit-${run}`,
      title: "Soft Unresolved Track",
      artist: `Band ${run}`,
      addedAt: new Date(),
      // mbid intentionally absent
    });
    softTableAvailable = true;
  } catch {
    softTableAvailable = false;
  }

  // List source and list.
  const [src] = await db
    .insert(listSourcesTable)
    .values({ kind: "publication", name: `Critic Pub ${run}`, homepageUrl: "https://example.invalid" })
    .returning({ id: listSourcesTable.id });
  sourceId = src!.id;

  const [lst] = await db
    .insert(listsTable)
    .values({
      sourceId: sourceId!,
      title: `Best Of ${run}`,
      year: 2022,
      kind: "year_end",
      isRanked: true,
      url: `https://example.invalid/lists/${run}`,
    })
    .returning({ id: listsTable.id });
  listId = lst!.id;

  // List entries:
  //   · RG_EXACT     → confidence='exact', confirmed=false  → qualifies via confidence
  //   · RG_CONFIRMED → confidence='fuzzy', confirmed=true   → qualifies via confirmed
  //   · RG_FUZZY     → confidence='fuzzy', confirmed=false  → does NOT qualify
  await db.insert(listEntriesTable).values([
    {
      listId: listId!,
      releaseGroupMbid: RG_EXACT,
      rank: 1,
      confidence: "exact",
      confirmed: false,
      rawAlbum: `Album Exact ${run}`,
      rawArtist: `Band ${run}`,
    },
    {
      listId: listId!,
      releaseGroupMbid: RG_CONFIRMED,
      rank: 2,
      confidence: "fuzzy",
      confirmed: true,
      rawAlbum: `Album Confirmed ${run}`,
      rawArtist: `Band ${run}`,
    },
    {
      listId: listId!,
      releaseGroupMbid: RG_FUZZY,
      rank: 3,
      confidence: "fuzzy",
      confirmed: false,
      rawAlbum: `Album Fuzzy ${run}`,
      rawArtist: `Band ${run}`,
    },
  ]);

  // Start server.
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

// ── Teardown ───────────────────────────────────────────────────────────────────
afterAll(async () => {
  if (server) {
    // Force-close keep-alive connections so server.close() resolves promptly.
    (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((r) => server!.close(() => r()));
  }
  if (!dbAvailable) return;

  // FK order: entries → list → source; library_items before recordings.
  if (listId != null) {
    await db.delete(listEntriesTable).where(eq(listEntriesTable.listId, listId));
    await db.delete(listsTable).where(eq(listsTable.id, listId));
  }
  if (sourceId != null) {
    await db.delete(listSourcesTable).where(eq(listSourcesTable.id, sourceId));
  }
  if (softTableAvailable && userId != null) {
    await db.delete(spotifyLibraryItemsTable).where(eq(spotifyLibraryItemsTable.userId, userId));
  }
  for (const uid of [userId, emptyUserId]) {
    if (uid != null) {
      await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, uid));
      await db.delete(loreUsersTable).where(eq(loreUsersTable.id, uid));
    }
  }
  await db.delete(recordingReleaseGroupsTable).where(
    inArray(recordingReleaseGroupsTable.recordingMbid, [MBID_CRITIC, MBID_CONFIRMED, MBID_FUZZY]),
  );
  await db.delete(recordingsTable).where(
    inArray(recordingsTable.mbid, [MBID_CRITIC, MBID_CONFIRMED, MBID_FUZZY, MBID_NONE]),
  );
  for (const sid of [SID, SID_EMPTY]) {
    await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, sid));
  }
});

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("GET /api/me/library?source=critic", () => {
  it("returns 200 with an items array", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getLibrary(SID, { source: "critic" });
    expect(status).toBe(200);
    expect(body).toHaveProperty("items");
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("includes a track whose release group has confidence='exact'", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary(SID, { source: "critic" });
    const mbids = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(MBID_CRITIC);
  });

  it("includes a track whose release group entry has confirmed=true (even if fuzzy)", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary(SID, { source: "critic" });
    const mbids = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).toContain(MBID_CONFIRMED);
  });

  it("excludes a track whose release group has only a fuzzy unconfirmed entry", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary(SID, { source: "critic" });
    const mbids = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).not.toContain(MBID_FUZZY);
  });

  it("excludes a track with no release-group link at all", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary(SID, { source: "critic" });
    const mbids = body.items.map((i: { mbid: string }) => i.mbid);
    expect(mbids).not.toContain(MBID_NONE);
  });

  it("excludes soft (unresolved) rows even when they exist in the user's library", async () => {
    if (!dbAvailable || !softTableAvailable) return;
    const { body } = await getLibrary(SID, { source: "critic" });
    // Soft rows have no mbid — they are identified by title/artist. Confirm
    // none of the returned items match the seeded soft-row title.
    const titles = body.items.map((i: { title: string }) => i.title ?? "");
    expect(titles).not.toContain("Soft Unresolved Track");
    // Also confirm no item lacks an mbid (soft rows would have no mbid).
    for (const item of body.items) {
      expect(item.mbid).toBeTruthy();
    }
  });

  it("returns an empty list (not an error) when the user has no critic-covered tracks", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getLibrary(SID_EMPTY, { source: "critic" });
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    // Empty user has no library items, so the critic-filtered result is empty.
    const ours = body.items.filter((i: { mbid: string }) =>
      [MBID_CRITIC, MBID_CONFIRMED, MBID_FUZZY, MBID_NONE].includes(i.mbid),
    );
    expect(ours).toHaveLength(0);
  });

  it("only returns the two critic-covered tracks among ours, not all four", async () => {
    if (!dbAvailable) return;
    const { body } = await getLibrary(SID, { source: "critic" });
    const ourMbids = body.items
      .map((i: { mbid: string }) => i.mbid)
      .filter((m: string) => m.includes(run));
    // Only MBID_CRITIC (exact) and MBID_CONFIRMED (confirmed=true) should appear.
    expect(ourMbids.sort()).toEqual([MBID_CRITIC, MBID_CONFIRMED].sort());
  });
});
