// Per-worker test setup.  These tests exercise side-effect-free helpers only
// (key normalization, duration gating, adapter parsers, segue derivation), so
// they never open a DB connection.  We still provide a dummy DATABASE_URL
// because the db package constructs a lazy connection Pool at module load —
// the Pool is created but never queried in these tests.
//
// ── Test conventions ──────────────────────────────────────────────────────────
// See TEST_CONVENTIONS.md in this directory for the full authoring guide.
// Key rule: any function that scans a DB table without a userId predicate
// (a "global-scan function") must be called with its `_testUserIds` scope
// hook so it doesn't touch rows from other concurrently-running test files.
// Forgetting the hook causes tests that pass in isolation to flake in CI.
// ─────────────────────────────────────────────────────────────────────────────
//
// DDL migrations (selector_claims, spotify_library_items) are intentionally
// NOT run here.  They are run exactly once in test/globalSetup.ts, which
// executes in the main thread before any worker starts.  Running them in every
// worker's beforeAll caused DDL lock contention that flaked DB-heavy tests
// when the full suite ran in parallel.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.MUSICBRAINZ_CONTACT ??= "test@example.com";
