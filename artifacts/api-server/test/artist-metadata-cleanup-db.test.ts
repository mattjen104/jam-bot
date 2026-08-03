// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, inArray } from "drizzle-orm";
import {
  db,
  stationsTable,
  spinsTable,
  recordingsTable,
  resolutionCacheTable,
} from "@workspace/db";
import {
  applyArtistMetadataCleanup,
  applyResolutionCollisionCleanup,
  applySyntheticUrlArtistCleanup,
  applyUrlArtistRepair,
} from "../src/lore/artist-metadata-cleanup.js";
import { applyMigrationCompletionsMigration } from "../src/lore/migration-completions-migration.js";

/**
 * Integration tests for applyArtistMetadataCleanup.
 *
 * Each test seeds its own isolated recordings/spins and cleans up afterwards.
 * The completion-ledger row is deleted between tests so each test exercises
 * the full migration path.  Tests skip gracefully when no DB is reachable.
 */

const run = randomUUID().slice(0, 8);
const SLUG = `test-amc-${run}`;

let dbAvailable = false;
let stationId: number | undefined;

// ── Shared setup / teardown ────────────────────────────────────────────────

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await applyMigrationCompletionsMigration();

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG,
      name: `Test ArtistMetadataCleanup ${run}`,
      streamUrl: "http://example.invalid/amc",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !stationId) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, [stationId]));
  await db.execute(sql`DELETE FROM station_quality WHERE station_id = ${stationId}`);
  await db.delete(stationsTable).where(inArray(stationsTable.id, [stationId]));
  await db.execute(
    sql`DELETE FROM migration_completions WHERE name IN ('applyArtistMetadataCleanup', 'applyUrlArtistRepair', 'applySyntheticUrlArtistCleanup', 'applyResolutionCollisionCleanup')`,
  );
}, 30_000);

/** Remove the completion-ledger rows before each test so the migrations rerun. */
beforeEach(async () => {
  if (!dbAvailable) return;
  await db.execute(
    sql`DELETE FROM migration_completions WHERE name IN ('applyArtistMetadataCleanup', 'applyUrlArtistRepair', 'applySyntheticUrlArtistCleanup', 'applyResolutionCollisionCleanup')`,
  );
}, 10_000);

// ── Helpers ────────────────────────────────────────────────────────────────

/** Insert a test recording with the given artist, returning its mbid. */
async function insertRecording(artist: string, title: string): Promise<string> {
  const mbid = `test-amc-${run}-${randomUUID().slice(0, 8)}`;
  await db.insert(recordingsTable).values({
    mbid,
    artist,
    title,
    confidence: "text",
  } as Parameters<typeof db.insert>[0] extends infer T ? never : never).catch(
    // Use raw SQL to avoid TypeScript fussing about the interface
    () => undefined,
  );
  // Use execute directly to avoid type complexity
  await db.execute(
    sql`INSERT INTO recordings (mbid, artist, title)
        VALUES (${mbid}, ${artist}, ${title})
        ON CONFLICT (mbid) DO NOTHING`,
  );
  return mbid;
}

/** Read the current artist value for a recording. */
async function getArtist(mbid: string): Promise<string | null> {
  const [row] = await db
    .select({ artist: recordingsTable.artist })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);
  return row?.artist ?? null;
}

/** Insert a spin referencing an MBID. */
async function insertSpin(
  mbid: string,
  source: string,
  rawArtist: string,
  rawTitle: string,
): Promise<number> {
  const [row] = await db
    .insert(spinsTable)
    .values({
      stationId: stationId!,
      mbid,
      rawArtist,
      rawTitle,
      confidence: "text",
      source,
      playedAt: new Date(),
    })
    .returning({ id: spinsTable.id });
  return row!.id;
}

/** Delete all recordings created by this test run. */
async function deleteTestRecordings(mbids: string[]): Promise<void> {
  if (!mbids.length) return;
  // Spins referencing these recordings must be NULLed first.
  // Use sql.join to build a proper ANY(ARRAY[...]) expression.
  const mbidLiterals = mbids.map((m) => sql`${m}`);
  const joined = sql.join(mbidLiterals, sql`, `);
  await db.execute(
    sql`UPDATE spins SET mbid = NULL WHERE mbid = ANY(ARRAY[${joined}]::text[])`,
  );
  await db.execute(
    sql`DELETE FROM recordings WHERE mbid = ANY(ARRAY[${joined}]::text[])`,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("applyArtistMetadataCleanup", () => {
  it(
    "strips a leading dash from recordings.artist",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      const mbid = await insertRecording("- Nina Simone", "Strange Fruit");
      // Attach a live-polled spin so this recording is NOT in the protected set
      const spinId = await insertSpin(mbid, "spinitron", "- Nina Simone", "Strange Fruit");

      try {
        const result = await applyArtistMetadataCleanup({ _testMbids: [mbid] });

        expect(result.leadingDashFixed).toBe(1);
        expect(await getArtist(mbid)).toBe("Nina Simone");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  it(
    "strips a leading en-dash from recordings.artist",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      const mbid = await insertRecording("– The Beatles", "Let It Be");
      const spinId = await insertSpin(mbid, "kexp", "– The Beatles", "Let It Be");

      try {
        const result = await applyArtistMetadataCleanup({ _testMbids: [mbid] });

        expect(result.leadingDashFixed).toBe(1);
        expect(await getArtist(mbid)).toBe("The Beatles");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  it(
    "does NOT modify a recording that only has manual/backfill spins",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      const mbid = await insertRecording("- Protected Artist", "Protected Song");
      // Spin with source='manual' — protected from automatic correction
      const spinId = await insertSpin(mbid, "manual", "- Protected Artist", "Protected Song");

      try {
        await applyArtistMetadataCleanup({ _testMbids: [mbid] });
        // The artist should NOT have been changed
        expect(await getArtist(mbid)).toBe("- Protected Artist");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  it(
    "does NOT modify a recording with a clean artist (no leading dash)",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      const mbid = await insertRecording("Paul Simon", "You Can Call Me Al");
      const spinId = await insertSpin(mbid, "spinitron", "Paul Simon", "You Can Call Me Al");

      try {
        const result = await applyArtistMetadataCleanup({ _testMbids: [mbid] });
        expect(result.leadingDashFixed).toBe(0);
        expect(await getArtist(mbid)).toBe("Paul Simon");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  it(
    "is idempotent: a second call is a no-op (completion ledger)",
    { timeout: 60_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      const mbid = await insertRecording("- Idempotent Artist", "Idempotent Song");
      const spinId = await insertSpin(mbid, "kexp", "- Idempotent Artist", "Idempotent Song");

      try {
        // First call — does the work
        const first = await applyArtistMetadataCleanup({ _testMbids: [mbid] });
        expect(first.leadingDashFixed).toBe(1);
        expect(await getArtist(mbid)).toBe("Idempotent Artist");

        // Second call — completion ledger gates it out immediately
        const second = await applyArtistMetadataCleanup({ _testMbids: [mbid] });
        expect(second.leadingDashFixed).toBe(0);
        expect(second.cacheEntriesPurged).toBe(0);

        // Artist must still be the cleaned value (not reverted)
        expect(await getArtist(mbid)).toBe("Idempotent Artist");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  it(
    "completion ledger row is present after a successful run",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      await applyArtistMetadataCleanup({});

      const ledger = await db.execute(
        sql`SELECT name FROM migration_completions WHERE name = 'applyArtistMetadataCleanup'`,
      );
      expect(ledger.rows.length).toBe(1);
    },
  );

  it(
    "uncertain recordings with no clear junk pattern are left unchanged",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // Valid Cyrillic artist — must never be touched
      const mbid = await insertRecording("Кино", "Группа крови");
      const spinId = await insertSpin(mbid, "spinitron", "Кино", "Группа крови");

      try {
        const result = await applyArtistMetadataCleanup({ _testMbids: [mbid] });
        expect(result.leadingDashFixed).toBe(0);
        expect(await getArtist(mbid)).toBe("Кино");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  // ── Non-Latin script regression tests ──────────────────────────────────────
  //
  // The dash-cleanup regex `'^[-–—]+'` targets only ASCII hyphen, en-dash, and
  // em-dash.  Artists whose names begin with Arabic, Cyrillic, Japanese, or
  // CJK-punctuation characters that merely *look* like dashes must survive the
  // migration completely unchanged.

  it(
    "non-Latin: Arabic artist فيروز is not modified",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // فيروز (Fairuz) — begins with the Arabic letter ف, nowhere near [-–—]
      const mbid = await insertRecording("فيروز", "سألتك الرحيل");
      const spinId = await insertSpin(mbid, "spinitron", "فيروز", "سألتك الرحيل");

      try {
        const result = await applyArtistMetadataCleanup({ _testMbids: [mbid] });
        expect(result.leadingDashFixed).toBe(0);
        expect(await getArtist(mbid)).toBe("فيروز");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  it(
    "non-Latin: Cyrillic artist Кино is not modified",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // Кино — begins with Cyrillic К, unrelated to ASCII/Unicode dashes
      const mbid = await insertRecording("Кино", "Пачка сигарет");
      const spinId = await insertSpin(mbid, "spinitron", "Кино", "Пачка сигарет");

      try {
        const result = await applyArtistMetadataCleanup({ _testMbids: [mbid] });
        expect(result.leadingDashFixed).toBe(0);
        expect(await getArtist(mbid)).toBe("Кино");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  it(
    "non-Latin: Japanese artist 坂本龍一 is not modified",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // 坂本龍一 (Ryuichi Sakamoto) — starts with CJK ideograph, not a dash
      const mbid = await insertRecording("坂本龍一", "Merry Christmas Mr. Lawrence");
      const spinId = await insertSpin(mbid, "spinitron", "坂本龍一", "Merry Christmas Mr. Lawrence");

      try {
        const result = await applyArtistMetadataCleanup({ _testMbids: [mbid] });
        expect(result.leadingDashFixed).toBe(0);
        expect(await getArtist(mbid)).toBe("坂本龍一");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  it(
    "non-Latin: artist starting with CJK fullwidth minus ー is not modified",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // ー is the Katakana-Hiragana Prolonged Sound Mark (U+30FC) — visually
      // similar to an em-dash but NOT in the regex set `[-–—]`.
      // This confirms the pattern boundary is tight and does not over-match
      // CJK-specific punctuation that merely resembles a Western dash.
      const mbid = await insertRecording("ーゆず", "栄光の架橋");
      const spinId = await insertSpin(mbid, "spinitron", "ーゆず", "栄光の架橋");

      try {
        const result = await applyArtistMetadataCleanup({ _testMbids: [mbid] });
        expect(result.leadingDashFixed).toBe(0);
        expect(await getArtist(mbid)).toBe("ーゆず");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  it(
    "purges resolution-cache entries with URL/domain-like keys",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      // Insert a cache entry that looks like a domain artist
      // normalized key: "wellsfargo com\x1Fsome song"
      const cacheKey = `wellsfargo com\x1Fsome song`;
      await db.execute(
        sql`INSERT INTO resolution_cache (key, mbid, confidence)
            VALUES (${cacheKey}, NULL, 'unresolved')
            ON CONFLICT (key) DO UPDATE SET mbid = NULL, confidence = 'unresolved'`,
      );

      try {
        const result = await applyArtistMetadataCleanup({});

        // The cache entry should have been purged
        expect(result.cacheEntriesPurged).toBeGreaterThanOrEqual(1);

        const remaining = await db.execute(
          sql`SELECT 1 FROM resolution_cache WHERE key = ${cacheKey} LIMIT 1`,
        );
        expect(remaining.rows.length).toBe(0);
      } finally {
        // Clean up in case the migration didn't delete it
        await db.execute(
          sql`DELETE FROM resolution_cache WHERE key = ${cacheKey}`,
        );
        await db.execute(
          sql`DELETE FROM migration_completions WHERE name = 'applyArtistMetadataCleanup'`,
        );
      }
    },
  );
});

// ── applyUrlArtistRepair ───────────────────────────────────────────────────

describe("applyUrlArtistRepair", () => {
  /**
   * Helper: read the completion-ledger row for the URL repair migration.
   * Returns true if the row is present.
   */
  async function hasUrlRepairCompletion(): Promise<boolean> {
    const rows = await db.execute(
      sql`SELECT 1 FROM migration_completions WHERE name = 'applyUrlArtistRepair' LIMIT 1`,
    );
    return (rows.rows?.length ?? 0) > 0;
  }

  /**
   * Insert a recording with an explicit MBID (used when UUID shape matters).
   * Falls back to the shared `insertRecording` helper when no MBID is given.
   */
  async function insertRecordingWithMbid(
    mbid: string,
    artist: string,
    title: string,
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO recordings (mbid, artist, title)
      VALUES (${mbid}, ${artist}, ${title})
      ON CONFLICT (mbid) DO NOTHING
    `);
  }

  it(
    "does NOT modify a recording with a clean artist (no URL/domain)",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // insertRecording uses a non-UUID test MBID — no real-UUID URL candidates
      // → MB gate never fires → completion IS written deterministically.
      const mbid = await insertRecording("Radiohead", "Karma Police");
      const spinId = await insertSpin(mbid, "spinitron", "Radiohead", "Karma Police");

      try {
        const result = await applyUrlArtistRepair({ _testMbids: [mbid] });
        expect(result.urlArtistFixed).toBe(0);
        expect(result.urlArtistSkippedSynthetic).toBe(0);
        expect(await getArtist(mbid)).toBe("Radiohead");
        // No real-UUID URL candidates → completion IS written
        expect(await hasUrlRepairCompletion()).toBe(true);
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([mbid]);
      }
    },
  );

  it(
    "sanitizes a sp: synthetic MBID with a domain artist",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // sp: MBIDs are not valid UUIDs — permanently non-repairable via MB.
      // They must not block the migration from completing.
      const syntheticMbid = `sp:test-url-repair-${run}`;
      await insertRecordingWithMbid(syntheticMbid, "wellsfargo.com", "Unknown Song");
      const spinId = await insertSpin(syntheticMbid, "spinitron", "wellsfargo.com", "Unknown Song");

      try {
        const result = await applyUrlArtistRepair({ _testMbids: [syntheticMbid] });
        expect(result.urlArtistSkippedSynthetic).toBe(1);
        expect(result.urlArtistFixed).toBe(0);
        // The dedicated synthetic cleanup is what repairs a deployment where
        // URL artist repair already completed before this guard existed.
        await db.execute(
          sql`DELETE FROM migration_completions WHERE name = 'applySyntheticUrlArtistCleanup'`,
        );
        const cleanup = await applySyntheticUrlArtistCleanup({ _testMbids: [syntheticMbid] });
        expect(cleanup.recordingsSanitized).toBe(1);
        expect(await getArtist(syntheticMbid)).toBe("Unknown artist");
        const [rawSpin] = await db.execute(
          sql`SELECT raw_artist, raw_title FROM spins WHERE id = ${spinId}`,
        ).then((result) => result.rows as Array<{ raw_artist: string; raw_title: string }>);
        expect(rawSpin).toEqual({
          raw_artist: "wellsfargo.com",
          raw_title: "Unknown Song",
        });
        const secondCleanup = await applySyntheticUrlArtistCleanup({ _testMbids: [syntheticMbid] });
        expect(secondCleanup.recordingsSanitized).toBe(0);
        expect(await hasUrlRepairCompletion()).toBe(true);
        const completion = await db.execute(
          sql`SELECT 1 FROM migration_completions WHERE name = 'applySyntheticUrlArtistCleanup'`,
        );
        expect(completion.rows.length).toBe(1);
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await db.execute(sql`UPDATE spins SET mbid = NULL WHERE mbid = ${syntheticMbid}`);
        await db.execute(sql`DELETE FROM recordings WHERE mbid = ${syntheticMbid}`);
      }
    },
  );

  it(
    "does not sanitize a valid international artist",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      const mbid = `sp:test-valid-international-${run}`;
      await insertRecordingWithMbid(mbid, "坂本龍一", "Merry Christmas Mr. Lawrence");
      const spinId = await insertSpin(mbid, "spinitron", "坂本龍一", "Merry Christmas Mr. Lawrence");

      try {
        const result = await applySyntheticUrlArtistCleanup({ _testMbids: [mbid] });
        expect(result.recordingsSanitized).toBe(0);
        expect(await getArtist(mbid)).toBe("坂本龍一");
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await db.execute(sql`DELETE FROM recordings WHERE mbid = ${mbid}`);
      }
    },
  );

  it(
    "detaches only legacy spins mismatched through the non-Latin cache collision",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      const mbid = `test-collision-${run}`;
      await insertRecordingWithMbid(mbid, "Камелия", "Луда по тебе");
      const matchingSpinId = await insertSpin(mbid, "spinitron", "Камелия", "Луда по тебе");
      const mismatchedSpinId = await insertSpin(mbid, "spinitron", "Кино", "Группа крови");

      try {
        await db.execute(sql`DELETE FROM resolution_cache WHERE key = ${"\u001f"}`);
        await db.insert(resolutionCacheTable).values({
          key: "\u001f",
          mbid,
          confidence: "text",
        });
        const result = await applyResolutionCollisionCleanup({ _testMbids: [mbid] });
        expect(result.spinsDetached).toBe(1);
        expect(result.cacheEntriesPurged).toBe(1);

        const rows = await db.execute<{ id: number; mbid: string | null }>(sql`
          SELECT id, mbid FROM spins WHERE id IN (${matchingSpinId}, ${mismatchedSpinId}) ORDER BY id
        `);
        expect(rows.rows).toEqual([
          { id: matchingSpinId, mbid },
          { id: mismatchedSpinId, mbid: null },
        ]);
        expect((await applyResolutionCollisionCleanup({ _testMbids: [mbid] })).spinsDetached).toBe(0);
      } finally {
        await db.execute(sql`DELETE FROM resolution_cache WHERE key = ${"\u001f"}`);
        await db.execute(sql`DELETE FROM spins WHERE id IN (${matchingSpinId}, ${mismatchedSpinId})`);
        await db.execute(sql`DELETE FROM recordings WHERE mbid = ${mbid}`);
      }
    },
  );

  it(
    "recognizes collision-era contamination even after its cache key was purged",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      const mbid = "a7c3b123-1234-4abc-9def-123456789abc";
      await insertRecordingWithMbid(mbid, "Камелия", "Луда по тебе");
      const canonicalSpinId = await insertSpin(mbid, "spinitron", "Камелия", "Луда по тебе");
      const mismatchedIds = await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          insertSpin(mbid, "spinitron", `Артист ${index}`, `Песня ${index}`),
        ),
      );

      try {
        const result = await applyResolutionCollisionCleanup();
        expect(result.spinsDetached).toBe(24);

        const rows = await db.execute<{ id: number; mbid: string | null }>(sql`
          SELECT id, mbid FROM spins WHERE id IN (${canonicalSpinId}, ${sql.join(mismatchedIds.map((id) => sql`${id}`), sql`, `)}) ORDER BY id
        `);
        expect(rows.rows.filter((row) => row.id === canonicalSpinId)).toEqual([{ id: canonicalSpinId, mbid }]);
        expect(rows.rows.filter((row) => row.id !== canonicalSpinId).every((row) => row.mbid === null)).toBe(true);
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id IN (${canonicalSpinId}, ${sql.join(mismatchedIds.map((id) => sql`${id}`), sql`, `)})`);
        await db.execute(sql`DELETE FROM recordings WHERE mbid = ${mbid}`);
      }
    },
  );

  it(
    "defers completion when _testMbEnabled=false and a real-UUID domain-artist candidate exists",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // Use a real UUID-format MBID so the candidate is classified as
      // "real UUID" — requires MB to repair.  _testMbEnabled=false simulates
      // a deploy where MB is not yet configured, deterministically regardless
      // of whether MUSICBRAINZ_CONTACT is set in this environment.
      const uuidMbid = randomUUID();
      await insertRecordingWithMbid(uuidMbid, "sponsor.example.fm", "Ad Break");
      const spinId = await insertSpin(uuidMbid, "spinitron", "sponsor.example.fm", "Ad Break");

      try {
        const result = await applyUrlArtistRepair({
          _testMbids: [uuidMbid],
          _testMbEnabled: false, // simulate MB not configured
        });
        // MB not available → deferred, nothing fixed
        expect(result.urlArtistFixed).toBe(0);
        expect(result.urlArtistSkippedSynthetic).toBe(0);
        // Artist value preserved — migration never blanks a row
        expect(await getArtist(uuidMbid)).toBe("sponsor.example.fm");
        // Completion row MUST NOT be written — the next boot must retry
        expect(await hasUrlRepairCompletion()).toBe(false);
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([uuidMbid]);
      }
    },
  );

  it(
    "defers completion when _testMbEnabled=false and an https:// artist real-UUID candidate exists",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      const uuidMbid = randomUUID();
      await insertRecordingWithMbid(uuidMbid, "https://ads.example.com", "Promo Clip");
      const spinId = await insertSpin(uuidMbid, "kexp", "https://ads.example.com", "Promo Clip");

      try {
        const result = await applyUrlArtistRepair({
          _testMbids: [uuidMbid],
          _testMbEnabled: false,
        });
        expect(result.urlArtistFixed).toBe(0);
        expect(result.urlArtistSkippedSynthetic).toBe(0);
        expect(await getArtist(uuidMbid)).toBe("https://ads.example.com");
        // Completion row absent — will retry next boot
        expect(await hasUrlRepairCompletion()).toBe(false);
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([uuidMbid]);
      }
    },
  );

  it(
    "proceeds and writes completion when _testMbEnabled=true even if MB returns no artist (genuine miss)",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // Real UUID MBID that does not exist in MB.  With MB enabled the
      // migration tries the lookup, gets null back (404 / not configured), and
      // leaves the row unchanged.  Completion IS written because the pass
      // ran to the end — a genuine MB miss should not block future boots.
      const uuidMbid = randomUUID();
      await insertRecordingWithMbid(uuidMbid, "sponsor.example.io", "Junk Clip");
      const spinId = await insertSpin(uuidMbid, "spinitron", "sponsor.example.io", "Junk Clip");

      try {
        const result = await applyUrlArtistRepair({
          _testMbids: [uuidMbid],
          _testMbEnabled: true, // MB "available"; fetchRecordingCredits returns null for unknown UUID
        });
        // fetchRecordingCredits returns null for a non-existent recording →
        // row left unchanged, not counted as fixed
        expect(result.urlArtistFixed).toBe(0);
        expect(result.urlArtistSkippedSynthetic).toBe(0);
        expect(await getArtist(uuidMbid)).toBe("sponsor.example.io");
        // Completion IS written — MB was enabled and the pass completed
        expect(await hasUrlRepairCompletion()).toBe(true);
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([uuidMbid]);
      }
    },
  );

  it(
    "does NOT modify a domain-artist recording that only has manual/backfill spins",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // Source-protected recording — excluded from candidates by the SQL WHERE
      // clause regardless of MBID shape.
      const uuidMbid = randomUUID();
      await insertRecordingWithMbid(uuidMbid, "protected.com", "Protected Track");
      const spinId = await insertSpin(uuidMbid, "manual", "protected.com", "Protected Track");

      try {
        const result = await applyUrlArtistRepair({
          _testMbids: [uuidMbid],
          _testMbEnabled: true,
        });
        // Excluded from candidates → real-UUID list is empty → MB gate does
        // not fire → completion IS written (nothing to defer)
        expect(result.urlArtistFixed).toBe(0);
        expect(result.urlArtistSkippedSynthetic).toBe(0);
        expect(await getArtist(uuidMbid)).toBe("protected.com");
        expect(await hasUrlRepairCompletion()).toBe(true);
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await deleteTestRecordings([uuidMbid]);
      }
    },
  );

  it(
    "is idempotent: a second call is a no-op once the completion ledger is written",
    { timeout: 60_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // Use a sp: synthetic MBID so completion IS written on the first call
      // (sp: candidates are non-UUID, never block completion, no MB needed).
      const syntheticMbid = `sp:test-url-idem-${run}`;
      await insertRecordingWithMbid(syntheticMbid, "idem-sponsor.com", "Idem Ad");
      const spinId = await insertSpin(syntheticMbid, "kexp", "idem-sponsor.com", "Idem Ad");

      try {
        // First call — sp: candidate found, skipped, completion written
        const first = await applyUrlArtistRepair({ _testMbids: [syntheticMbid] });
        expect(first.urlArtistSkippedSynthetic).toBe(1);
        expect(await hasUrlRepairCompletion()).toBe(true);

        // Second call — completion ledger gates it out immediately
        const second = await applyUrlArtistRepair({ _testMbids: [syntheticMbid] });
        expect(second.urlArtistFixed).toBe(0);
        expect(second.urlArtistSkippedSynthetic).toBe(0);
      } finally {
        await db.execute(sql`DELETE FROM spins WHERE id = ${spinId}`);
        await db.execute(sql`UPDATE spins SET mbid = NULL WHERE mbid = ${syntheticMbid}`);
        await db.execute(sql`DELETE FROM recordings WHERE mbid = ${syntheticMbid}`);
      }
    },
  );

  it(
    "completion ledger row is written when there are no real-UUID URL-artist candidates",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      // A recording with a clean artist passes the _testMbids filter but is
      // not a URL/domain candidate — no real-UUID URL candidates → MB gate
      // never fires → completion IS written.
      const safeMbid = await insertRecording("Clean Artist No URL", "Clean Song");
      try {
        await applyUrlArtistRepair({ _testMbids: [safeMbid] });
        expect(await hasUrlRepairCompletion()).toBe(true);
      } finally {
        await deleteTestRecordings([safeMbid]);
      }
    },
  );
});
