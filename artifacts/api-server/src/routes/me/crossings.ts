import { Router, type IRouter } from "express";
import {
  db,
  libraryItemsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  spinsTable,
  stationsTable,
  spotifyLibraryItemsTable,
  crossingsCacheTable,
  tasteSeedsTable,
} from "@workspace/db";
import { eq, and, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Two-layer TTL cache (5 min)
//
// Layer 1 — in-process Map (crossingsCache below).  Zero-latency within a
//   single server instance for the duration of the process lifetime.
//
// Layer 2 — Postgres `crossings_cache` table (one row per user).  Survives
//   server restarts and is shared across instances, so a cold-start or a new
//   instance reading the same user's row avoids the expensive full-table scan.
//   Written on every fresh compute alongside the L1 write.
//
// Read path:  L1 hit → return immediately.
//             L1 miss → try L2 (Postgres); if fresh, repopulate L1 and return.
//             Both miss → run the full DB query, write L2 then L1, return.
//
// TTL is enforced in application code via `builtAt`.  The same 5-minute window
// is used for both layers so they stay in sync.
//
// ⚠ Deployment note: with this L2 layer in place the implementation is safe
// for horizontal scaling — two instances computing for the same user
// independently write to the same Postgres row (upsert) and the first fresh
// result wins.  The remaining per-instance L1 staleness (up to 5 min) is
// unchanged from the previous single-layer behaviour.
// ---------------------------------------------------------------------------

const CROSSINGS_CACHE_TTL_MS = 5 * 60 * 1000;

// Keep historical URL/domain metadata out of listener-facing crossing counts,
// even when it predates the ingestion guard or a cleanup boot.
const JUNK_ARTIST_SQL_RE =
  String.raw`(^https?://|[.](com|net|org|edu|gov|io|fm|co|info|biz|music|radio|ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)([/?#[:space:]]|$))`;

type CrossingsRow = {
  stationSlug: string;
  crossings: number;
  artistCrossings: number;
  lifetimeCrossings: number;
  lifetimeArtistCrossings: number;
};

const crossingsCache = new Map<number, { builtAt: number; data: CrossingsRow[] }>();

/**
 * Evict a user's crossings from both in-process (L1) and Postgres (L2) cache.
 * Called by taste-seeds PUT and tests so the next poll reflects the new data.
 */
export function bustCrossingsCache(userId: number): void {
  crossingsCache.delete(userId);
  void db
    .delete(crossingsCacheTable)
    .where(eq(crossingsCacheTable.userId, userId))
    .catch(() => {});
}

/** Evict a user's cached entry — call before a test that needs a fresh DB hit. */
export function _testOnly_clearCrossingsCache(userId: number): void {
  bustCrossingsCache(userId);
}

/** Returns true when a fresh cache entry exists for the user — used in tests only. */
export function _testOnly_hasCrossingsCache(userId: number): boolean {
  const entry = crossingsCache.get(userId);
  return entry !== undefined && Date.now() - entry.builtAt < CROSSINGS_CACHE_TTL_MS;
}

/** Return the raw cached entry for a user — lets tests verify cache hits without spying on db. */
export function _testOnly_getCrossingsCache(userId: number): { builtAt: number; data: CrossingsRow[] } | undefined {
  return crossingsCache.get(userId);
}

// ---------------------------------------------------------------------------
// L2 helpers
// ---------------------------------------------------------------------------

/**
 * Try to read a fresh entry from the Postgres L2 cache.
 * Returns the data rows on a hit, null on a miss or any read error.
 */
async function readL2Cache(userId: number): Promise<CrossingsRow[] | null> {
  try {
    const rows = await db
      .select()
      .from(crossingsCacheTable)
      .where(eq(crossingsCacheTable.userId, userId))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0]!;
    if (Date.now() - row.builtAt.getTime() >= CROSSINGS_CACHE_TTL_MS) return null;
    return row.data as CrossingsRow[];
  } catch {
    // L2 read errors are non-fatal: fall through to full compute.
    return null;
  }
}

/**
 * Persist a fresh result to the Postgres L2 cache (upsert).
 * Fire-and-forget — errors are logged but never surface to the caller.
 */
async function writeL2Cache(userId: number, data: CrossingsRow[], builtAt: Date): Promise<void> {
  try {
    await db
      .insert(crossingsCacheTable)
      .values({ userId, data, builtAt })
      .onConflictDoUpdate({
        target: crossingsCacheTable.userId,
        set: { data, builtAt },
      });
  } catch (err) {
    console.error("[crossings] L2 cache write failed", err);
  }
}

// ---------------------------------------------------------------------------
// Crossings endpoint
// ---------------------------------------------------------------------------

/**
 * GET /api/me/crossings?date=YYYY-MM-DD — rolling 24-hour station crossing
 * scores computed server-side.
 *
 * Returns { items: { stationSlug, crossings, artistCrossings }[] } for
 * stations that have ≥ 1 crossing of either type in the past 24 hours.
 * Only non-hidden stations are included.
 *
 * Crossings   = spins whose exact MBID *or* any track from the same primary
 *               release group is in the user's library_items.
 * ArtistCrossings = spins by library artists (artistMbid or soft name-based
 *               fallback) where the exact track/album is NOT in the library.
 *
 * The `date` param is accepted for client-side cache-key alignment but the
 * server always computes a true rolling NOW() − 24 h window.
 */
router.get("/me/crossings", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  // ── L1: in-process Map ────────────────────────────────────────────────────
  const cached = crossingsCache.get(user.id);
  if (cached && Date.now() - cached.builtAt < CROSSINGS_CACHE_TTL_MS) {
    return res.json({ items: cached.data });
  }

  // ── L2: Postgres persistent cache ─────────────────────────────────────────
  const l2data = await readL2Cache(user.id);
  if (l2data !== null) {
    // Repopulate L1 so subsequent same-instance requests skip Postgres entirely.
    crossingsCache.set(user.id, { builtAt: Date.now(), data: l2data });
    return res.json({ items: l2data });
  }

  // ── Full compute ──────────────────────────────────────────────────────────
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Subquery: recording MBIDs in user's library.
  const userLibMbids = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));

  // Subquery: release-group MBIDs represented in the user's library (album widening).
  const userLibRgs = db
    .select({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
    .from(recordingReleaseGroupsTable)
    .innerJoin(
      libraryItemsTable,
      eq(recordingReleaseGroupsTable.recordingMbid, libraryItemsTable.mbid),
    )
    .where(eq(libraryItemsTable.userId, user.id));

  // Subquery: artist MBIDs whose recordings are in the user's library.
  const userLibArtists = db
    .select({ artistMbid: recordingsTable.artistMbid })
    .from(recordingsTable)
    .innerJoin(libraryItemsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
    .where(
      and(
        eq(libraryItemsTable.userId, user.id),
        isNotNull(recordingsTable.artistMbid),
      ),
    );

  // ── Composite SQL predicates ──────────────────────────────────────────────
  // Library hit: exact MBID OR any track from the same primary release group.
  const libHit = sql`(
    ${recordingsTable.artist} !~* ${JUNK_ARTIST_SQL_RE}
    and (
      ${spinsTable.mbid} in (${userLibMbids})
      or (
        ${recordingReleaseGroupsTable.releaseGroupMbid} is not null
        and ${recordingReleaseGroupsTable.releaseGroupMbid} in (${userLibRgs})
      )
    )
  )`;

  // Explicit negation of libHit (avoids NOT IN on a nullable column; both
  // subqueries return non-null rows so NOT IN is safe here).
  const notLibHit = sql`(
    ${spinsTable.mbid} not in (${userLibMbids})
    and (
      ${recordingReleaseGroupsTable.releaseGroupMbid} is null
      or ${recordingReleaseGroupsTable.releaseGroupMbid} not in (${userLibRgs})
    )
  )`;

  // Soft-artist subquery: unresolved Spotify imports matched by lowercased
  // artist name when no artistMbid is available on the spin's recording.
  //
  // Previously this was fetched in application code and passed as a literal
  // array — e.g. = any(array['artist1','artist2',...1500 more...]).  With a
  // large unresolved import that produces ~1,500 distinct artist names the
  // serialised array literal alone took several seconds to parse and Postgres
  // could not plan it as a hash-join, driving total query time to 20 s+.
  //
  // A SQL subquery lets the planner build a hash-table of soft artist names
  // once and probe it per recording row — effectively O(n) instead of O(n·m).
  // The try/catch around the old fetch is no longer needed: if the table is
  // absent the subquery returns zero rows and the query degrades cleanly.
  const userSoftArtists = db
    .selectDistinct({ artistLower: sql<string>`lower(trim(${spotifyLibraryItemsTable.artist}))` })
    .from(spotifyLibraryItemsTable)
    .where(
      and(
        eq(spotifyLibraryItemsTable.userId, user.id),
        isNull(spotifyLibraryItemsTable.mbid),
        ne(spotifyLibraryItemsTable.artist, ""),
      ),
    );

  // Taste-seed soft names: artist names entered directly by the user before
  // they have connected any music service.  Treated identically to unresolved
  // Spotify soft rows — matched by lowercased artist name.
  const userSeedArtists = db
    .selectDistinct({ artistLower: sql<string>`lower(trim(${tasteSeedsTable.artistName}))` })
    .from(tasteSeedsTable)
    .where(eq(tasteSeedsTable.userId, user.id));

  // Artist match: MBID-based lookup + soft name fallback (Spotify imports and
  // taste seeds share the same matching path).
  const artistMatch = sql`(
    ${recordingsTable.artist} !~* ${JUNK_ARTIST_SQL_RE}
    and (
      ${recordingsTable.artistMbid} in (${userLibArtists})
      or lower(trim(${recordingsTable.artist})) in (${userSoftArtists})
      or lower(trim(${recordingsTable.artist})) in (${userSeedArtists})
    )
  )`;

  // ── Windowed predicates (24-hour rolling window) ─────────────────────────
  const inWindow = sql`${spinsTable.playedAt} >= ${cutoff}`;

  const rows = await db
    .select({
      stationSlug: stationsTable.slug,
      // 24-hour rolling counts.
      // All four fields share the unit "distinct library-relevant recordings" so
      // consumers can safely compare or combine them.  A station that replays one
      // artist track 50× scores 1, not 50 — count(distinct mbid) collapses replays.
      crossings:       sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inWindow} and ${libHit})::int`,
      // Unit: distinct recordings (not spin events) — same scale as `crossings` above.
      artistCrossings: sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inWindow} and ${notLibHit} and ${artistMatch})::int`,
      // All-time (lifetime) counts — distinct mbid so the scale matches pickerOv()
      // (count(distinct picks.mbid)) and attributed DJ rows don't get systematically
      // outranked by stations with high-replay playlists.
      lifetimeCrossings:       sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${libHit})::int`,
      // Unit: distinct recordings — same scale as `lifetimeCrossings` and `crossings`.
      lifetimeArtistCrossings: sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${notLibHit} and ${artistMatch})::int`,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .innerJoin(recordingsTable, eq(recordingsTable.mbid, spinsTable.mbid!))
    .leftJoin(
      recordingReleaseGroupsTable,
      and(
        eq(recordingReleaseGroupsTable.recordingMbid, recordingsTable.mbid),
        eq(recordingReleaseGroupsTable.isPrimary, true),
      ),
    )
    .where(
      and(
        isNotNull(spinsTable.mbid),
        eq(stationsTable.hidden, false),
      ),
    )
    .groupBy(stationsTable.id, stationsTable.slug)
    .having(
      // At least one 24h crossing or lifetime crossing — keeps the result set
      // compact (no row for stations with zero overlap of any kind).
      sql`count(*) filter (where ${libHit}) > 0
       or count(*) filter (where ${notLibHit} and ${artistMatch}) > 0`,
    );

  const items: CrossingsRow[] = rows.map((r) => ({
    stationSlug: r.stationSlug,
    crossings: r.crossings,
    artistCrossings: r.artistCrossings,
    lifetimeCrossings: r.lifetimeCrossings,
    lifetimeArtistCrossings: r.lifetimeArtistCrossings,
  }));

  const builtAt = new Date();

  // Write L2 (Postgres) first so that a concurrent request on a different
  // instance can benefit from the fresh result immediately.
  void writeL2Cache(user.id, items, builtAt);

  // Then populate L1.
  crossingsCache.set(user.id, { builtAt: builtAt.getTime(), data: items });

  return res.json({ items });
}));

export default router;
