/**
 * @vitest-environment node
 *
 * DB-level tests for the release-year backfill batch.
 *
 * Each test uses unique MBIDs to avoid cache-key collisions across files.
 * `year_checked_at` is the convergence sentinel — the key invariant is:
 *   - Definitive answer (year found or genuine no-date) → sentinel set
 *   - Transient failure (5xx / network) → sentinel NOT set (retried later)
 *   - 4xx permanent failure → treated as no-date, sentinel set
 *   - Synthetic `sp:` MBIDs → excluded from target set, never passed to resolver
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { db, recordingsTable, spinsTable, stationsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { backfillReleaseYearBatch } from "../src/lore/release-year-backfill.js";

// ---- Resolver mock (must come before subject import) ----------------------
// vi.hoisted runs before the module graph is evaluated, so the reference is
// live when the vi.mock factory (also hoisted) calls createMbResolver().
const { mockFetchReleaseYear } = vi.hoisted(() => ({
  mockFetchReleaseYear: vi.fn<[string, AbortSignal?], Promise<number | null>>(),
}));

vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...actual,
    musicbrainzEnabled: () => true,
    createMbResolver: () => ({
      fetchReleaseYear: mockFetchReleaseYear,
      fetchIsrcByMbid: vi.fn().mockResolvedValue(null),
      resolveByIsrc: vi.fn().mockResolvedValue(null),
      resolveByText: vi.fn().mockResolvedValue(null),
      resolveByTextWithScore: vi.fn().mockResolvedValue(null),
    }),
  };
});

// ---- DB availability guard ------------------------------------------------
let dbAvailable = false;
try {
  await db.execute(sql`SELECT 1`);
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const RUN = Math.random().toString(36).slice(2, 10);
const mbid = (tag: string) => `test-rybf-${RUN}-${tag}`;
const STATION_ID_BASE = `test-rybf-${RUN}`;

// Minimal station + spin helpers
async function insertStation(slug: string): Promise<number> {
  const [row] = await db
    .insert(stationsTable)
    .values({
      slug,
      name: `Test Station ${slug}`,
      nowPlayingSource: "icy",
      nowPlayingConfig: {},
      streamUrl: `http://example.com/${slug}`,
    })
    .onConflictDoNothing()
    .returning({ id: stationsTable.id });
  if (row) return row.id;
  const [existing] = await db
    .select({ id: stationsTable.id })
    .from(stationsTable)
    .where(eq(stationsTable.slug, slug));
  return existing!.id;
}

async function insertRecording(id: string, releaseYear: number | null = null) {
  await db
    .insert(recordingsTable)
    .values({ mbid: id, title: "Test Track", artist: "Test Artist", releaseYear })
    .onConflictDoNothing();
}

async function insertSpin(recordingMbid: string, stationId: number) {
  await db.insert(spinsTable).values({
    mbid: recordingMbid,
    stationId,
    rawArtist: "Test Artist",
    rawTitle: "Test Track",
    playedAt: new Date(),
  });
}

async function getRecording(id: string) {
  const [row] = await db
    .select({ releaseYear: recordingsTable.releaseYear, yearCheckedAt: recordingsTable.yearCheckedAt })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, id));
  return row;
}

let stationId: number;

beforeAll(async () => {
  if (!dbAvailable) return;
  stationId = await insertStation(STATION_ID_BASE);
});

afterAll(async () => {
  if (!dbAvailable) return;
  // Clean up in FK-safe order. Delete ALL spins for the test station (covers
  // both normal and sp: MBIDs that don't match the recording LIKE pattern).
  await db.execute(sql`DELETE FROM spins WHERE station_id = ${stationId}`);
  await db.execute(sql`DELETE FROM recordings WHERE mbid LIKE ${"test-rybf-" + RUN + "-%"}`);
  // Synthetic sp: recordings inserted in tests — safe to clean up by pattern.
  await db.execute(sql`DELETE FROM recordings WHERE mbid LIKE ${"sp:test-rybf-" + RUN + "-%"}`);
  await db.execute(sql`DELETE FROM stations WHERE slug = ${STATION_ID_BASE}`);
});

describe("backfillReleaseYearBatch", () => {
  it.skipIf(!dbAvailable)(
    "sets release_year and year_checked_at when MB returns a year",
    async () => {
      const id = mbid("hit");
      await insertRecording(id);
      await insertSpin(id, stationId);
      mockFetchReleaseYear.mockResolvedValueOnce(1977);

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(row?.releaseYear).toBe(1977);
      expect(row?.yearCheckedAt).not.toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "sets year_checked_at but NOT release_year when MB has no date (null)",
    async () => {
      const id = mbid("no-date");
      await insertRecording(id);
      await insertSpin(id, stationId);
      mockFetchReleaseYear.mockResolvedValueOnce(null);

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(row?.releaseYear).toBeNull();
      expect(row?.yearCheckedAt).not.toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "leaves year_checked_at NULL when MB throws 503 (transient 5xx — retry later)",
    async () => {
      const id = mbid("transient-5xx");
      await insertRecording(id);
      await insertSpin(id, stationId);
      mockFetchReleaseYear.mockRejectedValueOnce(new Error("MusicBrainz 503 for /recording/..."));

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(row?.releaseYear).toBeNull();
      expect(row?.yearCheckedAt).toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "leaves year_checked_at NULL when MB returns 429 (rate-limit — retry later)",
    async () => {
      const id = mbid("rate-limit");
      await insertRecording(id);
      await insertSpin(id, stationId);
      // 429 must be treated as transient so the recording stays in the target
      // set and is retried on the next tick — not silently excluded forever.
      mockFetchReleaseYear.mockRejectedValueOnce(new Error("MusicBrainz 429 for /recording/..."));

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(row?.releaseYear).toBeNull();
      expect(row?.yearCheckedAt).toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "does NOT select synthetic sp: MBIDs (excluded by target filter)",
    async () => {
      const spId = `sp:${mbid("synthetic")}`;
      await insertRecording(spId);
      await insertSpin(spId, stationId);
      mockFetchReleaseYear.mockResolvedValue(2020);

      await backfillReleaseYearBatch(10);

      // The synthetic row should never have been touched by the batch.
      const row = await getRecording(spId);
      expect(row?.yearCheckedAt).toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "skips recordings that already have year_checked_at set",
    async () => {
      const id = mbid("already-done");
      await insertRecording(id, 1969);
      await db
        .update(recordingsTable)
        .set({ yearCheckedAt: new Date("2024-01-01") })
        .where(eq(recordingsTable.mbid, id));
      await insertSpin(id, stationId);
      mockFetchReleaseYear.mockClear();

      await backfillReleaseYearBatch(10);

      expect(mockFetchReleaseYear).not.toHaveBeenCalledWith(id, expect.anything());
    },
  );

  it.skipIf(!dbAvailable)(
    "skips recordings with no spins (not in the target set)",
    async () => {
      const id = mbid("no-spin");
      await insertRecording(id);
      // Intentionally no spin inserted
      mockFetchReleaseYear.mockClear();

      await backfillReleaseYearBatch(10);

      expect(mockFetchReleaseYear).not.toHaveBeenCalledWith(id, expect.anything());
    },
  );
});
