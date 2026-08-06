import { Router, type IRouter } from "express";
import {
  db,
  libraryItemsTable,
  picksTable,
  pickersTable,
  recordingReleaseGroupsTable,
  spinsTable,
  stationsTable,
  showsTable,
} from "@workspace/db";
import { eq, and, ne, isNotNull, inArray, asc, sql } from "drizzle-orm";
import { spinDayExpr } from "../../lore/runs.js";
import { h } from "../../middlewares/asyncHandler.js";
import { pickerNotOptedOut, validScheduleShowAttribution } from "../lore/shared.js";
import { eligibleDjName } from "@workspace/lore-attribution";
import { getForYouStations, getForYouBlogs } from "../../lore/for-you.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

// Legacy radio metadata can carry a sponsor domain in recordings.artist.
// Keep it out of listener-facing overlap labels even if an old recording
// predates ingestion cleanup.
const JUNK_ARTIST_SQL_RE =
  String.raw`(^https?://|[.](com|net|org|edu|gov|io|fm|co|info|biz|music|radio|ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)([/?#[:space:]]|$))`;

// ---------------------------------------------------------------------------
// For-You endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/me/stations/for-you — stations ranked by four-tier personalization:
 * (1) artist overlap with user's library, (2) in-Lore keeps, (3) followed-picker
 * affinity (future), (4) popularity cold-start. Grouped by genre pole.
 * Optional: ?genre=jazz  ?limit=20
 */
router.get("/me/stations/for-you", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const genre =
    typeof req.query["genre"] === "string" && req.query["genre"].trim()
      ? req.query["genre"].trim().toLowerCase()
      : undefined;
  const limitRaw = parseInt(String(req.query["limit"] ?? ""), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;

  const result = await getForYouStations(user, { genre, limit });

  return res.json({
    genre_poles: result.genre_poles.map((pole) => ({
      genre: pole.genre,
      items: pole.items.map((s) => ({
        slug: s.slug,
        name: s.name,
        org: s.org,
        streamUrl: s.streamUrl,
        streamFormat: s.streamFormat,
        homepageUrl: s.homepageUrl,
        logoUrl: s.logoUrl,
        tags: s.tags,
        popularity: s.clickcount + s.votes,
        overlap: s.overlap,
      })),
    })),
    cold_start: result.cold_start,
    ...(result.prompt ? { prompt: result.prompt } : {}),
  });
}));

/**
 * GET /api/me/blogs/for-you — blog pickers ranked by four-tier personalization.
 * Optional: ?genre=jazz  ?limit=20
 */
router.get("/me/blogs/for-you", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const genre =
    typeof req.query["genre"] === "string" && req.query["genre"].trim()
      ? req.query["genre"].trim().toLowerCase()
      : undefined;
  const limitRaw = parseInt(String(req.query["limit"] ?? ""), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;

  const result = await getForYouBlogs(user, { genre, limit });

  return res.json({
    genre_poles: result.genre_poles.map((pole) => ({
      genre: pole.genre,
      items: pole.items.map((b) => ({
        handle: b.handle,
        name: b.name,
        homeUrl: b.homeUrl,
        tags: b.tags,
        pick_count: b.pickCount,
        overlap: b.overlap,
      })),
    })),
    cold_start: result.cold_start,
    ...(result.prompt ? { prompt: result.prompt } : {}),
  });
}));

/**
 * GET /api/me/ghost/missed — stations that played the user's library artists
 * in the rolling 24 h window but that the user has never consciously tuned
 * into (no listens record for that station).
 *
 * Join path: library_items → recordings (artist_mbid) → spins (24 h) →
 * stations.  Excludes stations with any listens row for this user.
 * Returns at most 20 stations ordered by sort_order, name.
 */
router.get("/me/ghost/missed", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  type GhostRow = {
    station_id: number;
    slug: string;
    name: string;
    stream_url: string;
    stream_format: string;
    mode: string;
    attribution: boolean;
    artist_name: string;
    played_at: string;
    day: string;
    show_name: string | null;
    raw_dj_name: string | null;
    run_id: number | null;
  };

  // Build the attribution guard for the shows LEFT JOIN, reusing the same
  // validScheduleShowAttribution helper the runs handler uses. Pass raw SQL
  // aliases that match the CTE/join aliases in the outer query.
  const attrCondition = validScheduleShowAttribution(
    sql.raw("gc.station_id"),
    sql.raw("gc.played_at"),
    sql.raw("sh.name"),
    sql.raw("sh.picker_id"),
  );

  const rows = await db.execute<GhostRow>(sql`
    WITH lib_artists AS (
      SELECT DISTINCT r.artist_mbid
      FROM library_items li
      JOIN recordings r ON li.mbid = r.mbid
      WHERE li.user_id = ${user.id}
        AND r.artist_mbid IS NOT NULL
    ),
    heard_stations AS (
      SELECT DISTINCT station_id
      FROM listens
      WHERE user_id = ${user.id}
        AND station_id IS NOT NULL
    ),
    ghost_candidates AS (
      SELECT DISTINCT ON (s.station_id)
        s.station_id,
        s.id         AS spin_id,
        s.played_at,
        s.show_id,
        r.artist     AS artist_name
      FROM spins s
      JOIN recordings r ON s.mbid = r.mbid
      JOIN lib_artists la ON r.artist_mbid = la.artist_mbid
      WHERE s.played_at >= NOW() - INTERVAL '24 hours'
        AND r.artist !~* ${JUNK_ARTIST_SQL_RE}
      ORDER BY s.station_id, s.played_at DESC
    )
    SELECT
      st.id             AS station_id,
      st.slug,
      st.name,
      st.stream_url,
      st.stream_format,
      st.mode,
      st.attribution,
      gc.artist_name,
      gc.played_at,
      to_char(gc.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      sh.name           AS show_name,
      sh.dj_name        AS raw_dj_name,
      CASE
        WHEN gc.show_id IS NOT NULL AND sh.id IS NOT NULL THEN (
          SELECT min(s2.id)
          FROM spins s2
          WHERE s2.station_id = gc.station_id
            AND s2.show_id = gc.show_id
            AND to_char(s2.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                = to_char(gc.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        )
        ELSE NULL
      END               AS run_id
    FROM ghost_candidates gc
    JOIN stations st ON gc.station_id = st.id
    LEFT JOIN heard_stations hs ON hs.station_id = st.id
    LEFT JOIN shows sh ON sh.id = gc.show_id AND ${attrCondition}
    WHERE st.active = true
      AND st.hidden = false
      AND hs.station_id IS NULL
    ORDER BY st.sort_order, st.name
    LIMIT 20
  `);

  return res.json({
    stations: rows.rows.map((r) => {
      const djName = eligibleDjName(r.raw_dj_name ?? null, {
        artist: r.artist_name,
        showTitle: r.show_name ?? undefined,
        stationName: r.name,
      });
      return {
        stationId: r.station_id,
        slug: r.slug,
        name: r.name,
        streamUrl: r.stream_url,
        streamFormat: r.stream_format ?? "aac",
        mode: r.mode ?? "live",
        attribution: r.attribution ?? true,
        artistName: r.artist_name,
        playedAt: r.played_at,
        day: r.day,
        showName: r.show_name ?? null,
        djName: djName ?? null,
        runId: r.run_id !== null && r.run_id !== undefined ? Number(r.run_id) : null,
      };
    }),
  });
}));

// ---------------------------------------------------------------------------
// Taste overlap endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/me/overlaps/pickers — pickers ranked by exact-MBID intersection
 * with the user's library_items.  Shape mirrors station→picker overlaps.
 */
router.get("/me/overlaps/pickers", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const userLib = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));

  const sharedExpr = sql<number>`count(distinct ${picksTable.mbid})::int`;

  const rows = await db
    .select({
      name: pickersTable.name,
      handle: pickersTable.handle,
      pickerType: pickersTable.pickerType,
      trustTier: pickersTable.trustTier,
      sharedCount: sharedExpr,
    })
    .from(picksTable)
    .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
    .where(
      and(
        eq(pickersTable.active, true),
        ne(pickersTable.pickerType, "dj"),
        isNotNull(picksTable.mbid),
        inArray(picksTable.mbid, userLib),
        pickerNotOptedOut(pickersTable.id),
      ),
    )
    .groupBy(
      pickersTable.id,
      pickersTable.name,
      pickersTable.handle,
      pickersTable.pickerType,
      pickersTable.trustTier,
    )
    .orderBy(
      sql`count(distinct ${picksTable.mbid}) desc`,
      asc(pickersTable.trustTier),
      asc(pickersTable.name),
    )
    .limit(20);

  return res.json({
    items: rows.map((r) => ({
      picker: {
        name: r.name,
        handle: r.handle,
        pickerType: r.pickerType,
        trustTier: r.trustTier,
      },
      sharedCount: r.sharedCount,
    })),
  });
}));

/**
 * GET /api/me/overlaps/selectors — DJ selectors (radio pickers) ranked by how
 * many of the caller's library recordings they have ever aired.  Mirrors
 * /overlaps/pickers but targets pickerType = 'dj' and uses the picks table
 * (DJ show picks are ingested there the same as curated picks).
 */
router.get("/me/overlaps/selectors", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const userLib = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));

  const sharedExpr = sql<number>`count(distinct ${picksTable.mbid})::int`;

  const rows = await db
    .select({
      name: pickersTable.name,
      handle: pickersTable.handle,
      sharedCount: sharedExpr,
    })
    .from(picksTable)
    .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
    .where(
      and(
        eq(pickersTable.active, true),
        eq(pickersTable.pickerType, "dj"),
        isNotNull(picksTable.mbid),
        inArray(picksTable.mbid, userLib),
        pickerNotOptedOut(pickersTable.id),
      ),
    )
    .groupBy(pickersTable.id, pickersTable.name, pickersTable.handle)
    .orderBy(sql`count(distinct ${picksTable.mbid}) desc`, asc(pickersTable.name))
    .limit(500);

  return res.json({
    items: rows.map((r) => ({
      selector: { name: r.name, handle: r.handle },
      sharedCount: r.sharedCount,
    })),
  });
}));

// ---------------------------------------------------------------------------
// Picker overlap with full library — pickerId-keyed, RG-widened, TTL-cached
// ---------------------------------------------------------------------------

const PICKER_OVERLAP_TTL_MS = 5 * 60 * 1000;

type PickerOverlapRow = { pickerId: number; pickerName: string; overlapCount: number };
const pickerOverlapCache = new Map<number, { builtAt: number; data: PickerOverlapRow[] }>();

/** Evict a user's picker-overlap cache after a library write. */
export function bustPickerOverlapCache(userId: number): void {
  pickerOverlapCache.delete(userId);
}

/** Evict a user's cached entry — for tests only. */
export function _testOnly_clearPickerOverlapCache(userId: number): void {
  bustPickerOverlapCache(userId);
}

/** Return the raw cached entry — lets tests verify cache hits without DB spying. */
export function _testOnly_getPickerOverlapCache(
  userId: number,
): { builtAt: number; data: PickerOverlapRow[] } | undefined {
  return pickerOverlapCache.get(userId);
}

/**
 * GET /api/me/pickers/overlap — DJ pickers ranked by how many of the caller's
 * library recordings they have ever picked, using exact-MBID + primary-RG
 * widening over the *full* library (no sampling cap).  Distinct from
 * /overlaps/selectors which does exact-MBID only and returns a name-keyed
 * shape.  Results are cached per-user for 5 minutes.
 */
router.get("/me/pickers/overlap", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const cached = pickerOverlapCache.get(user.id);
  if (cached && Date.now() - cached.builtAt < PICKER_OVERLAP_TTL_MS) {
    return res.json({ items: cached.data });
  }

  // Subquery: exact library MBIDs.
  const userLibMbids = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));

  // Subquery: release-group MBIDs for the user's library (album widening).
  const userLibRgs = db
    .select({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
    .from(recordingReleaseGroupsTable)
    .innerJoin(
      libraryItemsTable,
      eq(recordingReleaseGroupsTable.recordingMbid, libraryItemsTable.mbid),
    )
    .where(eq(libraryItemsTable.userId, user.id));

  // Library-hit predicate (mirroring crossings.ts): exact MBID OR same primary RG.
  const libHit = sql`(
    ${picksTable.mbid} in (${userLibMbids})
    or (
      ${recordingReleaseGroupsTable.releaseGroupMbid} is not null
      and ${recordingReleaseGroupsTable.releaseGroupMbid} in (${userLibRgs})
    )
  )`;

  const rows = await db
    .select({
      pickerId: pickersTable.id,
      pickerName: pickersTable.name,
      overlapCount: sql<number>`count(distinct ${picksTable.mbid})::int`,
    })
    .from(picksTable)
    .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
    .leftJoin(
      recordingReleaseGroupsTable,
      and(
        eq(recordingReleaseGroupsTable.recordingMbid, picksTable.mbid),
        eq(recordingReleaseGroupsTable.isPrimary, true),
      ),
    )
    .where(
      and(
        eq(pickersTable.active, true),
        eq(pickersTable.pickerType, "dj"),
        isNotNull(picksTable.mbid),
        pickerNotOptedOut(pickersTable.id),
        libHit,
      ),
    )
    .groupBy(pickersTable.id, pickersTable.name)
    .orderBy(sql`count(distinct ${picksTable.mbid}) desc`, asc(pickersTable.name));

  const items: PickerOverlapRow[] = rows.map((r) => ({
    pickerId: r.pickerId,
    pickerName: r.pickerName,
    overlapCount: r.overlapCount,
  }));

  pickerOverlapCache.set(user.id, { builtAt: Date.now(), data: items });
  return res.json({ items });
}));

/**
 * GET /api/me/overlaps/stations — stations ranked by shared spins with the
 * user's library_items.
 */
router.get("/me/overlaps/stations", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const userLib = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));

  const sharedExpr = sql<number>`count(distinct ${spinsTable.mbid})::int`;

  const rows = await db
    .select({
      slug: stationsTable.slug,
      name: stationsTable.name,
      stationClass: stationsTable.stationClass,
      sharedCount: sharedExpr,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .where(
      and(
        isNotNull(spinsTable.mbid),
        inArray(spinsTable.mbid, userLib),
        eq(stationsTable.hidden, false),
      ),
    )
    .groupBy(stationsTable.id, stationsTable.slug, stationsTable.name, stationsTable.stationClass)
    .orderBy(
      sql`count(distinct ${spinsTable.mbid}) desc`,
      asc(stationsTable.name),
    )
    .limit(20);

  return res.json({
    items: rows.map((r) => ({
      station: {
        slug: r.slug,
        name: r.name,
        stationClass: r.stationClass,
      },
      sharedCount: r.sharedCount,
    })),
  });
}));

/**
 * GET /api/me/overlaps/runs — station broadcast runs with `owned` (MBIDs in
 * user's library) and `discover` (resolved MBIDs NOT in library), ranked by
 * owned desc, then discover desc.
 */
router.get("/me/overlaps/runs", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const { showsTable } = await import("@workspace/db");
  const { spinDayExpr } = await import("../../lore/runs.js");

  const userMbids = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));

  const rows = await db
    .select({
      runId: sql<number>`min(${spinsTable.id})`,
      day: spinDayExpr,
      stationSlug: stationsTable.slug,
      stationName: stationsTable.name,
      stationClass: stationsTable.stationClass,
      showName: showsTable.name,
      djName: showsTable.djName,
      owned: sql<number>`count(*) filter (where ${spinsTable.mbid} in (${userMbids}))::int`,
      discover: sql<number>`count(*) filter (where ${spinsTable.mbid} is not null and ${spinsTable.mbid} not in (${userMbids}))::int`,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .leftJoin(
      showsTable,
      and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    )
    .where(and(isNotNull(spinsTable.mbid), eq(stationsTable.hidden, false)))
    .groupBy(
      spinDayExpr,
      spinsTable.stationId,
      spinsTable.showId,
      stationsTable.slug,
      stationsTable.name,
      stationsTable.stationClass,
      showsTable.name,
      showsTable.djName,
    )
    .having(sql`count(*) filter (where ${spinsTable.mbid} in (${userMbids})) > 0`)
    .orderBy(
      sql`count(*) filter (where ${spinsTable.mbid} in (${userMbids})) desc`,
      sql`count(*) filter (where ${spinsTable.mbid} is not null and ${spinsTable.mbid} not in (${userMbids})) desc`,
    )
    .limit(30);

  return res.json({
    items: rows.map((r) => ({
      runId: r.runId,
      day: r.day,
      station: {
        slug: r.stationSlug,
        name: r.stationName,
        stationClass: r.stationClass,
      },
      show: r.showName
        ? {
            name: r.showName,
            djName: eligibleDjName(r.djName, {
              showTitle: r.showName,
              stationName: r.stationName,
            }),
          }
        : null,
      owned: r.owned,
      discover: r.discover,
    })),
  });
}));

export default router;
