// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbExecute,
  mockDbSelect,
  mockDbUpdate,
  mockFetchGenreAndYear,
} = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockFetchGenreAndYear: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      execute: mockDbExecute,
      select: mockDbSelect,
      update: mockDbUpdate,
    },
  };
});

vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...actual,
    fetchGenreAndYear: mockFetchGenreAndYear,
  };
});

const { backfillGenreBatch } = await import(
  "../src/lore/genre-backfill.js"
);

beforeEach(() => {
  vi.clearAllMocks();
  mockDbSelect.mockReturnValue({
    from: () => ({
      where: () => Promise.resolve([{ count: 0 }]),
    }),
  });
});

describe("backfillGenreBatch", () => {
  it("uses the station-fair candidate order and keeps provider calls sequential", async () => {
    mockDbExecute.mockResolvedValue({
      rows: [
        {
          mbid: "station-a-recording",
          artist: "Artist A",
          artistMbid: null,
          stationId: 1,
          lastPlayedAt: new Date("2026-09-02T10:00:00Z"),
        },
        {
          mbid: "station-b-recording",
          artist: "Artist B",
          artistMbid: null,
          stationId: 2,
          lastPlayedAt: new Date("2026-09-02T09:00:00Z"),
        },
      ],
    });

    const providerOrder: string[] = [];
    mockFetchGenreAndYear.mockImplementation(async (mbid: string) => {
      providerOrder.push(mbid);
      return {
        genres: ["indie"],
        year: 2026,
        releaseDate: "2026",
        status: "found",
      };
    });

    const updates: Array<Record<string, unknown>> = [];
    mockDbUpdate.mockReturnValue({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: () => Promise.resolve() };
      },
    });

    const result = await backfillGenreBatch(2);

    expect(providerOrder).toEqual([
      "station-a-recording",
      "station-b-recording",
    ]);
    expect(updates).toHaveLength(2);
    expect(updates.every((row) => row.genreEnrichmentStatus === "found")).toBe(
      true,
    );
    expect(result).toEqual({ scanned: 2, updated: 2, remaining: 0 });
  });

  it("keeps transient failures retryable and records the attempt", async () => {
    mockDbExecute.mockResolvedValue({
      rows: [
        {
          mbid: "transient-recording",
          artist: "Artist",
          artistMbid: null,
          stationId: 1,
          lastPlayedAt: new Date("2026-09-02T10:00:00Z"),
        },
      ],
    });
    mockFetchGenreAndYear.mockResolvedValue({
      genres: [],
      year: null,
      releaseDate: null,
      status: "transient_failure",
    });

    let update: Record<string, unknown> | undefined;
    mockDbUpdate.mockReturnValue({
      set: (values: Record<string, unknown>) => {
        update = values;
        return { where: () => Promise.resolve() };
      },
    });

    await backfillGenreBatch(1);

    expect(update?.genreEnrichmentStatus).toBe("transient_failure");
    expect(update?.genreEnrichmentAttemptedAt).toBeInstanceOf(Date);
    expect(update).not.toHaveProperty("genreEnrichedAt");
  });
});