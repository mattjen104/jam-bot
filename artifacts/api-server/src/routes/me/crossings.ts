import { Router, type IRouter } from "express";
import {
  db,
  libraryItemsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  spinsTable,
  stationsTable,
  spotifyLibraryItemsTable,
} from "@workspace/db";
import { eq, and, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

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
    ${spinsTable.mbid} in (${userLibMbids})
    or (
      ${recordingReleaseGroupsTable.releaseGroupMbid} is not null
      and ${recordingReleaseGroupsTable.releaseGroupMbid} in (${userLibRgs})
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

  // Artist match: MBID-based lookup + soft name subquery fallback.
  const artistMatch = sql`(
    ${recordingsTable.artistMbid} in (${userLibArtists})
    or lower(trim(${recordingsTable.artist})) in (${userSoftArtists})
  )`;

  // ── Windowed predicates (24-hour rolling window) ─────────────────────────
  const inWindow = sql`${spinsTable.playedAt} >= ${cutoff}`;

  const rows = await db
    .select({
      stationSlug: stationsTable.slug,
      // 24-hour rolling counts
      crossings:       sql<number>`count(*) filter (where ${inWindow} and ${libHit})::int`,
      artistCrossings: sql<number>`count(*) filter (where ${inWindow} and ${notLibHit} and ${artistMatch})::int`,
      // All-time (lifetime) counts — same logic, no time filter
      lifetimeCrossings:       sql<number>`count(*) filter (where ${libHit})::int`,
      lifetimeArtistCrossings: sql<number>`count(*) filter (where ${notLibHit} and ${artistMatch})::int`,
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

  return res.json({
    items: rows.map((r) => ({
      stationSlug: r.stationSlug,
      crossings: r.crossings,
      artistCrossings: r.artistCrossings,
      lifetimeCrossings: r.lifetimeCrossings,
      lifetimeArtistCrossings: r.lifetimeArtistCrossings,
    })),
  });
}));

export default router;
