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
  recordingsTable,
  recordingReleaseGroupsTable,
  listEntriesTable,
  listsTable,
  listSourcesTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration tests for GET /api/me/library/list-coverage.
 *
 * Seeds:
 *  - A user with two recordings from the SAME release group (album A) and one
 *    recording from a second release group (album B).
 *  - A list that contains album A with confidence='exact'.
 *  - The same list also contains album B with confidence='fuzzy' (not confirmed).
 *
 * Asserts:
 *  1. Album A appears exactly ONCE per list even though it was reached via two
 *     library recordings (deduplication works).
 *  2. Album B does NOT appear — fuzzy entries without confirmed=true are excluded.
 *  3. An unrelated user with no library items gets an empty response.
 *
 * All seeds are run-isolated (unique IDs per `run`). Cleaned up in FK order.
 * Silently skips when no DB is reachable.
 */

const run = randomUUID().slice(0, 8);

// ── session cookies ──────────────────────────────────────────────────────────
const SID = `test-lcov-${run}`;
const SID_OTHER = `test-lcov-other-${run}`;

// ── release groups ───────────────────────────────────────────────────────────
/** Album that has TWO recordings in the user's library (dedup target). */
const RG_ALBUM_A = `test-lcov-rg-a-${run}`;
/** Album only linked via a fuzzy list_entries row → must be excluded. */
const RG_ALBUM_B = `test-lcov-rg-b-${run}`;
/** Album linked via a fuzzy list_entries row with confirmed=true → must be included. */
const RG_ALBUM_C = `test-lcov-rg-c-${run}`;

// ── recordings ───────────────────────────────────────────────────────────────
/** First recording belonging to album A. */
const MBID_A1 = `test-lcov-a1-${run}`;
/** Second recording belonging to album A (same release group). */
const MBID_A2 = `test-lcov-a2-${run}`;
/** Recording belonging to album B (fuzzy entry — should not appear). */
const MBID_B = `test-lcov-b-${run}`;
/** Recording belonging to album C (fuzzy + confirmed=true — should appear). */
const MBID_C = `test-lcov-c-${run}`;

// ── DB row IDs for cleanup ───────────────────────────────────────────────────
let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let userId: number | null = null;
let otherUserId: number | null = null;
let sourceId: number | null = null;
let listId: number | null = null;

// ── helpers ──────────────────────────────────────────────────────────────────
async function getCoverage(sid: string) {
  const res = await fetch(`${baseUrl}/api/me/library/list-coverage`, {
    headers: { cookie: `lore_sid=${sid}` },
  });
  return { status: res.status, body: await res.json() };
}

// ── setup ────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Legacy spotify_connections rows (required by lore_users FK).
  for (const sid of [SID, SID_OTHER]) {
    await db.insert(spotifyConnectionsTable).values({
      sid,
      accessToken: "t",
      refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  // Primary test user (deviceKey = SID so the cookie resolves correctly).
  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `lcov-u-${run}`, spotifyConnectionId: SID, deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  // Unrelated user with an empty library.
  const [uOther] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `lcov-other-${run}`, spotifyConnectionId: SID_OTHER, deviceKey: SID_OTHER })
    .returning({ id: loreUsersTable.id });
  otherUserId = uOther!.id;

  // Recordings spine rows.
  await db.insert(recordingsTable).values([
    { mbid: MBID_A1, title: "Track One (Album A)", artist: `Artist ${run}` },
    { mbid: MBID_A2, title: "Track Two (Album A)", artist: `Artist ${run}` },
    { mbid: MBID_B,  title: "Track One (Album B)", artist: `Artist ${run}` },
    { mbid: MBID_C,  title: "Track One (Album C)", artist: `Artist ${run}` },
  ]);

  // Link both A-recordings to release group A, B-recording to release group B,
  // and C-recording to release group C.
  await db.insert(recordingReleaseGroupsTable).values([
    { recordingMbid: MBID_A1, releaseGroupMbid: RG_ALBUM_A, isPrimary: true,  title: `Album A ${run}`, releaseYear: 2020 },
    { recordingMbid: MBID_A2, releaseGroupMbid: RG_ALBUM_A, isPrimary: false, title: `Album A ${run}`, releaseYear: 2020 },
    { recordingMbid: MBID_B,  releaseGroupMbid: RG_ALBUM_B, isPrimary: true,  title: `Album B ${run}`, releaseYear: 2021 },
    { recordingMbid: MBID_C,  releaseGroupMbid: RG_ALBUM_C, isPrimary: true,  title: `Album C ${run}`, releaseYear: 2022 },
  ]);

  // Library: user owns both Album A recordings, the Album B recording, and the Album C recording.
  await db.insert(libraryItemsTable).values([
    { userId: userId!, mbid: MBID_A1, provenance: { kind: "keep" }, addedAt: new Date() },
    { userId: userId!, mbid: MBID_A2, provenance: { kind: "keep" }, addedAt: new Date() },
    { userId: userId!, mbid: MBID_B,  provenance: { kind: "keep" }, addedAt: new Date() },
    { userId: userId!, mbid: MBID_C,  provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // List source (publication).
  const [src] = await db
    .insert(listSourcesTable)
    .values({ kind: "publication", name: `Test Publication ${run}`, homepageUrl: "https://example.invalid" })
    .returning({ id: listSourcesTable.id });
  sourceId = src!.id;

  // A single list containing both albums.
  const [lst] = await db
    .insert(listsTable)
    .values({
      sourceId: sourceId!,
      title: `Best Albums ${run}`,
      year: 2020,
      kind: "year_end",
      isRanked: true,
      url: `https://example.invalid/lists/${run}`,
    })
    .returning({ id: listsTable.id });
  listId = lst!.id;

  // Album A → exact confidence (should appear).
  // Album B → fuzzy, not confirmed (should NOT appear).
  // Album C → fuzzy, confirmed=true (should appear — the regression case).
  await db.insert(listEntriesTable).values([
    {
      listId: listId!,
      releaseGroupMbid: RG_ALBUM_A,
      rank: 1,
      confidence: "exact",
      confirmed: false,
      rawAlbum: `Album A ${run}`,
      rawArtist: `Artist ${run}`,
      sourceUrl: `https://example.invalid/lists/${run}`,
      extraction: "manual",
    },
    {
      listId: listId!,
      releaseGroupMbid: RG_ALBUM_B,
      rank: 2,
      confidence: "fuzzy",
      confirmed: false,
      rawAlbum: `Album B ${run}`,
      rawArtist: `Artist ${run}`,
      sourceUrl: `https://example.invalid/lists/${run}`,
      extraction: "manual",
    },
    {
      listId: listId!,
      releaseGroupMbid: RG_ALBUM_C,
      rank: 3,
      confidence: "fuzzy",
      confirmed: true,
      rawAlbum: `Album C ${run}`,
      rawArtist: `Artist ${run}`,
      sourceUrl: `https://example.invalid/lists/${run}`,
      extraction: "manual",
    },
  ]);

  // Start server.
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

// ── teardown ─────────────────────────────────────────────────────────────────
afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  // FK order: entries → list → source; library_items before recordings.
  if (listId != null) {
    await db.delete(listEntriesTable).where(eq(listEntriesTable.listId, listId));
    await db.delete(listsTable).where(eq(listsTable.id, listId));
  }
  if (sourceId != null) {
    await db.delete(listSourcesTable).where(eq(listSourcesTable.id, sourceId));
  }
  for (const uid of [userId, otherUserId]) {
    if (uid != null) {
      await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, uid));
      await db.delete(loreUsersTable).where(eq(loreUsersTable.id, uid));
    }
  }
  await db.delete(recordingReleaseGroupsTable).where(
    inArray(recordingReleaseGroupsTable.recordingMbid, [MBID_A1, MBID_A2, MBID_B, MBID_C]),
  );
  await db.delete(recordingsTable).where(
    inArray(recordingsTable.mbid, [MBID_A1, MBID_A2, MBID_B, MBID_C]),
  );
  for (const sid of [SID, SID_OTHER]) {
    await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, sid));
  }
}, 90_000);

// ── tests ─────────────────────────────────────────────────────────────────────
describe("GET /api/me/library/list-coverage", () => {
  it("returns 200 with items array", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getCoverage(SID);
    expect(status).toBe(200);
    expect(body).toHaveProperty("items");
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("deduplicates — album reached via two recordings appears exactly once per list", async () => {
    if (!dbAvailable) return;
    const { body } = await getCoverage(SID);

    // Find the list entry seeded for this test run.
    const listEntry = body.items.find((i: { listId: number }) => i.listId === listId);
    expect(listEntry).toBeDefined();

    // Album A is linked by TWO recordings (MBID_A1 and MBID_A2) but must
    // appear only once in the albums array.
    const albumAEntries = listEntry.albums.filter(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_ALBUM_A,
    );
    expect(albumAEntries).toHaveLength(1);
  });

  it("excludes fuzzy-confidence entries that are not confirmed", async () => {
    if (!dbAvailable) return;
    const { body } = await getCoverage(SID);

    const listEntry = body.items.find((i: { listId: number }) => i.listId === listId);
    expect(listEntry).toBeDefined();

    // Album B has confidence='fuzzy' and confirmed=false — it must not appear.
    const albumBEntries = listEntry.albums.filter(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_ALBUM_B,
    );
    expect(albumBEntries).toHaveLength(0);
  });

  it("includes correct list metadata for the matched list", async () => {
    if (!dbAvailable) return;
    const { body } = await getCoverage(SID);

    const listEntry = body.items.find((i: { listId: number }) => i.listId === listId);
    expect(listEntry).toBeDefined();
    expect(listEntry.listTitle).toBe(`Best Albums ${run}`);
    expect(listEntry.listYear).toBe(2020);
    expect(listEntry.sourceName).toBe(`Test Publication ${run}`);
    expect(listEntry.isRanked).toBe(true);
  });

  it("album entry carries correct rank and release group mbid", async () => {
    if (!dbAvailable) return;
    const { body } = await getCoverage(SID);

    const listEntry = body.items.find((i: { listId: number }) => i.listId === listId);
    const albumA = listEntry?.albums.find(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_ALBUM_A,
    );
    expect(albumA).toBeDefined();
    expect(albumA.rank).toBe(1);
    expect(albumA.releaseGroupMbid).toBe(RG_ALBUM_A);
  });

  it("returns empty items for a user with no library items", async () => {
    if (!dbAvailable) return;
    const { status, body } = await getCoverage(SID_OTHER);
    expect(status).toBe(200);
    // The other user's library is empty so no seeded lists should appear.
    const ourList = body.items.find((i: { listId: number }) => i.listId === listId);
    expect(ourList).toBeUndefined();
  });

  it("includes a fuzzy entry once confirmed=true is set", async () => {
    if (!dbAvailable) return;
    const { body } = await getCoverage(SID);

    const listEntry = body.items.find((i: { listId: number }) => i.listId === listId);
    expect(listEntry).toBeDefined();

    // Album C has confidence='fuzzy' but confirmed=true — it must appear exactly once.
    const albumCEntries = listEntry.albums.filter(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_ALBUM_C,
    );
    expect(albumCEntries).toHaveLength(1);
    expect(albumCEntries[0].rank).toBe(3);
    expect(albumCEntries[0].releaseGroupMbid).toBe(RG_ALBUM_C);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: one recording → two release groups (one listed, one not)
//
// A recording can be linked to multiple release groups (e.g. original album +
// compilation). The JOIN from library_items → recording_release_groups fans out
// one library row into two candidate rows. Only the RG that has an
// exact/confirmed list_entries row should appear in coverage; the unlisted RG
// must be silently dropped by the INNER JOIN and never surface as a phantom
// album in the response.
// ─────────────────────────────────────────────────────────────────────────────

const run2 = randomUUID().slice(0, 8);

const SID_MULTI = `test-lcov-multi-${run2}`;

/** The one recording that belongs to both release groups. */
const MBID_MULTI = `test-lcov-multi-rec-${run2}`;
/** Release group that IS on a list (exact confidence). */
const RG_LISTED = `test-lcov-rg-listed-${run2}`;
/** Release group that is NOT on any list. */
const RG_UNLISTED = `test-lcov-rg-unlisted-${run2}`;

let dbAvailable2 = false;
let server2: Server | undefined;
let baseUrl2 = "";
let userId2: number | null = null;
let sourceId2: number | null = null;
let listId2: number | null = null;

async function getCoverage2(sid: string) {
  const res = await fetch(`${baseUrl2}/api/me/library/list-coverage`, {
    headers: { cookie: `lore_sid=${sid}` },
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable2 = true;
  } catch {
    return;
  }

  await db.insert(spotifyConnectionsTable).values({
    sid: SID_MULTI,
    accessToken: "t",
    refreshToken: "r",
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `lcov-multi-u-${run2}`, spotifyConnectionId: SID_MULTI, deviceKey: SID_MULTI })
    .returning({ id: loreUsersTable.id });
  userId2 = u!.id;

  // One recording linked to TWO release groups.
  await db.insert(recordingsTable).values([
    { mbid: MBID_MULTI, title: `Multi-RG Track ${run2}`, artist: `Artist ${run2}` },
  ]);
  await db.insert(recordingReleaseGroupsTable).values([
    { recordingMbid: MBID_MULTI, releaseGroupMbid: RG_LISTED,   isPrimary: true,  title: `Listed Album ${run2}`,   releaseYear: 2019 },
    { recordingMbid: MBID_MULTI, releaseGroupMbid: RG_UNLISTED, isPrimary: false, title: `Unlisted Album ${run2}`, releaseYear: 2022 },
  ]);

  // Library: the user owns the single recording.
  await db.insert(libraryItemsTable).values([
    { userId: userId2!, mbid: MBID_MULTI, provenance: { kind: "keep" }, addedAt: new Date() },
  ]);

  // List that contains ONLY the listed release group.
  const [src] = await db
    .insert(listSourcesTable)
    .values({ kind: "publication", name: `Test Pub Multi ${run2}`, homepageUrl: "https://example.invalid" })
    .returning({ id: listSourcesTable.id });
  sourceId2 = src!.id;

  const [lst] = await db
    .insert(listsTable)
    .values({
      sourceId: sourceId2!,
      title: `Multi RG List ${run2}`,
      year: 2019,
      kind: "year_end",
      isRanked: true,
      url: `https://example.invalid/lists/multi-${run2}`,
    })
    .returning({ id: listsTable.id });
  listId2 = lst!.id;

  // Only RG_LISTED has a list entry; RG_UNLISTED has none.
  await db.insert(listEntriesTable).values([
    {
      listId: listId2!,
      releaseGroupMbid: RG_LISTED,
      rank: 1,
      confidence: "exact",
      confirmed: false,
      rawAlbum: `Listed Album ${run2}`,
      rawArtist: `Artist ${run2}`,
      sourceUrl: `https://example.invalid/lists/multi-${run2}`,
      extraction: "manual",
    },
  ]);

  server2 = app.listen(0);
  await new Promise<void>((resolve) => server2!.once("listening", resolve));
  const addr = server2.address();
  if (addr && typeof addr === "object") baseUrl2 = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server2) await new Promise<void>((r) => server2!.close(() => r()));
  if (!dbAvailable2) return;

  if (listId2 != null) {
    await db.delete(listEntriesTable).where(eq(listEntriesTable.listId, listId2));
    await db.delete(listsTable).where(eq(listsTable.id, listId2));
  }
  if (sourceId2 != null) {
    await db.delete(listSourcesTable).where(eq(listSourcesTable.id, sourceId2));
  }
  if (userId2 != null) {
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId2));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId2));
  }
  await db.delete(recordingReleaseGroupsTable).where(
    inArray(recordingReleaseGroupsTable.recordingMbid, [MBID_MULTI]),
  );
  await db.delete(recordingsTable).where(
    inArray(recordingsTable.mbid, [MBID_MULTI]),
  );
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID_MULTI));
});

describe("GET /api/me/library/list-coverage — one recording, two release groups", () => {
  it("returns 200 with items array", async () => {
    if (!dbAvailable2) return;
    const { status, body } = await getCoverage2(SID_MULTI);
    expect(status).toBe(200);
    expect(body).toHaveProperty("items");
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("only the listed release group appears — unlisted RG is not surfaced", async () => {
    if (!dbAvailable2) return;
    const { body } = await getCoverage2(SID_MULTI);

    const listEntry = body.items.find((i: { listId: number }) => i.listId === listId2);
    expect(listEntry).toBeDefined();

    // RG_LISTED has an exact list_entries row → must be present.
    const listedAlbums = listEntry.albums.filter(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_LISTED,
    );
    expect(listedAlbums).toHaveLength(1);

    // RG_UNLISTED has no list_entries row → must not appear even though
    // the same recording is linked to it in recording_release_groups.
    const unlistedAlbums = listEntry.albums.filter(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_UNLISTED,
    );
    expect(unlistedAlbums).toHaveLength(0);
  });

  it("the listed release group appears exactly once despite the multi-RG fanout", async () => {
    if (!dbAvailable2) return;
    const { body } = await getCoverage2(SID_MULTI);

    // Collect every album across all list entries in the response.
    const allAlbums: { releaseGroupMbid: string }[] = body.items.flatMap(
      (i: { albums: { releaseGroupMbid: string }[] }) => i.albums,
    );

    const listedOccurrences = allAlbums.filter(
      (a) => a.releaseGroupMbid === RG_LISTED,
    );
    expect(listedOccurrences).toHaveLength(1);
  });

  it("the listed album carries correct metadata", async () => {
    if (!dbAvailable2) return;
    const { body } = await getCoverage2(SID_MULTI);

    const listEntry = body.items.find((i: { listId: number }) => i.listId === listId2);
    const album = listEntry?.albums.find(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === RG_LISTED,
    );
    expect(album).toBeDefined();
    expect(album.rank).toBe(1);
    expect(album.releaseYear).toBe(2019);
  });
});
