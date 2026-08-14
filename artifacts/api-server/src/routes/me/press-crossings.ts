/**
 * GET /api/me/press-crossings — "Press" lens: the listener's taste set crossed
 * against the scraped-metadata layer (picks, list entries, track claims).
 *
 * Returns one row per mention with artist, source kind/name, context, source
 * URL, and occurred-at date, newest-first with cursor pagination.
 *
 * Taste sources matched:
 *   - library_items (resolved MBIDs via recording → artistMbid)
 *   - taste_seeds (soft artist name match)
 *   - spotify_library_items with null mbid (soft artist name match)
 *
 * Mention tables queried:
 *   1. picks (blog posts, curated lists, etc.) via artistMbid or soft name
 *   2. list_entries (year-end / best-of lists) via release-group widening
 *   3. track_claims (published) via recording MBID
 *
 * Cache: in-process Map, 15-minute TTL (shorter than radio crossings because
 * the scrape layer changes more slowly and users rarely check Press twice in a
 * session). Empty results use a 2-min TTL to avoid locking a taste-less user
 * out of future mentions. Cache is busted by the same bustCrossingsCache()
 * call that clears the radio crossings cache.
 *
 * Pagination: cursor is `id:occurred_at` — stable across re-sorts and
 * survives cache hits.
 */

import { Router, type IRouter } from "express";
import {
  db,
  libraryItemsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  spotifyLibraryItemsTable,
  tasteSeedsTable,
  picksTable,
  pickersTable,
  listEntriesTable,
  listsTable,
  listSourcesTable,
  trackClaimsTable,
} from "@workspace/db";
import { eq, and, isNull, isNotNull, ne, sql, or } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const PRESS_CACHE_TTL_MS = 15 * 60 * 1000;
const PRESS_EMPTY_CACHE_TTL_MS = 2 * 60 * 1000;
const PAGE_SIZE = 30;

export interface PressMention {
  /** Stable cursor id within this mention's table (globally unique via kind prefix). */
  id: string;
  artistName: string | null;
  /** "pick" | "list_entry" | "track_claim" */
  kind: "pick" | "list_entry" | "track_claim";
  /** Human-readable source label, e.g. "Pitchfork", "The Wire Best Albums 2023". */
  sourceLabel: string;
  /** Optional release/album context (album title, list title, list rank, etc.). */
  context: string | null;
  /** URL of the source page for this mention. */
  sourceUrl: string | null;
  /** When the mention was published/occurred; null if undated. */
  occurredAt: string | null;
}

type CacheEntry = { builtAt: number; data: PressMention[] };
const pressCache = new Map<number, CacheEntry>();

function pressCacheTtl(data: PressMention[]): number {
  return data.length === 0 ? PRESS_EMPTY_CACHE_TTL_MS : PRESS_CACHE_TTL_MS;
}

/** Evict a user's press cache. Called by bustCrossingsCache and tests. */
export function bustPressCache(userId: number): void {
  pressCache.delete(userId);
}

/** Test-only: clear cache for isolation. */
export function _testOnly_clearPressCache(userId: number): void {
  pressCache.delete(userId);
}

/** Test-only: check for cache hit. */
export function _testOnly_hasPressCache(userId: number): boolean {
  const e = pressCache.get(userId);
  return e !== undefined && Date.now() - e.builtAt < pressCacheTtl(e.data);
}

// ---------------------------------------------------------------------------
// Artist-name normalization — mirrors crossings.ts exactly
// ---------------------------------------------------------------------------

function normArtistNameSql(col: unknown): ReturnType<typeof sql> {
  return sql`nullif(regexp_replace(regexp_replace(lower(${col}), '^the[[:space:]]+', ''), '[[:space:][:punct:]]+', '', 'g'), '')`;
}

// ---------------------------------------------------------------------------
// Taste set subqueries (reused across all three mention sources)
// ---------------------------------------------------------------------------

function buildTasteSubqueries(userId: number) {
  // Library artist MBIDs
  const userLibArtists = db
    .selectDistinct({ artistMbid: recordingsTable.artistMbid })
    .from(recordingsTable)
    .innerJoin(libraryItemsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
    .where(
      and(
        eq(libraryItemsTable.userId, userId),
        isNull(libraryItemsTable.removedAt),
        isNotNull(recordingsTable.artistMbid),
      ),
    );

  // Library release-group MBIDs (for list-entry matching)
  const userLibRgs = db
    .selectDistinct({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
    .from(recordingReleaseGroupsTable)
    .innerJoin(libraryItemsTable, eq(recordingReleaseGroupsTable.recordingMbid, libraryItemsTable.mbid))
    .where(and(eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt)));

  // Library recording MBIDs (for track-claim matching)
  const userLibMbids = db
    .selectDistinct({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(and(eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt)));

  // Soft artist names (unresolved Spotify imports)
  const userSoftArtists = db
    .selectDistinct({ artistNorm: sql<string>`${normArtistNameSql(spotifyLibraryItemsTable.artist)}` })
    .from(spotifyLibraryItemsTable)
    .where(
      and(
        eq(spotifyLibraryItemsTable.userId, userId),
        isNull(spotifyLibraryItemsTable.mbid),
        isNull(spotifyLibraryItemsTable.removedAt),
        ne(spotifyLibraryItemsTable.artist, ""),
      ),
    );

  // Taste seed soft names
  const userSeedArtists = db
    .selectDistinct({ artistNorm: sql<string>`${normArtistNameSql(tasteSeedsTable.artistName)}` })
    .from(tasteSeedsTable)
    .where(eq(tasteSeedsTable.userId, userId));

  return { userLibArtists, userLibRgs, userLibMbids, userSoftArtists, userSeedArtists };
}

// ---------------------------------------------------------------------------
// Full compute
// ---------------------------------------------------------------------------

async function computePressMentions(userId: number): Promise<PressMention[]> {
  const { userLibArtists, userLibRgs, userLibMbids, userSoftArtists, userSeedArtists } =
    buildTasteSubqueries(userId);

  const WINDOW_DAYS = 365 * 5; // 5-year window on the mention date (picks may be older)
  const windowCutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Artist match predicate shared by picks
  const artistMatchSql = sql`(
    ${picksTable.artistMbid} in (${userLibArtists})
    or ${normArtistNameSql(picksTable.rawArtist)} in (${userSoftArtists})
    or ${normArtistNameSql(picksTable.rawArtist)} in (${userSeedArtists})
  )`;

  const [pickRows, listRows, claimRows] = await Promise.all([
    // ── Source 1: picks ─────────────────────────────────────────────────────
    // Match by artistMbid (resolved) OR soft artist name (unresolved seeds/imports).
    // Picks with no artist (pickedAt null and no mbid) are omitted — they can't
    // produce a useful Press sentence.
    db
      .select({
        id: picksTable.id,
        rawArtist: picksTable.rawArtist,
        context: picksTable.context,
        sourceUrl: picksTable.sourceUrl,
        pickedAt: picksTable.pickedAt,
        pickerName: pickersTable.name,
        pickerType: pickersTable.pickerType,
        source: picksTable.source,
      })
      .from(picksTable)
      .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
      .where(
        and(
          isNotNull(picksTable.rawArtist),
          sql`(${picksTable.pickedAt} is null or ${picksTable.pickedAt} >= ${windowCutoff})`,
          artistMatchSql,
        ),
      )
      .orderBy(sql`${picksTable.pickedAt} desc nulls last`)
      .limit(200),

    // ── Source 2: list_entries ───────────────────────────────────────────────
    // Match via release-group widening against the user's library_items.
    // Only confirmed or exact-confidence entries participate.
    db
      .select({
        id: listEntriesTable.id,
        rawArtist: listEntriesTable.rawArtist,
        rawAlbum: listEntriesTable.rawAlbum,
        rank: listEntriesTable.rank,
        sourceUrl: listEntriesTable.sourceUrl,
        listTitle: listsTable.title,
        listYear: listsTable.year,
        listKind: listsTable.kind,
        sourceName: listSourcesTable.name,
        listUrl: listsTable.url,
        scrapedAt: listEntriesTable.scrapedAt,
      })
      .from(listEntriesTable)
      .innerJoin(listsTable, eq(listEntriesTable.listId, listsTable.id))
      .innerJoin(listSourcesTable, eq(listsTable.sourceId, listSourcesTable.id))
      .where(
        and(
          or(
            eq(listEntriesTable.confidence, "exact"),
            eq(listEntriesTable.confirmed, true),
          ),
          sql`${listEntriesTable.releaseGroupMbid} in (${userLibRgs})`,
        ),
      )
      .orderBy(sql`${listsTable.year} desc nulls last, ${listEntriesTable.rank} asc nulls last`)
      .limit(200),

    // ── Source 3: track_claims (published only) ─────────────────────────────
    // Match by exact recording MBID in the user's library_items. Joins
    // recordings so the Press sentence can lead with the artist.
    db
      .select({
        id: trackClaimsTable.id,
        mbid: trackClaimsTable.mbid,
        sourceLabel: trackClaimsTable.sourceLabel,
        sourceUrl: trackClaimsTable.sourceUrl,
        text: trackClaimsTable.text,
        createdAt: trackClaimsTable.createdAt,
        artist: recordingsTable.artist,
      })
      .from(trackClaimsTable)
      .innerJoin(recordingsTable, eq(trackClaimsTable.mbid, recordingsTable.mbid))
      .where(
        and(
          eq(trackClaimsTable.status, "published"),
          sql`${trackClaimsTable.mbid} in (${userLibMbids})`,
        ),
      )
      .orderBy(sql`${trackClaimsTable.createdAt} desc`)
      .limit(200),
  ]);

  const mentions: PressMention[] = [];

  // Picks → PressMention
  for (const row of pickRows) {
    // Skip DJ spins — they are the Radio lens, not Press
    if (row.pickerType === "dj" || row.source === "spin") continue;
    const label = row.source === "blog_post"
      ? row.pickerName
      : row.source === "curator_list" || row.source === "discogs_list"
        ? `${row.pickerName} · ${row.context ?? "list"}`
        : row.pickerName;
    mentions.push({
      id: `pick:${row.id}`,
      artistName: row.rawArtist ?? null,
      kind: "pick",
      sourceLabel: label,
      context: row.context ?? null,
      sourceUrl: row.sourceUrl ?? null,
      occurredAt: row.pickedAt?.toISOString() ?? null,
    });
  }

  // List entries → PressMention
  for (const row of listRows) {
    const rankStr = row.rank != null ? `#${row.rank} on ` : "Listed on ";
    const yearStr = row.listYear != null ? ` (${row.listYear})` : "";
    const label = `${row.sourceName} — ${row.listTitle}${yearStr}`;
    mentions.push({
      id: `list:${row.id}`,
      artistName: row.rawArtist ?? null,
      kind: "list_entry",
      sourceLabel: label,
      context: row.rawAlbum
        ? `${rankStr}${row.listTitle} — ${row.rawAlbum}`
        : `${rankStr}${row.listTitle}`,
      sourceUrl: row.sourceUrl || row.listUrl,
      occurredAt: row.listYear != null
        ? `${row.listYear}-01-01T00:00:00.000Z`
        : row.scrapedAt?.toISOString() ?? null,
    });
  }

  // Track claims → PressMention
  for (const row of claimRows) {
    mentions.push({
      id: `claim:${row.id}`,
      artistName: row.artist ?? null,
      kind: "track_claim",
      sourceLabel: row.sourceLabel,
      context: row.text.slice(0, 120) + (row.text.length > 120 ? "…" : ""),
      sourceUrl: row.sourceUrl,
      occurredAt: row.createdAt.toISOString(),
    });
  }

  // Sort: newest-first (null occurredAt sorts last)
  mentions.sort((a, b) => {
    if (a.occurredAt === b.occurredAt) return 0;
    if (a.occurredAt == null) return 1;
    if (b.occurredAt == null) return -1;
    return b.occurredAt.localeCompare(a.occurredAt);
  });

  return mentions;
}

// ---------------------------------------------------------------------------
// Taste fast-path
// ---------------------------------------------------------------------------

async function hasTaste(userId: number): Promise<boolean> {
  const [lib, seeds, soft] = await Promise.all([
    db
      .select({ id: libraryItemsTable.id })
      .from(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt)))
      .limit(1),
    db
      .select({ id: tasteSeedsTable.id })
      .from(tasteSeedsTable)
      .where(eq(tasteSeedsTable.userId, userId))
      .limit(1),
    db
      .select({ id: spotifyLibraryItemsTable.id })
      .from(spotifyLibraryItemsTable)
      .where(and(eq(spotifyLibraryItemsTable.userId, userId), isNull(spotifyLibraryItemsTable.removedAt)))
      .limit(1),
  ]);
  return lib.length > 0 || seeds.length > 0 || soft.length > 0;
}

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

/**
 * Encode a pagination cursor from [id, occurredAt].
 * occurredAt may be null — we encode it as the empty string.
 */
function encodeCursor(id: string, occurredAt: string | null): string {
  return Buffer.from(JSON.stringify([id, occurredAt ?? ""])).toString("base64url");
}

function decodeCursor(raw: string): { id: string; occurredAt: string | null } | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    const [id, occ] = parsed as [unknown, unknown];
    if (typeof id !== "string") return null;
    return {
      id: id,
      occurredAt: typeof occ === "string" && occ.length > 0 ? occ : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * GET /api/me/press-crossings?cursor=...
 *
 * Returns { items, nextCursor, computing, failed, hasTaste }.
 *   computing — true while this is the first cold-cache request and the server
 *               is still computing results; the client polls fast until false.
 *   failed    — true when the compute crashed; the client shows "couldn't check".
 *   hasTaste  — false when the user has no library/seeds; client shows nudge.
 */
router.get("/me/press-crossings", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const rawCursor = typeof req.query["cursor"] === "string" ? req.query["cursor"] : null;
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) {
    return res.status(400).json({ error: "Invalid cursor" });
  }

  // ── Cache read ───────────────────────────────────────────────────────────
  const cached = pressCache.get(user.id);
  if (cached && Date.now() - cached.builtAt < pressCacheTtl(cached.data)) {
    return res.json(paginateResult(cached.data, cursor, user.id, true, false));
  }

  // ── Empty-taste fast path ────────────────────────────────────────────────
  const taste = await hasTaste(user.id);
  if (!taste) {
    pressCache.set(user.id, { builtAt: Date.now(), data: [] });
    return res.json({ items: [], nextCursor: null, computing: false, failed: false, hasTaste: false });
  }

  // ── Full compute ─────────────────────────────────────────────────────────
  // Press mentions are much cheaper than radio crossings (no big aggregate
  // scan) so we always compute inline. If the DB is slow, the 15s fetch
  // timeout in meHooks handles the client side.
  try {
    const items = await computePressMentions(user.id);
    pressCache.set(user.id, { builtAt: Date.now(), data: items });
    return res.json(paginateResult(items, cursor, user.id, true, false));
  } catch (err) {
    console.error("[press-crossings] compute failed for user=%d", user.id, err);
    return res.json({ items: [], nextCursor: null, computing: false, failed: true, hasTaste: true });
  }
}));

function paginateResult(
  all: PressMention[],
  cursor: { id: string; occurredAt: string | null } | null,
  _userId: number,
  hasTaste: boolean,
  computing: boolean,
) {
  let startIdx = 0;
  if (cursor) {
    // Find the item AFTER the cursor (cursor points at the last-seen item)
    const found = all.findIndex((m) => m.id === cursor.id);
    startIdx = found >= 0 ? found + 1 : 0;
  }
  const page = all.slice(startIdx, startIdx + PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor = page.length === PAGE_SIZE && last
    ? encodeCursor(last.id, last.occurredAt)
    : null;
  return {
    items: page,
    nextCursor,
    computing,
    failed: false,
    hasTaste,
  };
}

export default router;
