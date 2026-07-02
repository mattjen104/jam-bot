// Pure-unit test setup. These tests exercise side-effect-free helpers only
// (key normalization, duration gating, adapter parsers, segue derivation), so
// they never open a DB connection. We still provide a dummy DATABASE_URL because
// the db package constructs a lazy connection Pool at module load — the Pool is
// created but never queried in these tests.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.MUSICBRAINZ_CONTACT ??= "test@example.com";
