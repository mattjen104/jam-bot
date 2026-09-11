/**
 * @vitest-environment node
 *
 * End-to-end DB coverage for saved-only recording metadata:
 * background enrichment must make grounded genre/year facts visible through
 * the listener-facing Library filters, while definitive misses stay unknown.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import {
  db,
  libraryItemsTable,
  loreUsersTable,
  recordingsTable,
} from "@workspace/db";

const { mockFetchGenreAndYear, mockFetchReleaseDateInfo } = vi.hoisted(() => ({
  mockFetchGenreAndYear: vi.fn(),
  mockFetchReleaseDateInfo: vi.fn(),
}));

vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...actual,
    fetchGenreAndYear: mockFetchGenreAndYear,
    musicbrainzEnabled: () => true,
    createMbResolver: () => ({
      fetchReleaseDateInfo: mockFetchReleaseDateInfo,
      fetchReleaseYear: vi.fn().mockResolvedValue(null),
      fetchIsrcByMbid: vi.fn().mockResolvedValue(null),
      resolveByIsrc: vi.fn().mockResolvedValue(null),
      resolveByText: vi.fn().mockResolvedValue(null),
      resolveByTextWithScore: vi.fn().mockResolvedValue(null),
    }),
  };
});

const { backfillGenreBatch } = await import("../src/lore/genre-backfill.js");
const { backfillReleaseYearBatch } = await import("../src/lore/release-year-backfill.js");
const { default: app } = await import("../src/app.js");

const run = randomUUID().slice(0, 8);
const SID = `test-library-enrichment-${run}`;
const GROUNDED_MBID = `test-library-enrichment-grounded-${run}`;
const MISS_MBID = `test-library-enrichment-miss-${run}`;

let dbAvailable = false;
let userId: number | null = null;
let server: Server | undefined;
let baseUrl = "";

async function getLibrary(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${baseUrl}/api/me/library?${query}`, {
    headers: { cookie: `lore_sid=${SID}` },
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [user] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: SID })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  await db.insert(recordingsTable).values([
    {
      mbid: GROUNDED_MBID,
      title: `Grounded Filter Song ${run}`,
      artist: `Grounded Filter Artist ${run}`,
      genres: [],
      releaseYear: null,
      genreEnrichmentStatus: "pending",
    },
    {
      mbid: MISS_MBID,
      title: `Unknown Filter Song ${run}`,
      artist: `Unknown Filter Artist ${run}`,
      genres: [],
      releaseYear: null,
      genreEnrichmentStatus: "pending",
    },
  ]);

  const now = Date.now();
  await db.insert(libraryItemsTable).values([
    {
      userId,
      mbid: GROUNDED_MBID,
      provenance: { kind: "keep" },
      addedAt: new Date(now),
    },
    {
      userId,
      mbid: MISS_MBID,
      provenance: { kind: "keep" },
      addedAt: new Date(now - 1_000),
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (!dbAvailable) return;
  if (userId != null) {
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  await db.delete(recordingsTable).where(
    sql`${recordingsTable.mbid} in (${GROUNDED_MBID}, ${MISS_MBID})`,
  );
});

describe("saved-only Library enrichment filters", () => {
  it.skipIf(!dbAvailable)(
    "admits grounded metadata after enrichment and keeps definitive misses unknown",
    async () => {
      const before = await getLibrary({
        q: run,
        genre: "jazz",
        age: "deep",
      });
      expect(before.status).toBe(200);
      expect(before.body.items).toEqual([]);
      expect(before.body.metadataCoverage).toEqual({
        total: 2,
        genreKnown: 0,
        releaseYearKnown: 0,
      });

      mockFetchGenreAndYear.mockImplementation(async (mbid: string) =>
        mbid === GROUNDED_MBID
          ? {
              genres: ["Jazz"],
              year: null,
              releaseDate: null,
              status: "found",
            }
          : {
              genres: [],
              year: null,
              releaseDate: null,
              status: "no_result",
            },
      );
      await backfillGenreBatch(1);
      await backfillGenreBatch(1);

      mockFetchReleaseDateInfo.mockImplementation(async (mbid: string) =>
        mbid === GROUNDED_MBID
          ? { year: 1994, releaseDate: "1994" }
          : { year: null, releaseDate: null },
      );
      await backfillReleaseYearBatch(2);

      const after = await getLibrary({
        q: run,
        genre: "jazz",
        age: "deep",
      });
      expect(after.status).toBe(200);
      expect(after.body.items).toHaveLength(1);
      expect(after.body.items[0]).toMatchObject({
        mbid: GROUNDED_MBID,
        recording: {
          genres: ["jazz"],
          releaseYear: 1994,
        },
      });
      expect(after.body.metadataCoverage).toEqual({
        total: 2,
        genreKnown: 1,
        releaseYearKnown: 1,
      });

      const [miss] = await db
        .select({
          genres: recordingsTable.genres,
          releaseYear: recordingsTable.releaseYear,
          genreStatus: recordingsTable.genreEnrichmentStatus,
          yearCheckedAt: recordingsTable.yearCheckedAt,
        })
        .from(recordingsTable)
        .where(eq(recordingsTable.mbid, MISS_MBID));
      expect(miss).toMatchObject({
        genres: [],
        releaseYear: null,
        genreStatus: "no_result",
      });
      expect(miss?.yearCheckedAt).not.toBeNull();
    },
  );
});