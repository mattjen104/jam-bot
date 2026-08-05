import { Router, type IRouter } from "express";
import {
  db,
  libraryItemsTable,
  loreUsersTable,
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
import {
  computeLifetimeCrossingsForUser,
  scheduleLifetimeCrossingsRefresh,
} from "../../lore/lifetime-crossings-job.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Two-layer TTL cache (30 min)
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
// TTL is enforced in application code via `builtAt`.  The same window is used
// for both layers so they stay in sync.
//
// ⚠ Deployment note: with this L2 layer in place the implementation is safe
// for horizontal scaling — two instances computing for the same user
// independently write to the same Postgres row (upsert) and the first fresh
// result wins.  The remaining per-instance L1 staleness (up to 30 min) is
// unchanged from the previous single-layer behaviour.
// ---------------------------------------------------------------------------

// 30-minute TTL: crossing scores are based on historical spins (not real-time)
// and the user's library rarely changes mid-session.  A 30-min window means
// the slow full-compute only fires once per half-hour per user instead of
// every 2 minutes.  Import completion and taste-seed changes call
// bustCrossingsCache() directly, so the dial updates immediately after a
// library change without needing a short poll interval.
const CROSSINGS_CACHE_TTL_MS = 30 * 60 * 1000;

// Keep historical URL/domain metadata out of listener-facing crossing counts,
// even when it predates the ingestion guard or a cleanup boot.
const JUNK_ARTIST_SQL_RE =
  String.raw`(^https?://|[.](com|net|org|edu|gov|io|fm|co|info|biz|music|radio|ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)([/?#[:space:]]|$))`;

type CrossingsRow = {
  stationSlug: string;
  crossings: number;
  artistCrossings: number;
  weekCrossings: number;
  weekArtistCrossings: number;
  monthCrossings: number;
  monthArtistCrossings: number;
  lifetimeCrossings: number;
  lifetimeArtistCrossings: number;
};

const crossingsCache = new Map<number, { builtAt: number; data: CrossingsRow[] }>();

/** Short expiry window for "active now" presence — separate from the 24-h crossing window. */
export const SOCIAL_PRESENCE_TTL_MS = 3 * 60 * 1000;

/** The only users whose library evidence may enter the anonymous blend. */
export function activeSocialUsers(cutoff = new Date(Date.now() - SOCIAL_PRESENCE_TTL_MS)) {
  return db
    .select({ id: loreUsersTable.id })
    .from(loreUsersTable)
    .where(and(
      eq(loreUsersTable.socialParticipation, true),
      sql`${loreUsersTable.lastSeenAt} >= ${cutoff}`,
    ));
}

/**
 * Evict a user's crossings from both in-process (L1) and Postgres (L2) cache.
 * Also queues a background lifetime-crossings refresh so the pre-built table
 * stays in sync with the new library state.
 * Called by taste-seeds PUT and tests so the next poll reflects the new data.
 */
export function bustCrossingsCache(userId: number): void {
  crossingsCache.delete(userId);
  void db
    .delete(crossingsCacheTable)
    .where(eq(crossingsCacheTable.userId, userId))
    .catch(() => {});
  // Queue a background refresh of the true lifetime counts for this user.
  scheduleLifetimeCrossingsRefresh(userId);
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
// Personal crossings endpoint
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
 *
 * Lifetime counts (lifetimeCrossings, lifetimeArtistCrossings) come from the
 * pre-built `lifetime_crossings_cache` table maintained by the background job
 * in `lore/lifetime-crossings-job.ts`.  They are never computed inline here.
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

  console.log(`[crossings] full compute for user=${user.id}`);

  // ── Full compute ──────────────────────────────────────────────────────────
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // The bounded query only needs to cover the longest rolling window
  // (30 days for monthCrossings).  Lifetime counts come from the pre-built
  // `lifetime_crossings_cache` table written by the background job, so they
  // never require a full-table scan here.
  const scanCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

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
  // A SQL subquery lets the planner build a hash-table of soft artist names
  // once and probe it per recording row — effectively O(n) instead of O(n·m).
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

  // ── Windowed predicates ───────────────────────────────────────────────────
  // NOTE: this route must reference ONLY its own local cutoffs (`cutoff`,
  // `weekCutoff`, `monthCutoff`).  Merges have twice spliced the blended
  // handler's names (spinCutoff/blendedWeekCutoff) in here, which throws a
  // ReferenceError on every request → 503 → empty dial.
  const inWindow           = sql`${spinsTable.playedAt} >= ${spinCutoff}`;
  const weekCutoff  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
  const monthCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const inWeek             = sql`${spinsTable.playedAt} >= ${blendedWeekCutoff}`;
  const inMonth            = sql`${spinsTable.playedAt} >= ${blendedMonthCutoff}`;

  // ── Relevant MBIDs for the mbid-driven lifetime query ─────────────────────
  // Collects every recording MBID that could yield a crossing for this user:
  // exact library hits, recordings sharing a primary release group with a
  // library item, and any recording by a library artist (MBID or soft-name).
  const relevantMbids = sql`(
    select ${libraryItemsTable.mbid} from ${libraryItemsTable}
      where ${libraryItemsTable.userId} = ${user.id}
    union
    select ${recordingReleaseGroupsTable.recordingMbid} from ${recordingReleaseGroupsTable}
      where ${recordingReleaseGroupsTable.isPrimary} = true
        and ${recordingReleaseGroupsTable.releaseGroupMbid} in (${userLibRgs})
    union
    select ${recordingsTable.mbid} from ${recordingsTable}
      where ${recordingsTable.artist} !~* ${JUNK_ARTIST_SQL_RE}
        and (
          ${recordingsTable.artistMbid} in (${userLibArtists})
          or lower(trim(${recordingsTable.artist})) in (${userSoftArtists})
          or lower(trim(${recordingsTable.artist})) in (${userSeedArtists})
        )
  )`;

  const [rows, lifetimeRows] = await Promise.all([
    // ── Bounded rolling query (scanCutoff = 30 days) ─────────────────────────
    // Uses spins_station_played_at_idx; computes 24h / 7d / 30d rolling counts.
    db
      .select({
        stationSlug: stationsTable.slug,
        crossings:            sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inWindow} and ${libHit})::int`,
        artistCrossings:      sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inWindow} and ${notLibHit} and ${artistMatch})::int`,
        weekCrossings:        sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inWeek} and ${libHit})::int`,
        weekArtistCrossings:  sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inWeek} and ${notLibHit} and ${artistMatch})::int`,
        monthCrossings:       sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inMonth} and ${libHit})::int`,
        monthArtistCrossings: sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inMonth} and ${notLibHit} and ${artistMatch})::int`,
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
          sql`${spinsTable.playedAt} >= ${scanCutoff}`,
        ),
      )
      .groupBy(stationsTable.id, stationsTable.slug)
      .having(
        sql`count(*) filter (where ${libHit}) > 0
         or count(*) filter (where ${notLibHit} and ${artistMatch}) > 0`,
      ),

    // ── Lifetime query — mbid-driven, NOT date-driven ─────────────────────────
    // Lifetime counts must include matching spins of ANY age (a listener absent
    // >1 year still sees their scores).  An unbounded date scan takes 10–16 s on
    // ~1M spin rows, so instead the scan is driven by the user's own relevant
    // recording MBIDs: Postgres probes spins_mbid_played_at_idx per matching
    // MBID (nested-loop semi-join), which measures in tens of milliseconds for
    // library-sized MBID sets regardless of total spins-table growth.
    db
      .select({
        stationSlug: stationsTable.slug,
        lifetimeCrossings:       sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${libHit})::int`,
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
          sql`${spinsTable.mbid} in ${relevantMbids}`,
        ),
      )
      .groupBy(stationsTable.id, stationsTable.slug)
      .having(
        sql`count(*) filter (where ${libHit}) > 0
         or count(*) filter (where ${notLibHit} and ${artistMatch}) > 0`,
      ),
  ]);

  // Merge: rolling counts from the bounded scan, lifetime from the mbid scan.
  // A station can appear in either set — long-absent listeners may only have
  // lifetime rows; freshly-active stations may only have rolling rows.
  const lifetimeMap = new Map(lifetimeRows.map((r) => [r.stationSlug, r]));
  const rollingMap = new Map(rows.map((r) => [r.stationSlug, r]));
  const allSlugs = new Set([...rollingMap.keys(), ...lifetimeMap.keys()]);

  const items: CrossingsRow[] = [...allSlugs].map((slug) => {
    const r = rollingMap.get(slug);
    const l = lifetimeMap.get(slug);
    return {
      stationSlug:             slug,
      crossings:               r?.crossings              ?? 0,
      artistCrossings:         r?.artistCrossings         ?? 0,
      weekCrossings:           r?.weekCrossings           ?? 0,
      weekArtistCrossings:     r?.weekArtistCrossings     ?? 0,
      monthCrossings:          r?.monthCrossings          ?? 0,
      monthArtistCrossings:    r?.monthArtistCrossings    ?? 0,
      lifetimeCrossings:       l?.lifetimeCrossings       ?? 0,
      lifetimeArtistCrossings: l?.lifetimeArtistCrossings ?? 0,
    };
  });

  const builtAt = new Date();

  // Write L2 (Postgres) first so that a concurrent request on a different
  // instance can benefit from the fresh result immediately.
  void writeL2Cache(user.id, items, builtAt);

  // Then populate L1.
  crossingsCache.set(user.id, { builtAt: builtAt.getTime(), data: items });

  return res.json({ items });
}));

// ---------------------------------------------------------------------------
// Blended crossings endpoint
// ---------------------------------------------------------------------------

/**
 * GET /api/me/crossings/blended — anonymous aggregate crossings from active
 * opted-in Lore users. Returns only station-level aggregate counts; no user
 * IDs, library rows, or per-user data cross this boundary.
 *
 * Two distinct time windows:
 *   - presenceCutoff (3 min): selects which users count as "active now"
 *   - spinCutoff (24 h):      scores crossings over the same rolling window as
 *                             personal crossings so ranking is comparable
 */

/** Deduplicate and rank artist names from an array_agg result, returning top 5. */
function blendedTopArtists(raw: string[] | null): string[] {
  if (!raw?.length) return [];
  const counts = new Map<string, number>();
  for (const name of raw) {
    const k = name?.trim();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);
}

router.get("/me/crossings/blended", h(async (_req, res) => {
  const presenceCutoff = new Date(Date.now() - SOCIAL_PRESENCE_TTL_MS);
  const spinCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const activeUsers = activeSocialUsers(presenceCutoff);

  const activeLibraryMbids = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(sql`${libraryItemsTable.userId} in (${activeUsers})`);
  const activeLibraryRgs = db
    .select({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
    .from(recordingReleaseGroupsTable)
    .innerJoin(libraryItemsTable, eq(recordingReleaseGroupsTable.recordingMbid, libraryItemsTable.mbid))
    .where(sql`${libraryItemsTable.userId} in (${activeUsers})`);
  const activeLibraryArtists = db
    .select({ artistMbid: recordingsTable.artistMbid })
    .from(recordingsTable)
    .innerJoin(libraryItemsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
    .where(and(
      sql`${libraryItemsTable.userId} in (${activeUsers})`,
      isNotNull(recordingsTable.artistMbid),
    ));
  const activeSoftArtists = db
    .selectDistinct({ artistLower: sql<string>`lower(trim(${spotifyLibraryItemsTable.artist}))` })
    .from(spotifyLibraryItemsTable)
    .where(and(
      sql`${spotifyLibraryItemsTable.userId} in (${activeUsers})`,
      isNull(spotifyLibraryItemsTable.mbid),
      ne(spotifyLibraryItemsTable.artist, ""),
    ));
  const activeSeedArtists = db
    .selectDistinct({ artistLower: sql<string>`lower(trim(${tasteSeedsTable.artistName}))` })
    .from(tasteSeedsTable)
    .where(sql`${tasteSeedsTable.userId} in (${activeUsers})`);

  const aggregateLibHit = sql`(
    ${spinsTable.mbid} in (${activeLibraryMbids})
    or (
      ${recordingReleaseGroupsTable.releaseGroupMbid} is not null
      and ${recordingReleaseGroupsTable.releaseGroupMbid} in (${activeLibraryRgs})
    )
  )`;
  const aggregateNotLibHit = sql`(
    ${spinsTable.mbid} not in (${activeLibraryMbids})
    and (
      ${recordingReleaseGroupsTable.releaseGroupMbid} is null
      or ${recordingReleaseGroupsTable.releaseGroupMbid} not in (${activeLibraryRgs})
    )
  )`;
  const aggregateArtistMatch = sql`(
    ${recordingsTable.artistMbid} in (${activeLibraryArtists})
    or lower(trim(${recordingsTable.artist})) in (${activeSoftArtists})
    or lower(trim(${recordingsTable.artist})) in (${activeSeedArtists})
  )`;
  const inWindow           = sql`${spinsTable.playedAt} >= ${spinCutoff}`;
  const blendedWeekCutoff  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
  const blendedMonthCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const blendedScanCutoff  = blendedMonthCutoff;
  const inWeek             = sql`${spinsTable.playedAt} >= ${blendedWeekCutoff}`;
  const inMonth            = sql`${spinsTable.playedAt} >= ${blendedMonthCutoff}`;

  const blendedRows = await db
    .select({
      stationSlug:             stationsTable.slug,
      crossings:               sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inWindow} and ${aggregateLibHit})::int`,
      artistCrossings:         sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inWindow} and ${aggregateNotLibHit} and ${aggregateArtistMatch})::int`,
      weekCrossings:           sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inWeek}  and ${aggregateLibHit})::int`,
      weekArtistCrossings:     sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inWeek}  and ${aggregateNotLibHit} and ${aggregateArtistMatch})::int`,
      monthCrossings:          sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inMonth} and ${aggregateLibHit})::int`,
      monthArtistCrossings:    sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${inMonth} and ${aggregateNotLibHit} and ${aggregateArtistMatch})::int`,
      // Collect all matching artist names (with repeats) so we can rank by frequency in JS.
      topArtistNamesRaw:       sql<string[] | null>`array_agg(trim(${recordingsTable.artist})) filter (where ${inWindow} and (${aggregateLibHit} or (${aggregateNotLibHit} and ${aggregateArtistMatch})))`,
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
    .where(and(
      isNotNull(spinsTable.mbid),
      eq(stationsTable.hidden, false),
      sql`${spinsTable.playedAt} >= ${blendedScanCutoff}`,
    ))
    .groupBy(stationsTable.id, stationsTable.slug)
    .having(sql`count(*) filter (where ${aggregateLibHit} or (${aggregateNotLibHit} and ${aggregateArtistMatch})) > 0`);

  // ── Lifetime query — mbid-driven, NOT date-driven ─────────────────────────
  // Same pattern as the personal route above: lifetime counts must include
  // matching spins of ANY age, and an unbounded date scan of the spins table
  // takes 10–16 s. Instead the scan is driven by the active users' relevant
  // recording MBIDs so Postgres probes spins_mbid_played_at_idx per matching
  // MBID (nested-loop semi-join).
  const blendedRelevantMbids = sql`(
    select ${libraryItemsTable.mbid} from ${libraryItemsTable}
      where ${libraryItemsTable.userId} in (${activeUsers})
    union
    select ${recordingReleaseGroupsTable.recordingMbid} from ${recordingReleaseGroupsTable}
      where ${recordingReleaseGroupsTable.isPrimary} = true
        and ${recordingReleaseGroupsTable.releaseGroupMbid} in (${activeLibraryRgs})
    union
    select ${recordingsTable.mbid} from ${recordingsTable}
      where ${recordingsTable.artist} !~* ${JUNK_ARTIST_SQL_RE}
        and (
          ${recordingsTable.artistMbid} in (${activeLibraryArtists})
          or lower(trim(${recordingsTable.artist})) in (${activeSoftArtists})
          or lower(trim(${recordingsTable.artist})) in (${activeSeedArtists})
        )
  )`;

  const lifetimeRows = await db
    .select({
      stationSlug: stationsTable.slug,
      lifetimeCrossings:       sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${aggregateLibHit})::int`,
      lifetimeArtistCrossings: sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${aggregateNotLibHit} and ${aggregateArtistMatch})::int`,
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
    .where(and(
      isNotNull(spinsTable.mbid),
      eq(stationsTable.hidden, false),
      sql`${spinsTable.mbid} in ${blendedRelevantMbids}`,
    ))
    .groupBy(stationsTable.id, stationsTable.slug)
    .having(
      sql`count(*) filter (where ${aggregateLibHit}) > 0
       or count(*) filter (where ${aggregateNotLibHit} and ${aggregateArtistMatch}) > 0`,
    );

  // Merge: rolling counts from the bounded scan, lifetime from the mbid scan.
  // A station whose only matching spins are old (>30 days) appears via the
  // lifetime map only — rolling counts 0, topArtistNames empty.
  const blendedLifetimeMap = new Map(lifetimeRows.map((r) => [r.stationSlug, r]));
export default router;
      const l = blendedLifetimeMap.get(slug);
  const blendedRollingMap  = new Map(blendedRows.map((r) => [r.stationSlug, r]));
  const blendedSlugs = new Set([...blendedRollingMap.keys(), ...blendedLifetimeMap.keys()]);

  return res.json({
    items: [...blendedSlugs].map((slug) => {
      const r = blendedRollingMap.get(slug);
