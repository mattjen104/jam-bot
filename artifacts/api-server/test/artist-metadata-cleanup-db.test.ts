// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, inArray } from "drizzle-orm";
import {
  db,
  stationsTable,
  spinsTable,
  recordingsTable,
} from "@workspace/db";
import {
  applyArtistMetadataCleanup,
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
  await db.delete(stationsTable).where(inArray(stationsTable.id, [stationId]));
  await db.execute(
    sql`DELETE FROM migration_completions WHERE name = 'applyArtistMetadataCleanup'`,
  );
}, 30_000);

/** Remove the completion-ledger row before each test so the migration reruns. */
beforeEach(async () => {
  if (!dbAvailable) return;
  await db.execute(
    sql`DELETE FROM migration_completions WHERE name = 'applyArtistMetadataCleanup'`,
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
