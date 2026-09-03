// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbSelect,
  mockDbUpdate,
  mockFetchDuration,
  mockSearchTrack,
  mockSpotifyAppConfigured,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockFetchDuration: vi.fn(),
  mockSearchTrack: vi.fn(),
  mockSpotifyAppConfigured: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
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
    createMbResolver: vi.fn(() => ({ fetchDuration: mockFetchDuration })),
    musicbrainzEnabled: vi.fn(() => true),
  };
});

vi.mock("../src/spotify/appClient.js", () => ({
  searchTrack: mockSearchTrack,
  spotifyAppConfigured: mockSpotifyAppConfigured,
}));

const { backfillDurationBatch } = await import(
  "../src/lore/duration-backfill.js"
);

const capturedUpdates: Array<Record<string, unknown>> = [];

function setupDb(
  rows: Array<{
    mbid: string;
    artist: string;
    title: string;
    isrc: string | null;
  }>,
  remaining = rows.length,
) {
  mockDbSelect
    .mockReturnValueOnce({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(rows),
          }),
        }),
      }),
    })
    .mockReturnValueOnce({
      from: () => ({
        where: () => Promise.resolve([{ count: remaining }]),
      }),
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdates.length = 0;
  mockSpotifyAppConfigured.mockReturnValue(false);
  mockDbUpdate.mockReturnValue({
    set: (values: Record<string, unknown>) => {
      capturedUpdates.push(values);
      return { where: () => Promise.resolve() };
    },
  });
});

describe("backfillDurationBatch", () => {
  it("stores a valid MusicBrainz duration without spending a Spotify lookup", async () => {
    const row = {
      mbid: "mb-duration-hit",
      artist: "Artist",
      title: "Song",
      isrc: null,
    };
    setupDb([row], 0);
    mockFetchDuration.mockResolvedValue(211_000);

    const result = await backfillDurationBatch(1);

    expect(result).toEqual({
      scanned: 1,
      updated: 1,
      noResult: 0,
      failed: 0,
      remaining: 0,
    });
    expect(mockSearchTrack).not.toHaveBeenCalled();
    expect(capturedUpdates[0]).toMatchObject({ durationMs: 211_000 });
  });

  it("falls back to an exact Spotify ISRC match when MusicBrainz has no length", async () => {
    const row = {
      mbid: "mb-spotify-hit",
      artist: "Artist",
      title: "Song",
      isrc: "US-ABC-24-00001",
    };
    setupDb([row], 0);
    mockFetchDuration.mockResolvedValue(null);
    mockSpotifyAppConfigured.mockReturnValue(true);
    mockSearchTrack.mockResolvedValue({
      name: "Song",
      artists: [{ name: "Artist" }],
      isrc: "us-abc-24-00001",
      durationMs: 187_000,
    });

    const result = await backfillDurationBatch(1);

    expect(result.updated).toBe(1);
    expect(mockSearchTrack).toHaveBeenCalledWith("isrc:US-ABC-24-00001");
    expect(capturedUpdates[0]).toMatchObject({ durationMs: 187_000 });
  });

  it("does not write an unverified Spotify text match", async () => {
    const row = {
      mbid: "mb-spotify-miss",
      artist: "Artist",
      title: "Song",
      isrc: null,
    };
    setupDb([row], 0);
    mockFetchDuration.mockResolvedValue(null);
    mockSpotifyAppConfigured.mockReturnValue(true);
    mockSearchTrack.mockResolvedValue({
      name: "Different Song",
      artists: [{ name: "Different Artist" }],
      isrc: null,
      durationMs: 187_000,
    });

    const result = await backfillDurationBatch(1);

    expect(result).toMatchObject({ updated: 0, noResult: 1, failed: 0 });
    expect(capturedUpdates[0]).not.toHaveProperty("durationMs");
    expect(capturedUpdates[0]?.durationCheckedAt).toBeDefined();
  });

  it("leaves transient failures retryable", async () => {
    const row = {
      mbid: "mb-duration-transient",
      artist: "Artist",
      title: "Song",
      isrc: null,
    };
    setupDb([row], 1);
    mockFetchDuration.mockRejectedValue(new Error("MusicBrainz 503"));

    const result = await backfillDurationBatch(1);

    expect(result).toMatchObject({ scanned: 1, updated: 0, noResult: 0, failed: 1 });
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});