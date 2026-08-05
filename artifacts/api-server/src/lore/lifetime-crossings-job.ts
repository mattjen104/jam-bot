import {
  db,
  libraryItemsTable,
  lifetimeCrossingsCacheTable,
  loreUsersTable,
  recordingReleaseGroupsTable,
  recordingsTable,
  spinsTable,
  spotifyLibraryItemsTable,
  stationsTable,
  tasteSeedsTable,
} from "@workspace/db";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Junk-artist filter — same regex used by the hot-path crossings query.
// ---------------------------------------------------------------------------
const JUNK_ARTIST_SQL_RE =
  String.raw`(^https?://|[.](com|net|org|edu|gov|io|fm|co|info|biz|music|radio|ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)([/?#[:space:]]|$))`;

// ---------------------------------------------------------------------------
// Per-user pending refresh set — prevents duplicate concurrent computations
// when bustCrossingsCache is called multiple times in rapid succession.
// ---------------------------------------------------------------------------
const pendingRefresh = new Set<number>();

/**
 * Compute true (unbounded) lifetime crossing counts for a single user and
 * persist the result to `lifetime_crossings_cache`.
 *
 * This is the expensive query — it is intentionally run off the hot request
 * path (background scheduler + on-demand after cache busts).
 */
export async function computeLifetimeCrossingsForUser(userId: number): Promise<void> {
  // Subquery: recording MBIDs in user's library.
  const userLibMbids = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, userId));

  // Subquery: release-group MBIDs represented in the user's library.
  const userLibRgs = db
    .select({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
    .from(recordingReleaseGroupsTable)
    .innerJoin(
      libraryItemsTable,
      eq(recordingReleaseGroupsTable.recordingMbid, libraryItemsTable.mbid),
    )
    .where(eq(libraryItemsTable.userId, userId));

  // Subquery: artist MBIDs whose recordings are in the user's library.
  const userLibArtists = db
    .select({ artistMbid: recordingsTable.artistMbid })
    .from(recordingsTable)
    .innerJoin(libraryItemsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
    .where(
      and(
        eq(libraryItemsTable.userId, userId),
        isNotNull(recordingsTable.artistMbid),
      ),
    );

  // Subquery: unresolved Spotify soft-artist names.
  const userSoftArtists = db
    .selectDistinct({ artistLower: sql<string>`lower(trim(${spotifyLibraryItemsTable.artist}))` })
    .from(spotifyLibraryItemsTable)
    .where(
      and(
        eq(spotifyLibraryItemsTable.userId, userId),
        isNull(spotifyLibraryItemsTable.mbid),
        ne(spotifyLibraryItemsTable.artist, ""),
      ),
    );

  // Subquery: taste-seed soft-artist names.
  const userSeedArtists = db
    .selectDistinct({ artistLower: sql<string>`lower(trim(${tasteSeedsTable.artistName}))` })
    .from(tasteSeedsTable)
    .where(eq(tasteSeedsTable.userId, userId));

  // ── Composite predicates (same logic as the hot-path bounded query) ───────
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

  const notLibHit = sql`(
    ${spinsTable.mbid} not in (${userLibMbids})
    and (
      ${recordingReleaseGroupsTable.releaseGroupMbid} is null
      or ${recordingReleaseGroupsTable.releaseGroupMbid} not in (${userLibRgs})
    )
  )`;

  const artistMatch = sql`(
    ${recordingsTable.artist} !~* ${JUNK_ARTIST_SQL_RE}
    and (
      ${recordingsTable.artistMbid} in (${userLibArtists})
      or lower(trim(${recordingsTable.artist})) in (${userSoftArtists})
      or lower(trim(${recordingsTable.artist})) in (${userSeedArtists})
    )
  )`;

  // ── Unbounded query — no playedAt WHERE clause ────────────────────────────
  const rows = await db
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
      ),
    )
    .groupBy(stationsTable.id, stationsTable.slug)
    .having(
      sql`count(*) filter (where ${libHit}) > 0
       or count(*) filter (where ${notLibHit} and ${artistMatch}) > 0`,
    );

  const data = rows.map((r) => ({
    stationSlug: r.stationSlug,
    lifetimeCrossings: r.lifetimeCrossings,
    lifetimeArtistCrossings: r.lifetimeArtistCrossings,
  }));

  await db
    .insert(lifetimeCrossingsCacheTable)
    .values({ userId, data, builtAt: new Date() })
    .onConflictDoUpdate({
      target: lifetimeCrossingsCacheTable.userId,
      set: { data, builtAt: new Date() },
    });
}

/**
 * Schedule a lifetime-crossings refresh for `userId`.
 *
 * Debounced: if a refresh is already pending for this user, this call is a
 * no-op. The background job runs after a short delay so rapid successive calls
 * (e.g. multiple import chunks completing) collapse into one computation.
 *
 * Fire-and-forget — never surfaces errors to the caller.
 */
export function scheduleLifetimeCrossingsRefresh(userId: number): void {
  if (pendingRefresh.has(userId)) return;
  pendingRefresh.add(userId);
  setTimeout(() => {
    pendingRefresh.delete(userId);
    void computeLifetimeCrossingsForUser(userId).catch((err) => {
      console.error(`[lifetime-crossings] background refresh failed for user=${userId}`, err);
    });
  }, 5_000); // 5-second debounce — collapses rapid successive busts
}

// ---------------------------------------------------------------------------
// Daily background scheduler
// ---------------------------------------------------------------------------

/** Returns the IDs of all users who have any library evidence (mbid or taste seed). */
async function getUsersWithLibraryData(): Promise<number[]> {
  const rows = await db.execute<{ user_id: number }>(sql`
    select distinct user_id from (
      select user_id from library_items
      union
      select user_id from spotify_library_items where mbid is null and artist <> ''
      union
      select user_id from taste_seeds
    ) t
  `);
  return rows.rows.map((r) => r.user_id);
}

/**
 * Run one pass of the lifetime-crossings background job.
 * Processes users one at a time with a short yield between each to avoid
 * saturating the DB connection pool.
 */
async function runLifetimeCrossingsPass(): Promise<void> {
  const userIds = await getUsersWithLibraryData();
  console.info(`[lifetime-crossings] refreshing ${userIds.length} user(s)`);
  let succeeded = 0;
  let failed = 0;
  for (const userId of userIds) {
    try {
      await computeLifetimeCrossingsForUser(userId);
      succeeded++;
    } catch (err) {
      failed++;
      console.error(`[lifetime-crossings] failed for user=${userId}`, err);
    }
    // Brief yield between users to avoid starving other queries.
    await new Promise((r) => setTimeout(r, 200));
  }
  console.info(`[lifetime-crossings] pass complete — ok=${succeeded} fail=${failed}`);
}

/**
 * Start the daily lifetime-crossings background job.
 *
 * Runs once at boot (after a 2-minute delay to let the server warm up) then
 * again every day at 03:00 UTC.  The 03:00 UTC slot avoids the quality
 * recompute job that runs at 02:00 UTC.
 */
export function startLifetimeCrossingsJob(): void {
  const BOOT_DELAY_MS = 2 * 60 * 1000; // 2 minutes

  function msUntilNextRun(): number {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(3, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
  }

  const runOnce = async () => {
    console.info("[lifetime-crossings] starting daily pass");
    try {
      await runLifetimeCrossingsPass();
    } catch (err) {
      console.error("[lifetime-crossings] daily pass failed", err);
    }
  };

  const scheduleNext = () => {
    const delay = msUntilNextRun();
    console.info(
      `[lifetime-crossings] next pass in ${Math.round((delay / 3_600_000) * 10) / 10}h (03:00 UTC)`,
    );
    setTimeout(() => {
      void runOnce().then(scheduleNext);
    }, delay);
  };

  // Boot run after warm-up delay, then align subsequent runs to 03:00 UTC.
  setTimeout(() => {
    void runOnce().then(scheduleNext);
  }, BOOT_DELAY_MS);
}
