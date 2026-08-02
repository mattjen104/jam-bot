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

export async function setup(): Promise<void> {
  // Provide a fallback URL so the db module doesn't throw when no real DB is
  // configured (pure-unit environments).  The real DATABASE_URL from the
  // Replit environment takes precedence.
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  process.env.MUSICBRAINZ_CONTACT ??= "test@example.com";

  try {
    const { applySelectorClaimsMigration } = await import(
      "../src/lore/selector-claims-migration.js"
    );
    await applySelectorClaimsMigration();

    const { applySpotifyLibraryItemsMigration } = await import(
      "../src/lore/spotify-library-items-migration.js"
    );
    await applySpotifyLibraryItemsMigration();

    const { applyAttendanceMigration } = await import(
      "../src/lore/attendance-migration.js"
    );
    await applyAttendanceMigration();

    const { applyBottlesMigration } = await import(
      "../src/lore/bottles-migration.js"
    );
    await applyBottlesMigration();
  } catch {
    // No real DB available — pure-unit environment.  Workers that need the
    // tables will skip their tests gracefully via their own dbAvailable guards.
  }
}
