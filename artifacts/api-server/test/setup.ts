// Pure-unit test setup. These tests exercise side-effect-free helpers only
// (key normalization, duration gating, adapter parsers, segue derivation), so
// they never open a DB connection. We still provide a dummy DATABASE_URL because
// the db package constructs a lazy connection Pool at module load — the Pool is
// created but never queried in these tests.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.MUSICBRAINZ_CONTACT ??= "test@example.com";

import { beforeAll } from "vitest";

beforeAll(async () => {
  // Ensure `selector_claims` exists before any test file runs queries through
  // routes or helpers that reference it.  The migration is idempotent
  // (CREATE TABLE / INDEX IF NOT EXISTS) and self-catching, so it's safe to
  // call even when no real DB is reachable — it logs and returns without
  // throwing, so pure-unit test files are unaffected.
  try {
    const { applySelectorClaimsMigration } = await import(
      "../src/lore/selector-claims-migration.js"
    );
    await applySelectorClaimsMigration();

    const { applySpotifyLibraryItemsMigration } = await import(
      "../src/lore/spotify-library-items-migration.js"
    );
    await applySpotifyLibraryItemsMigration();
  } catch {
    // No real DB — pure-unit test file, silently skip.
  }
});
