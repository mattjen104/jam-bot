/**
 * Unit tests for the artist/title swap-retry in resolveToMbid.
 *
 * Mocks @workspace/song-enrichment and @workspace/db so these run without a
 * real MusicBrainz endpoint or database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — hoisted automatically by Vitest
// ---------------------------------------------------------------------------

vi.mock("@workspace/song-enrichment", () => ({
  resolveRecordingByText: vi.fn(),
  resolveRecordingId: vi.fn().mockResolvedValue(null),
  fetchRecordingLinks: vi.fn().mockResolvedValue({ platforms: [] }),
  fetchGenreAndYear: vi.fn().mockResolvedValue({ genres: [], year: null }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    },
  };
});

vi.mock("../src/spotify/appClient.js", () => ({
  searchTrack: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/lore/ads.js", () => ({
  recordAdSignal: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after vi.mock so the mocked seams are wired
// ---------------------------------------------------------------------------

import { resolveToMbid, normalizeKey } from "../src/lore/resolve.js";
import { resolveRecordingByText } from "@workspace/song-enrichment";
import { db } from "@workspace/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMatch(overrides?: Partial<{
  recordingId: string;
  score: number;
  title: string;
  artist: string;
  artistMbid: string;
  isrc: string;
  durationMs: number;
}>) {
  return {
    recordingId: "abc-uuid",
    score: 100,
    title: "Canonical Title",
    artist: "Canonical Artist",
    ...overrides,
  };
}

/** Wire the DB mock to return no cached row (cache miss). */
function setupCacheMiss() {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as never);
  vi.mocked(db.insert).mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }),
  } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveToMbid — swap retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCacheMiss();
  });

  it("fires the swap when the first text search returns null", async () => {
    const swappedMatch = makeMatch({ recordingId: "swap-uuid", title: "When Your Heart Is Weak", artist: "Cock Robin" });
    vi.mocked(resolveRecordingByText)
      .mockResolvedValueOnce(null)        // first search (wrong order) → miss
      .mockResolvedValueOnce(swappedMatch); // swap (correct order) → hit

    const result = await resolveToMbid("When Your Heart Is Weak", "Cock Robin");

    expect(result.mbid).toBe("swap-uuid");
    expect(result.confidence).toBe("text");
    // Canonical name from MB, not the raw ICY order.
    expect(result.artist).toBe("Cock Robin");
    expect(result.title).toBe("When Your Heart Is Weak");
    // resolveRecordingByText called twice: normal then swapped.
    expect(vi.mocked(resolveRecordingByText)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(resolveRecordingByText)).toHaveBeenNthCalledWith(1, "When Your Heart Is Weak", "Cock Robin");
    expect(vi.mocked(resolveRecordingByText)).toHaveBeenNthCalledWith(2, "Cock Robin", "When Your Heart Is Weak");
  });

  it("does NOT fire the swap when the first search succeeded", async () => {
    const directMatch = makeMatch({ recordingId: "direct-uuid" });
    vi.mocked(resolveRecordingByText).mockResolvedValueOnce(directMatch);

    const result = await resolveToMbid("Cock Robin", "When Your Heart Is Weak");

    expect(result.mbid).toBe("direct-uuid");
    expect(result.confidence).toBe("text");
    // Only one call — swap was never attempted.
    expect(vi.mocked(resolveRecordingByText)).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire the swap when the first search had a duration-only rejection", async () => {
    // Match returns a recording, but its duration differs grossly from the hint.
    const durationMismatchedMatch = makeMatch({ recordingId: "wrong-pressing", durationMs: 30_000 });
    vi.mocked(resolveRecordingByText).mockResolvedValueOnce(durationMismatchedMatch);

    // Hint says ~8 minutes; match says 30 seconds → gross mismatch (>2 min tolerance).
    const result = await resolveToMbid("Artist", "Title", 480_000);

    // Swap was NOT attempted — only one MB call.
    expect(vi.mocked(resolveRecordingByText)).toHaveBeenCalledTimes(1);
    // Falls through to Spotify (mocked to null), so result is unresolved.
    expect(result.confidence).toBe("unresolved");
    expect(result.mbid).toBeNull();
  });

  it("stores the result under the raw (unswapped) cache key", async () => {
    const swappedMatch = makeMatch({ recordingId: "swap-uuid" });
    vi.mocked(resolveRecordingByText)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(swappedMatch);

    const rawArtist = "When Your Heart Is Weak";
    const rawTitle = "Cock Robin";
    await resolveToMbid(rawArtist, rawTitle);

    // The insert call should use the raw (unswapped) normalized key.
    const expectedKey = normalizeKey(rawArtist, rawTitle);
    const insertMock = vi.mocked(db.insert);
    expect(insertMock).toHaveBeenCalled();
    const values = insertMock.mock.results[0]?.value;
    expect(values?.values).toHaveBeenCalledWith(
      expect.objectContaining({ key: expectedKey }),
    );
  });

  it("carries optional fields (artistMbid, isrc, durationMs) from the swap result", async () => {
    const richMatch = makeMatch({
      recordingId: "rich-uuid",
      artistMbid: "artist-mbid-123",
      isrc: "USRC12345678",
      durationMs: 200_000,
    });
    vi.mocked(resolveRecordingByText)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(richMatch);

    const result = await resolveToMbid("Title", "Artist");

    expect(result.mbid).toBe("rich-uuid");
    expect(result.artistMbid).toBe("artist-mbid-123");
    expect(result.isrc).toBe("USRC12345678");
    expect(result.durationMs).toBe(200_000);
  });

  it("swap also skipped when both searches miss — falls through to unresolved", async () => {
    vi.mocked(resolveRecordingByText)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await resolveToMbid("Nobody", "Knowsthis");

    expect(vi.mocked(resolveRecordingByText)).toHaveBeenCalledTimes(2);
    expect(result.confidence).toBe("unresolved");
    expect(result.mbid).toBeNull();
  });
});
