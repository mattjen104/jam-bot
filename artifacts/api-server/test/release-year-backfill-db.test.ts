/**
 * @vitest-environment node
 *
 * DB-level tests for the release-year/-date backfill batch.
 *
 * Each test uses unique MBIDs to avoid cache-key collisions across files.
 * `year_checked_at` / `release_date_checked_at` are the convergence
 * sentinels — the key invariants are:
 *   - Definitive answer (data found or genuine no-date) → sentinels set
 *   - Transient failure (5xx / network) → sentinels NOT set (retried later)
 *   - 4xx permanent failure → treated as no-date, sentinels set
 *   - Synthetic `sp:` MBIDs → excluded from target set, never passed to resolver
 *   - Bounded date re-check: rows with release_year ≥ currentYear − 1 AND
 *     release_date IS NULL re-enter regardless of year_checked_at (the
 *     genre/live enrichment path writes release_year without that sentinel)
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { db, recordingsTable, spinsTable, stationsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { backfillReleaseYearBatch } from "../src/lore/release-year-backfill.js";

// ---- Resolver mock (must come before subject import) ----------------------
// vi.hoisted runs before the module graph is evaluated, so the reference is
// live when the vi.mock factory (also hoisted) calls createMbResolver().
type ReleaseDateInfo = { year: number | null; releaseDate: string | null };
const { mockFetchReleaseDateInfo } = vi.hoisted(() => ({
  mockFetchReleaseDateInfo: vi.fn<[string, AbortSignal?], Promise<ReleaseDateInfo | null>>(),
}));

vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...actual,
    musicbrainzEnabled: () => true,
    createMbResolver: () => ({
      fetchReleaseYear: vi.fn().mockResolvedValue(null),
      fetchReleaseDateInfo: mockFetchReleaseDateInfo,
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
    .select({
      releaseYear: recordingsTable.releaseYear,
      releaseDate: recordingsTable.releaseDate,
      yearCheckedAt: recordingsTable.yearCheckedAt,
      releaseDateCheckedAt: recordingsTable.releaseDateCheckedAt,
    })
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
      mockFetchReleaseDateInfo.mockResolvedValueOnce({ year: 1977, releaseDate: "1977" });

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(row?.releaseYear).toBe(1977);
      expect(row?.releaseDate).toBe("1977");
      expect(row?.yearCheckedAt).not.toBeNull();
      expect(row?.releaseDateCheckedAt).not.toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "stores the full partial-ISO release date alongside the year",
    async () => {
      const id = mbid("hit-full-date");
      await insertRecording(id);
      await insertSpin(id, stationId);
      mockFetchReleaseDateInfo.mockResolvedValueOnce({
        year: 2025,
        releaseDate: "2025-11-07",
      });

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(row?.releaseYear).toBe(2025);
      expect(row?.releaseDate).toBe("2025-11-07");
      expect(row?.releaseDateCheckedAt).not.toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "sets both sentinels but NOT year/date when MB has no date (null fields)",
    async () => {
      const id = mbid("no-date");
      await insertRecording(id);
      await insertSpin(id, stationId);
      mockFetchReleaseDateInfo.mockResolvedValueOnce({ year: null, releaseDate: null });

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(row?.releaseYear).toBeNull();
      expect(row?.releaseDate).toBeNull();
      expect(row?.yearCheckedAt).not.toBeNull();
      expect(row?.releaseDateCheckedAt).not.toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "leaves both sentinels NULL when MB throws 503 (transient 5xx — retry later)",
    async () => {
      const id = mbid("transient-5xx");
      await insertRecording(id);
      await insertSpin(id, stationId);
      mockFetchReleaseDateInfo.mockRejectedValueOnce(new Error("MusicBrainz 503 for /recording/..."));

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(row?.releaseYear).toBeNull();
      expect(row?.yearCheckedAt).toBeNull();
      expect(row?.releaseDateCheckedAt).toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "leaves both sentinels NULL when MB returns 429 (rate-limit — retry later)",
    async () => {
      const id = mbid("rate-limit");
      await insertRecording(id);
      await insertSpin(id, stationId);
      // 429 must be treated as transient so the recording stays in the target
      // set and is retried on the next tick — not silently excluded forever.
      mockFetchReleaseDateInfo.mockRejectedValueOnce(new Error("MusicBrainz 429 for /recording/..."));

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(row?.releaseYear).toBeNull();
      expect(row?.yearCheckedAt).toBeNull();
      expect(row?.releaseDateCheckedAt).toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "does NOT select synthetic sp: MBIDs (excluded by target filter)",
    async () => {
      const spId = `sp:${mbid("synthetic")}`;
      await insertRecording(spId);
      await insertSpin(spId, stationId);
      mockFetchReleaseDateInfo.mockResolvedValue({ year: 2020, releaseDate: "2020" });

      await backfillReleaseYearBatch(10);

      // The synthetic row should never have been touched by the batch.
      const row = await getRecording(spId);
      expect(row?.yearCheckedAt).toBeNull();
      expect(row?.releaseDateCheckedAt).toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "skips year-checked recordings whose year is too old for the date re-check",
    async () => {
      const id = mbid("already-done");
      await insertRecording(id, 1969);
      await db
        .update(recordingsTable)
        .set({ yearCheckedAt: new Date("2024-01-01") })
        .where(eq(recordingsTable.mbid, id));
      await insertSpin(id, stationId);
      mockFetchReleaseDateInfo.mockClear();

      await backfillReleaseYearBatch(10);

      // 1969 < currentYear − 1, so the bounded date re-check must NOT pick
      // this row up — only recent releases can ever be Dial "first" premieres.
      expect(mockFetchReleaseDateInfo).not.toHaveBeenCalledWith(id, expect.anything());
    },
  );

  it.skipIf(!dbAvailable)(
    "re-checks a recent year-checked recording to backfill its release date",
    async () => {
      const id = mbid("date-recheck");
      // Recent enough to ever be a premiere: within the bounded window.
      await insertRecording(id, new Date().getFullYear());
      await db
        .update(recordingsTable)
        .set({ yearCheckedAt: new Date("2024-01-01") })
        .where(eq(recordingsTable.mbid, id));
      await insertSpin(id, stationId);
      mockFetchReleaseDateInfo.mockResolvedValueOnce({
        year: new Date().getFullYear(),
        releaseDate: `${new Date().getFullYear()}-11-07`,
      });

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(mockFetchReleaseDateInfo).toHaveBeenCalledWith(id, expect.anything());
      expect(row?.releaseDate).toBe(`${new Date().getFullYear()}-11-07`);
      expect(row?.releaseDateCheckedAt).not.toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "re-checks a genre-enriched recording that has a recent year but no year_checked_at",
    async () => {
      const id = mbid("genre-enriched-recheck");
      // The genre/live enrichment path persists release_year (and marks
      // genre_enriched_at) WITHOUT setting year_checked_at. Those rows must
      // still enter the bounded date re-check or they would never obtain a
      // full release date after this change ships.
      await insertRecording(id, new Date().getFullYear());
      await insertSpin(id, stationId);
      const before = await getRecording(id);
      expect(before?.yearCheckedAt).toBeNull();
      mockFetchReleaseDateInfo.mockResolvedValueOnce({
        year: new Date().getFullYear(),
        releaseDate: `${new Date().getFullYear()}-11-07`,
      });

      await backfillReleaseYearBatch(10);

      const row = await getRecording(id);
      expect(mockFetchReleaseDateInfo).toHaveBeenCalledWith(id, expect.anything());
      expect(row?.releaseDate).toBe(`${new Date().getFullYear()}-11-07`);
      // One lookup answered for both fields — both sentinels get set so the
      // row converges and is never re-queried.
      expect(row?.releaseDateCheckedAt).not.toBeNull();
      expect(row?.yearCheckedAt).not.toBeNull();
    },
  );

  it.skipIf(!dbAvailable)(
    "does not re-check a recent recording whose release date is already known",
    async () => {
      const id = mbid("date-known");
      await insertRecording(id, new Date().getFullYear());
      await db
        .update(recordingsTable)
        .set({
          yearCheckedAt: new Date("2024-01-01"),
          releaseDate: `${new Date().getFullYear()}-05-01`,
          releaseDateCheckedAt: new Date("2024-01-01"),
        })
        .where(eq(recordingsTable.mbid, id));
      await insertSpin(id, stationId);
      mockFetchReleaseDateInfo.mockClear();

      await backfillReleaseYearBatch(10);

      expect(mockFetchReleaseDateInfo).not.toHaveBeenCalledWith(id, expect.anything());
    },
  );

  it.skipIf(!dbAvailable)(
    "skips recordings with no spins (not in the target set)",
    async () => {
      const id = mbid("no-spin");
      await insertRecording(id);
      // Intentionally no spin inserted
      mockFetchReleaseDateInfo.mockClear();

      await backfillReleaseYearBatch(10);

      expect(mockFetchReleaseDateInfo).not.toHaveBeenCalledWith(id, expect.anything());
    },
  );
});
