// Pure-unit test setup. These tests exercise side-effect-free helpers only
// (key normalization, duration gating, adapter parsers, segue derivation), so
// they never open a DB connection. We still provide a dummy DATABASE_URL because
// the db package constructs a lazy connection Pool at module load — the Pool is
// created but never queried in these tests.
//
// ── Test conventions ──────────────────────────────────────────────────────────
// See TEST_CONVENTIONS.md in this directory for the full authoring guide.
// Key rule: any function that scans a DB table without a userId predicate
// (a "global-scan function") must be called with its `_testUserIds` scope
// hook so it doesn't touch rows from other concurrently-running test files.
// Forgetting the hook causes tests that pass in isolation to flake in CI.
// ─────────────────────────────────────────────────────────────────────────────
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
