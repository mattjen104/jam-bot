// @vitest-environment node
/**
 * Integration tests for GET /api/me/press-crossings — the Dial's Press lens.
 *
 * Covered:
 *   1. Pick mentions — library artist MBID match AND soft-name matches
 *      (taste seeds, unresolved Spotify artists). DJ-spin picks are excluded.
 *   2. List-entry mentions — release-group widening against library_items;
 *      unconfirmed fuzzy entries are excluded.
 *   3. Track-claim mentions — exact recording MBID; draft claims excluded.
 *   4. Ordering — newest occurredAt first, undated last.
 *   5. Pagination — cursor walks the full set without duplicates.
 *   6. Empty taste — hasTaste:false plus empty items (settled, not computing).
 *   7. Cache busting — a Stack change (bustCrossingsCache) clears Press too.
 *
 * All seeds use a run-isolated prefix; cleanup in FK order; tests skip
 * silently when no DB is reachable.
 */
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
  tasteSeedsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  picksTable,
  pickersTable,
  listsTable,
  listSourcesTable,
  listEntriesTable,
  trackClaimsTable,
} from "@workspace/db";
import app from "../src/app.js";
import { bustPressCache, _testOnly_hasPressCache } from "../src/routes/me/press-crossings.js";
import { bustCrossingsCache } from "../src/routes/me/crossings.js";

const run = randomUUID().slice(0, 8);

// ── Session ids ───────────────────────────────────────────────────────────────
const SID_FULL  = `test-press-full-${run}`;  // library + seeds + soft artists
const SID_EMPTY = `test-press-empty-${run}`; // no taste at all
const SID_QUIET = `test-press-quiet-${run}`; // taste but zero mentions

// ── Spine fixtures ────────────────────────────────────────────────────────────
const ARTIST_MBID   = `tp-artist-${run}`;
const MBID_LIB      = `tp-lib-${run}`;        // library recording (artist resolved)
const MBID_CLAIM    = `tp-claim-${run}`;      // library recording with a published claim
const MBID_QUIET    = `tp-quiet-${run}`;      // quiet user's library recording
const RG_MBID       = `tp-rg-${run}`;         // library release group (list entry target)
const SEED_ARTIST   = `Press Seed Artist ${run}`;
const SOFT_ARTIST   = `Press Soft Artist ${run}`;

let server: Server;
let baseUrl: string;
let dbAvailable = false;
let userFullId: number | null = null;
let userQuietId: number | null = null;
let pickerId: number | null = null;
let djPickerId: number | null = null;
let listSourceId: number | null = null;
let listId: number | null = null;

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

  for (const sid of [SID_FULL, SID_EMPTY, SID_QUIET]) {
    await db.insert(spotifyConnectionsTable).values({
      sid, accessToken: "t", refreshToken: "r",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }
  const [uFull] = await db.insert(loreUsersTable)
    .values({ spotifyUserId: `press-full-${run}`, spotifyConnectionId: SID_FULL, deviceKey: SID_FULL })
    .returning({ id: loreUsersTable.id });
  userFullId = uFull!.id;
  const [uQuiet] = await db.insert(loreUsersTable)
    .values({ spotifyUserId: `press-quiet-${run}`, spotifyConnectionId: SID_QUIET, deviceKey: SID_QUIET })
    .returning({ id: loreUsersTable.id });
  userQuietId = uQuiet!.id;
  await db.insert(loreUsersTable)
    .values({ spotifyUserId: `press-empty-${run}`, spotifyConnectionId: SID_EMPTY, deviceKey: SID_EMPTY });

  // Recordings + release-group bridge
  await db.insert(recordingsTable).values([
    { mbid: MBID_LIB,   title: "Press Lib Track",   artist: `Press Artist ${run}`, artistMbid: ARTIST_MBID },
    { mbid: MBID_CLAIM, title: "Press Claim Track", artist: `Press Claim Artist ${run}` },
    { mbid: MBID_QUIET, title: "Press Quiet Track", artist: `Quiet Artist ${run}` },
  ]);
  await db.insert(recordingReleaseGroupsTable).values({
    recordingMbid: MBID_LIB, releaseGroupMbid: RG_MBID, primary: true,
  });

  // Full user's taste: library items + a taste seed + an unresolved soft artist
  await db.insert(libraryItemsTable).values([
    { userId: userFullId!, mbid: MBID_LIB, provenance: { kind: "keep" } },
    { userId: userFullId!, mbid: MBID_CLAIM, provenance: { kind: "keep" } },
  ]);
  await db.insert(tasteSeedsTable).values({ userId: userFullId!, artistName: SEED_ARTIST });
  await db.insert(spotifyLibraryItemsTable).values({
    userId: userFullId!, spotifyId: `sp-press-${run}`, title: "Soft Track", artist: SOFT_ARTIST,
  });

  // Quiet user: taste (library item) but no mentions reference it
  await db.insert(libraryItemsTable).values({ userId: userQuietId!, mbid: MBID_QUIET, provenance: { kind: "keep" } });

  // Pickers — one blog, one DJ (DJ picks must be excluded from Press)
  const [pk] = await db.insert(pickersTable)
    .values({ pickerType: "blog", name: `Press Blog ${run}`, handle: `press-blog-${run}` })
    .returning({ id: pickersTable.id });
  pickerId = pk!.id;
  const [djPk] = await db.insert(pickersTable)
    .values({ pickerType: "dj", name: `Press DJ ${run}`, handle: `press-dj-${run}` })
    .returning({ id: pickersTable.id });
  djPickerId = djPk!.id;

  // Picks:
  //  a) resolved artistMbid match (library artist)      — dated 2 days ago
  //  b) soft-name match on the taste seed               — dated 10 days ago
  //  c) soft-name match on the unresolved Spotify artist — dated 30 days ago
  //  d) DJ pick for the same artist — must NOT appear
  const day = 24 * 60 * 60 * 1000;
  await db.insert(picksTable).values([
    {
      pickerId: pickerId!, source: "blog_post", rawArtist: `Press Artist ${run}`,
      artistMbid: ARTIST_MBID, context: `New single review`, confidence: "text",
      sourceUrl: `https://blog.example/${run}/a`, pickedAt: new Date(Date.now() - 2 * day),
    },
    {
      pickerId: pickerId!, source: "blog_post", rawArtist: SEED_ARTIST,
      context: `Seed artist profile`, confidence: "unresolved",
      sourceUrl: `https://blog.example/${run}/b`, pickedAt: new Date(Date.now() - 10 * day),
    },
    {
      pickerId: pickerId!, source: "blog_post", rawArtist: `The ${SOFT_ARTIST}!`, // normalization: article + punct
      context: `Soft artist writeup`, confidence: "unresolved",
      sourceUrl: `https://blog.example/${run}/c`, pickedAt: new Date(Date.now() - 30 * day),
    },
    {
      pickerId: djPickerId!, source: "spin", rawArtist: `Press Artist ${run}`,
      artistMbid: ARTIST_MBID, confidence: "text",
      sourceUrl: `https://station.example/${run}`, pickedAt: new Date(Date.now() - 1 * day),
    },
  ]);

  // List entry: release-group match, exact confidence — plus an unconfirmed
  // fuzzy sibling that must be excluded.
  const [ls] = await db.insert(listSourcesTable)
    .values({ kind: "publication", name: `Press Zine ${run}` })
    .returning({ id: listSourcesTable.id });
  listSourceId = ls!.id;
  const [l] = await db.insert(listsTable)
    .values({ sourceId: listSourceId!, title: `Best Albums ${run}`, year: 2024, kind: "year_end", url: `https://zine.example/${run}` })
    .returning({ id: listsTable.id });
  listId = l!.id;
  await db.insert(listEntriesTable).values([
    {
      listId: listId!, releaseGroupMbid: RG_MBID, rank: 3,
      rawArtist: `Press Artist ${run}`, rawAlbum: `Press Album ${run}`,
      confidence: "exact", sourceUrl: `https://zine.example/${run}/best`, extraction: "manual",
    },
    {
      listId: listId!, releaseGroupMbid: `${RG_MBID}-fuzzy`,
      rawArtist: `Press Artist ${run}`, rawAlbum: `Fuzzy Album ${run}`,
      confidence: "fuzzy", confirmed: false,
      sourceUrl: `https://zine.example/${run}/best`, extraction: "llm",
    },
  ]);
  // The fuzzy entry's RG must also be in the user's library for the exclusion
  // test to be meaningful.
  await db.insert(recordingReleaseGroupsTable).values({
    recordingMbid: MBID_LIB, releaseGroupMbid: `${RG_MBID}-fuzzy`, primary: false,
  });

  // Track claims: one published (should appear), one draft (must not).
  await db.insert(trackClaimsTable).values([
    {
      mbid: MBID_CLAIM, status: "published", text: `A press-worthy fact about this track (${run}).`,
      sourceLabel: `Classic Albums: Press ${run}`, sourceUrl: `https://youtube.example/${run}?t=1`,
      sourceHandle: "classic-albums", externalId: `tp:${run}:1`,
    },
    {
      mbid: MBID_CLAIM, status: "draft", text: `A draft fact (${run}).`,
      sourceLabel: `Wikipedia`, sourceUrl: `https://wikipedia.example/${run}`,
      sourceHandle: "wikipedia", externalId: `tp:${run}:2`,
    },
  ]);

  server = app.listen(0);
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 120_000);

afterAll(async () => {
  if (!dbAvailable) return;
  server?.close();
  // FK order: claims/picks/list entries → lists → sources/pickers → taste → users
  await db.delete(trackClaimsTable).where(inArray(trackClaimsTable.externalId, [`tp:${run}:1`, `tp:${run}:2`]));
  if (pickerId) await db.delete(picksTable).where(eq(picksTable.pickerId, pickerId));
  if (djPickerId) await db.delete(picksTable).where(eq(picksTable.pickerId, djPickerId));
  if (listId) await db.delete(listEntriesTable).where(eq(listEntriesTable.listId, listId));
  if (listId) await db.delete(listsTable).where(eq(listsTable.id, listId));
  if (listSourceId) await db.delete(listSourcesTable).where(eq(listSourcesTable.id, listSourceId));
  if (pickerId) await db.delete(pickersTable).where(eq(pickersTable.id, pickerId));
  if (djPickerId) await db.delete(pickersTable).where(eq(pickersTable.id, djPickerId));
  for (const uid of [userFullId, userQuietId]) {
    if (uid == null) continue;
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, uid));
    await db.delete(spotifyLibraryItemsTable).where(eq(spotifyLibraryItemsTable.userId, uid));
    await db.delete(tasteSeedsTable).where(eq(tasteSeedsTable.userId, uid));
  }
  await db.delete(recordingReleaseGroupsTable).where(eq(recordingReleaseGroupsTable.recordingMbid, MBID_LIB));
  await db.delete(loreUsersTable).where(inArray(loreUsersTable.deviceKey, [SID_FULL, SID_EMPTY, SID_QUIET]));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID_LIB, MBID_CLAIM, MBID_QUIET]));
  await db.delete(spotifyConnectionsTable).where(inArray(spotifyConnectionsTable.sid, [SID_FULL, SID_EMPTY, SID_QUIET]));
}, 120_000);

describe("GET /api/me/press-crossings", () => {
  it("crosses every taste source against every mention table", async () => {
    if (!dbAvailable) return;
    bustPressCache(userFullId!);
    const { status, body } = await get("/api/me/press-crossings", SID_FULL);
    expect(status).toBe(200);
    expect(body.hasTaste).toBe(true);
    expect(body.computing).toBe(false);
    expect(body.failed).toBe(false);

    const ids = body.items.map((m: { id: string }) => m.id);
    const kinds = new Set(body.items.map((m: { kind: string }) => m.kind));
    // All three mention kinds present
    expect(kinds).toContain("pick");
    expect(kinds).toContain("list_entry");
    expect(kinds).toContain("track_claim");

    // a) resolved-artist pick, b) seed-name pick, c) soft-Spotify pick
    const pickArtists = body.items
      .filter((m: { kind: string }) => m.kind === "pick")
      .map((m: { artistName: string | null }) => m.artistName);
    expect(pickArtists).toContain(`Press Artist ${run}`);
    expect(pickArtists).toContain(SEED_ARTIST);
    expect(pickArtists).toContain(`The ${SOFT_ARTIST}!`);

    // DJ spin pick excluded
    const djMention = body.items.find(
      (m: { kind: string; sourceLabel: string }) => m.kind === "pick" && m.sourceLabel.includes(`Press DJ ${run}`),
    );
    expect(djMention).toBeUndefined();

    // List entry: exact one in, fuzzy-unconfirmed one out
    const listMentions = body.items.filter((m: { kind: string }) => m.kind === "list_entry");
    expect(listMentions).toHaveLength(1);
    expect(listMentions[0].context).toContain(`Press Album ${run}`);

    // Track claim: published in, draft out
    const claims = body.items.filter((m: { kind: string }) => m.kind === "track_claim");
    expect(claims).toHaveLength(1);
    expect(claims[0].sourceLabel).toBe(`Classic Albums: Press ${run}`);
    expect(claims[0].sourceUrl).toContain("youtube.example");

    expect(new Set(ids).size).toBe(ids.length); // no duplicate rows
  });

  it("orders mentions newest-first with undated last", async () => {
    if (!dbAvailable) return;
    const { body } = await get("/api/me/press-crossings", SID_FULL);
    const dates = body.items.map((m: { occurredAt: string | null }) => m.occurredAt);
    const dated = dates.filter((d: string | null): d is string => d != null);
    const sorted = [...dated].sort((a, b) => b.localeCompare(a));
    expect(dated).toEqual(sorted);
    // No undated fixture rows sort before dated ones
    const firstNull = dates.indexOf(null);
    if (firstNull !== -1) {
      expect(dates.slice(firstNull).every((d: string | null) => d == null)).toBe(true);
    }
  });

  it("paginates by cursor without duplicates or gaps", async () => {
    if (!dbAvailable) return;
    const first = await get("/api/me/press-crossings", SID_FULL);
    const all: string[] = first.body.items.map((m: { id: string }) => m.id);
    let cursor = first.body.nextCursor;
    let hops = 0;
    while (cursor && hops < 10) {
      const next = await get(`/api/me/press-crossings?cursor=${encodeURIComponent(cursor)}`, SID_FULL);
      expect(next.status).toBe(200);
      for (const m of next.body.items) all.push(m.id);
      cursor = next.body.nextCursor;
      hops++;
    }
    expect(new Set(all).size).toBe(all.length);
    // Our fixture set is small (< one page) so nextCursor should be null.
    expect(first.body.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor", async () => {
    if (!dbAvailable) return;
    const { status } = await get("/api/me/press-crossings?cursor=%25%25not-base64", SID_FULL);
    expect(status).toBe(400);
  });

  it("empty taste → hasTaste:false, settled (not computing)", async () => {
    if (!dbAvailable) return;
    const { status, body } = await get("/api/me/press-crossings", SID_EMPTY);
    expect(status).toBe(200);
    expect(body.hasTaste).toBe(false);
    expect(body.items).toEqual([]);
    expect(body.computing).toBe(false);
    expect(body.failed).toBe(false);
  });

  it("taste with no mentions → settled empty with hasTaste:true", async () => {
    if (!dbAvailable) return;
    bustPressCache(userQuietId!);
    const { status, body } = await get("/api/me/press-crossings", SID_QUIET);
    expect(status).toBe(200);
    expect(body.hasTaste).toBe(true);
    expect(body.items).toEqual([]);
    expect(body.computing).toBe(false);
    expect(body.failed).toBe(false);
  });

  it("bustCrossingsCache clears the Press cache too (Stack change busts both lenses)", async () => {
    if (!dbAvailable) return;
    await get("/api/me/press-crossings", SID_FULL); // warm
    expect(_testOnly_hasPressCache(userFullId!)).toBe(true);
    await bustCrossingsCache(userFullId!);
    expect(_testOnly_hasPressCache(userFullId!)).toBe(false);
  });
});
