/**
 * Vitest globalSetup — runs once in the main thread before any worker starts.
 *
 * Why this exists
 * ---------------
 * The full 86-file test suite runs worker files in parallel.  Both migration
 * functions use `CREATE TABLE / INDEX IF NOT EXISTS`, which acquires an
 * AccessShareLock on the catalog.  When 86 workers all fire these DDL
 * statements simultaneously they queue behind each other and cause timeout
 * spikes that flake DB-heavy tests.  Running the migrations exactly once here,
 * before any worker is spawned, eliminates that contention entirely.
 */

export async function setup(): Promise<() => Promise<void>> {
  // Provide a fallback URL so the db module doesn't throw when no real DB is
  // configured (pure-unit environments).  The real DATABASE_URL from the
  // Replit environment takes precedence.
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  process.env.MUSICBRAINZ_CONTACT ??= "test@example.com";

  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`select 1`);
  } catch {
    return async () => {};
  }

  {
    const { applyRssArticlesMigration } = await import(
      "../src/lore/rss-articles-migration.js"
    );
    await applyRssArticlesMigration();

    const { applyPlaybackHealthMigration } = await import(
      "../src/lore/playback-health-migration.js"
    );
    await applyPlaybackHealthMigration();

    // Ensures crossing_eligible column exists — required by any test that
    // inserts into stationsTable after the schema added this column.
    const { applyStationDiscoveryMigration } = await import(
      "../src/lore/station-migration.js"
    );
    await applyStationDiscoveryMigration();

    const { applyMigrationCompletionsMigration } = await import(
      "../src/lore/migration-completions-migration.js"
    );
    await applyMigrationCompletionsMigration();

    const { applyStationScheduleMigration } = await import(
      "../src/lore/station-schedule-migration.js"
    );
    await applyStationScheduleMigration();

    const { applySelectorClaimsMigration } = await import(
      "../src/lore/selector-claims-migration.js"
    );
    await applySelectorClaimsMigration();

    const { applySpotifyLibraryItemsMigration } = await import(
      "../src/lore/spotify-library-items-migration.js"
    );
    await applySpotifyLibraryItemsMigration();

    const { applyLibraryRemovedMigration } = await import(
      "../src/lore/library-removed-migration.js"
    );
    await applyLibraryRemovedMigration();

    const { applyAttendanceMigration } = await import(
      "../src/lore/attendance-migration.js"
    );
    await applyAttendanceMigration();

    const { applyBottlesMigration } = await import(
      "../src/lore/bottles-migration.js"
    );
    await applyBottlesMigration();

    const { applyReplayResolutionMigration } = await import(
      "../src/lore/replay-resolution-migration.js"
    );
    await applyReplayResolutionMigration();

    const { applyCrossingsCacheMigration } = await import(
      "../src/lore/crossings-cache-migration.js"
    );
    await applyCrossingsCacheMigration();

    const { applyBlendedCrossingsPerformanceIndexMigration } = await import(
      "../src/lore/blended-crossings-performance-index-migration.js"
    );
    await applyBlendedCrossingsPerformanceIndexMigration();

    const { applySpinsPlayedAtIndexMigration } = await import(
      "../src/lore/spins-played-at-index-migration.js"
    );
    await applySpinsPlayedAtIndexMigration();

    const { applySpinDurationMigration } = await import(
      "../src/lore/spin-duration-migration.js"
    );
    await applySpinDurationMigration();

    const { applyLifetimeCrossingsMigration } = await import(
      "../src/lore/lifetime-crossings-migration.js"
    );
    await applyLifetimeCrossingsMigration();

    // Ensures sleep_mode column exists — required by any test that inserts
    // into stationsTable after the schema added this column.
    const { applySleepStationsMigration } = await import(
      "../src/lore/sleep-stations-migration.js"
    );
    await applySleepStationsMigration();

    // Ensures era_genre_mode column exists — required by any test that inserts
    // into stationsTable after the schema added this column. Runs after the
    // sleep migration to mirror the boot precedence order.
    const { applyEraGenreStationsMigration } = await import(
      "../src/lore/era-genre-stations-migration.js"
    );
    await applyEraGenreStationsMigration();

    // Ensures year_checked_at column exists — required by any test that
    // inserts into recordingsTable after the schema added this column.
    const { applyReleaseYearMigration } = await import(
      "../src/lore/release-year-migration.js"
    );
    await applyReleaseYearMigration();
    const { applyStationRecentProfileMigration } = await import(
      "../src/lore/station-recent-profile-migration.js"
    );
    await applyStationRecentProfileMigration();
    const { applyGenreEnrichmentMigration } = await import(
      "../src/lore/genre-enrichment-migration.js"
    );
    await applyGenreEnrichmentMigration();
    // Ensures the lyric evidence columns and durable station-audit table exist
    // before any worker inserts recordings using the current Drizzle schema.
    const { applyInstrumentalAuditMigration } = await import(
      "../src/lore/instrumental-audit-migration.js"
    );
    await applyInstrumentalAuditMigration();

    // Ensures release_date / release_date_checked_at columns exist — required
    // by any test that reads recordings.releaseDate after the schema added
    // them. Runs after the release-year migration to mirror boot order.
    const { applyReleaseDateMigration } = await import(
      "../src/lore/release-date-migration.js"
    );
    await applyReleaseDateMigration();

    // Ensures spins.observed_at exists — required by any test that inserts
    // into spinsTable with an explicit observation timestamp (freshness /
    // fast-lane coverage).
    const { applySpinObservedAtMigration } = await import(
      "../src/lore/spin-observed-at-migration.js"
    );
    await applySpinObservedAtMigration();

    const { applySpinPlayOffsetMigration } = await import(
      "../src/lore/spin-play-offset-migration.js"
    );
    await applySpinPlayOffsetMigration();

    const { applyObservabilityMigration } = await import(
      "../src/lore/observability-migration.js"
    );
    await applyObservabilityMigration();

    // Ensures artist_events / artist_events_cache exist — required by the
    // Shows lens read-model tests (me-shows-db).
    const { applyArtistEventsMigration } = await import(
      "../src/lore/artist-events-migration.js"
    );
    await applyArtistEventsMigration();

    // Ensures station_exclusions exists — required by the permanent-removal
    // endpoint tests and by upsertRadioBrowserStations' exclusion lookup.
    const { applyStationExclusionsMigration } = await import(
      "../src/lore/station-exclusions-migration.js"
    );
    await applyStationExclusionsMigration();

    const { cleanupStationFixtures } = await import(
      "../src/lore/station-fixture-audit.js"
    );
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    await cleanupStationFixtures();
    const before = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM stations
      WHERE active = true AND hidden = false
    `);
    const visibleBefore = Number(before.rows[0]?.count ?? 0);

    return async () => {
      await cleanupStationFixtures();
      const after = await db.execute<{ count: string }>(sql`
        SELECT count(*)::text AS count
        FROM stations
        WHERE active = true AND hidden = false
      `);
      const visibleAfter = Number(after.rows[0]?.count ?? 0);
      if (visibleAfter > visibleBefore) {
        throw new Error(
          `API test suite leaked ${visibleAfter - visibleBefore} active visible station row(s)`,
        );
      }

      // End the pools opened by the migration/cleanup work above: an idle pg
      // client keeps the event loop alive (idleTimeoutMillis races vitest's
      // close timeout) and flakes the run with "something prevents Vite server
      // from exiting" (exit 1 despite all tests passing).
      const { pool, listenerReadPool } = await import("@workspace/db");
      await Promise.allSettled([pool.end(), listenerReadPool.end()]);
    };
  }
}
