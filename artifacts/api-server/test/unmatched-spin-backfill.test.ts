// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateMbResolver,
  mockDbInsert,
  mockDbSelect,
  mockDbUpdate,
  mockUpsertRecording,
  mockResolveByTextWithScore,
  mockFetchReleaseDateInfo,
} = vi.hoisted(() => ({
  mockCreateMbResolver: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockUpsertRecording: vi.fn(),
  mockResolveByTextWithScore: vi.fn(),
  mockFetchReleaseDateInfo: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: mockDbSelect,
      insert: mockDbInsert,
      update: mockDbUpdate,
    },
  };
});

vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...actual,
    musicbrainzEnabled: () => true,
    createMbResolver: mockCreateMbResolver,
  };
});

vi.mock("../src/lore/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lore/resolve.js")>();
  return { ...actual, upsertRecording: mockUpsertRecording };
});

const resolveByTextWithScoreStatus = async (
  artist: string,
  title: string,
  signal?: AbortSignal,
) => {
  const match = await mockResolveByTextWithScore(artist, title, signal);
  return match
    ? { status: "matched" as const, ...match }
    : { status: "unavailable" as const };
};

// The worker creates its isolated resolver at module import time.
mockCreateMbResolver.mockReturnValue({
  resolveByTextWithScore: mockResolveByTextWithScore,
  resolveByTextWithScoreStatus,
  fetchReleaseDateInfo: mockFetchReleaseDateInfo,
});

const { backfillUnmatchedSpinsBatch } = await import(
  "../src/lore/unmatched-spin-backfill.js"
);

const spinRows = [
  {
    id: 101,
    mbid: null,
    rawArtist: "The Example Band",
    rawTitle: "A Track",
    durationMs: 240_000,
    playedAt: new Date(),
  },
  {
    id: 102,
    mbid: null,
    rawArtist: " the example band ",
    rawTitle: "A Track!",
    durationMs: 241_000,
    playedAt: new Date(),
  },
  {
    id: 103,
    mbid: null,
    rawArtist: "Advertisement",
    rawTitle: "Commercial break",
    durationMs: null,
    playedAt: new Date(),
  },
];

let cacheRows: Array<{
  key: string;
  mbid: string | null;
  confidence: string;
  updatedAt: Date;
}>;
let selectCall = 0;

function rowsQuery<T>(rows: T[]) {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }),
  };
}

function cacheQuery() {
  return {
    from: () => ({
      where: () => Promise.resolve(cacheRows),
    }),
  };
}

function installDbFakes() {
  selectCall = 0;
  cacheRows = [];
  mockDbSelect.mockImplementation(() => {
    selectCall++;
    return selectCall % 2 === 1 ? rowsQuery(spinRows) : cacheQuery();
  });
  mockDbInsert.mockImplementation(() => ({
    values: (values: Array<Record<string, unknown>> | Record<string, unknown>) => ({
      onConflictDoUpdate: () => {
        const entries = Array.isArray(values) ? values : [values];
        for (const entry of entries) {
          const key = String(entry.key);
          const existing = cacheRows.find((row) => row.key === key);
          const next = {
            key,
            mbid: (entry.mbid as string | null) ?? null,
            confidence: String(entry.confidence ?? "unresolved"),
            updatedAt: new Date(),
          };
          if (existing) Object.assign(existing, next);
          else cacheRows.push(next);
        }
        return Promise.resolve();
      },
    }),
  }));
  mockDbUpdate.mockImplementation(() => ({
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve([{ id: 101 }, { id: 102 }]),
      }),
    }),
  }));
  mockCreateMbResolver.mockReturnValue({
    resolveByTextWithScore: mockResolveByTextWithScore,
    resolveByTextWithScoreStatus,
    fetchReleaseDateInfo: mockFetchReleaseDateInfo,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installDbFakes();
  mockUpsertRecording.mockResolvedValue(undefined);
  mockFetchReleaseDateInfo.mockResolvedValue(null);
});

describe("backfillUnmatchedSpinsBatch", () => {
  it("deduplicates usable recent spins and promotes only a scored canonical match", async () => {
    mockResolveByTextWithScore.mockResolvedValue({
      mbid: "11111111-1111-4111-8111-111111111111",
      score: 97,
    });

    const result = await backfillUnmatchedSpinsBatch();

    expect(result).toMatchObject({
      candidates: 1,
      scanned: 1,
      resolved: 1,
      deferred: 0,
      unavailable: 0,
    });
    expect(mockResolveByTextWithScore).toHaveBeenCalledTimes(1);
    expect(mockUpsertRecording).toHaveBeenCalledTimes(1);
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    expect(cacheRows[0]).toMatchObject({ confidence: "text" });
  });

  it("remembers a clear miss so the next run does not look it up again", async () => {
    mockResolveByTextWithScore.mockResolvedValue(null);

    const first = await backfillUnmatchedSpinsBatch();
    const second = await backfillUnmatchedSpinsBatch();

    expect(first.unavailable).toBe(1);
    expect(second.candidates).toBe(0);
    expect(mockResolveByTextWithScore).toHaveBeenCalledTimes(2);
    expect(cacheRows[0]).toMatchObject({
      confidence: "unresolved",
      mbid: null,
    });
  });

  it("defers provider failures and holds the single-flight guard", async () => {
    let releaseLookup!: () => void;
    const lookupFinished = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    mockResolveByTextWithScore.mockImplementation(async () => {
      await lookupFinished;
      throw new Error("MusicBrainz 503");
    });

    const firstRun = backfillUnmatchedSpinsBatch();
    await vi.waitFor(() => {
      expect(mockResolveByTextWithScore).toHaveBeenCalledTimes(1);
    });
    const overlapping = await backfillUnmatchedSpinsBatch();
    releaseLookup();
    const first = await firstRun;

    expect(overlapping.skipped).toBe(true);
    expect(first.deferred).toBe(1);
    expect(cacheRows[0]).toMatchObject({
      confidence: "deferred",
      mbid: null,
    });
  });

  it("recovers historical metadata with one bounded artist/title swap", async () => {
    mockResolveByTextWithScore
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        mbid: "22222222-2222-4222-8222-222222222222",
        score: 96,
      });

    const result = await backfillUnmatchedSpinsBatch();

    expect(result.resolved).toBe(1);
    expect(mockResolveByTextWithScore).toHaveBeenNthCalledWith(
      1,
      "The Example Band",
      "A Track",
      expect.any(AbortSignal),
    );
    expect(mockResolveByTextWithScore).toHaveBeenNthCalledWith(
      2,
      "A Track",
      "The Example Band",
      expect.any(AbortSignal),
    );
  });

  it("rejects a canonical candidate that conflicts with source duration", async () => {
    mockResolveByTextWithScore.mockResolvedValue({
      mbid: "33333333-3333-4333-8333-333333333333",
      score: 99,
      durationMs: 30_000,
    });

    const result = await backfillUnmatchedSpinsBatch();

    expect(result).toMatchObject({
      attempted: 1,
      resolved: 0,
      definitiveMiss: 1,
    });
    expect(mockUpsertRecording).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("preserves MusicBrainz canonical fields when promoting a fresh match", async () => {
    mockResolveByTextWithScore.mockResolvedValue({
      mbid: "44444444-4444-4444-8444-444444444444",
      score: 98,
      title: "Canonical Track",
      artist: "Canonical Artist",
      artistMbid: "55555555-5555-4555-8555-555555555555",
      isrc: "USABC1234567",
      durationMs: 240_500,
    });

    await backfillUnmatchedSpinsBatch();

    expect(mockUpsertRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        mbid: "44444444-4444-4444-8444-444444444444",
        title: "Canonical Track",
        artist: "Canonical Artist",
        artistMbid: "55555555-5555-4555-8555-555555555555",
        isrc: "USABC1234567",
        durationMs: 240_500,
      }),
      undefined,
      false,
    );
  });
});