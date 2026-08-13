// @vitest-environment node
/**
 * Unit tests for the TheAudioDB album review pipeline.
 *
 * Tests cover:
 *  - queryAudioDb: HTTP fetch with injected fetchFn (no real network)
 *  - pickMatchingAlbum: token-overlap matching
 *  - buildClaimText: claim text construction
 *  - roughlyMatches / tokenise: text normalisation helpers
 *
 * No real DB or network I/O — fetchFn is injected, DB is not called in
 * the pure-function tests.
 */

import { describe, it, expect, vi } from "vitest";
import {
  queryAudioDb,
  pickMatchingAlbum,
  buildClaimText,
  roughlyMatches,
  tokenise,
  type AudioDbAlbum,
} from "../../src/lore/audiodb.js";

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_ALBUM: AudioDbAlbum = {
  idAlbum: "2112023",
  strAlbum: "OK Computer",
  strArtist: "Radiohead",
  intScore: "9",
  intScoreVotes: "11",
  strReview:
    "As an occasional admirer of this band, I've never quite got my head around " +
    "the fact that OK Computer is considered by many British music fans to be one " +
    "of the Greatest Albums of All Time. It is undeniably a great album.",
};

const SAMPLE_RESPONSE = { album: [SAMPLE_ALBUM] };

// ---------------------------------------------------------------------------
// tokenise
// ---------------------------------------------------------------------------

describe("tokenise", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenise("Radiohead!")).toEqual(["radiohead"]);
  });

  it("filters tokens shorter than 3 chars", () => {
    expect(tokenise("OK Computer")).toEqual(["computer"]);
  });

  it("handles empty string", () => {
    expect(tokenise("")).toEqual([]);
  });

  it("splits on whitespace", () => {
    const tokens = tokenise("The Dark Side of the Moon");
    expect(tokens).toContain("dark");
    expect(tokens).toContain("side");
    expect(tokens).toContain("moon");
  });
});

// ---------------------------------------------------------------------------
// roughlyMatches
// ---------------------------------------------------------------------------

describe("roughlyMatches", () => {
  it("matches identical strings", () => {
    expect(roughlyMatches("Radiohead", "Radiohead")).toBe(true);
  });

  it("matches with case difference", () => {
    expect(roughlyMatches("radiohead", "RADIOHEAD")).toBe(true);
  });

  it("matches when most tokens overlap", () => {
    expect(roughlyMatches("The Dark Side of the Moon", "Dark Side of the Moon")).toBe(true);
  });

  it("rejects clearly different strings", () => {
    expect(roughlyMatches("Radiohead", "Fleetwood Mac")).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(roughlyMatches("", "Radiohead")).toBe(false);
    expect(roughlyMatches("Radiohead", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// queryAudioDb (injected fetchFn — no network)
// ---------------------------------------------------------------------------

describe("queryAudioDb", () => {
  it("returns parsed albums on a successful response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_RESPONSE,
    });

    const result = await queryAudioDb("Radiohead", "OK Computer", mockFetch as typeof fetch);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      strAlbum: "OK Computer",
      strArtist: "Radiohead",
      intScore: "9",
    });
  });

  it("includes the correct query parameters in the URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ album: [] }),
    });

    await queryAudioDb("Fleetwood Mac", "Rumours", mockFetch as typeof fetch);

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("s=Fleetwood+Mac");
    expect(calledUrl).toContain("a=Rumours");
    expect(calledUrl).toContain("searchalbum.php");
  });

  it("returns [] when the response is non-ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const result = await queryAudioDb("Radiohead", "OK Computer", mockFetch as typeof fetch);
    expect(result).toEqual([]);
  });

  it("returns [] when the API returns null album array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ album: null }),
    });
    const result = await queryAudioDb("Radiohead", "OK Computer", mockFetch as typeof fetch);
    expect(result).toEqual([]);
  });

  it("returns [] when fetch throws (network error)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network timeout"));
    const result = await queryAudioDb("Radiohead", "OK Computer", mockFetch as typeof fetch);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pickMatchingAlbum
// ---------------------------------------------------------------------------

describe("pickMatchingAlbum", () => {
  it("returns the matching album when artist and title match", () => {
    const match = pickMatchingAlbum([SAMPLE_ALBUM], "Radiohead", "OK Computer");
    expect(match).toBe(SAMPLE_ALBUM);
  });

  it("returns null for an empty list", () => {
    expect(pickMatchingAlbum([], "Radiohead", "OK Computer")).toBeNull();
  });

  it("returns null when the artist does not match", () => {
    const other: AudioDbAlbum = { ...SAMPLE_ALBUM, strArtist: "Fleetwood Mac" };
    expect(pickMatchingAlbum([other], "Radiohead", "OK Computer")).toBeNull();
  });

  it("returns null when the album title does not match", () => {
    const other: AudioDbAlbum = { ...SAMPLE_ALBUM, strAlbum: "The Bends" };
    expect(pickMatchingAlbum([other], "Radiohead", "OK Computer")).toBeNull();
  });

  it("returns the first match when multiple candidates are present", () => {
    const first: AudioDbAlbum = { ...SAMPLE_ALBUM, idAlbum: "1" };
    const second: AudioDbAlbum = { ...SAMPLE_ALBUM, idAlbum: "2" };
    expect(pickMatchingAlbum([first, second], "Radiohead", "OK Computer")).toBe(first);
  });

  it("matches despite punctuation differences", () => {
    const variant: AudioDbAlbum = { ...SAMPLE_ALBUM, strAlbum: "OK Computer: OKNOTOK" };
    // "computer" token still matches "OK Computer"
    expect(pickMatchingAlbum([variant], "Radiohead", "OK Computer")).toBe(variant);
  });
});

// ---------------------------------------------------------------------------
// buildClaimText
// ---------------------------------------------------------------------------

describe("buildClaimText", () => {
  it("includes the score and vote count", () => {
    const text = buildClaimText(SAMPLE_ALBUM);
    expect(text).toContain("Rated 9/10.");
    expect(text).toContain("11 votes");
  });

  it("includes a truncated review snippet", () => {
    const text = buildClaimText(SAMPLE_ALBUM);
    // Review snippet should end with an ellipsis
    expect(text).toMatch(/…$/);
    // And must not exceed score + 300 review chars + ellipsis + space
    expect(text.length).toBeLessThan(400);
  });

  it("handles missing score gracefully", () => {
    const album: AudioDbAlbum = { ...SAMPLE_ALBUM, intScore: null, intScoreVotes: null };
    const text = buildClaimText(album);
    expect(text).not.toContain("Rated");
    // Should still include the review snippet
    expect(text).toMatch(/…$/);
  });

  it("handles missing review gracefully", () => {
    const album: AudioDbAlbum = { ...SAMPLE_ALBUM, strReview: null };
    const text = buildClaimText(album);
    expect(text).toContain("Rated 9/10.");
    expect(text).not.toMatch(/…$/);
  });

  it("returns a fallback string when both score and review are missing", () => {
    const album: AudioDbAlbum = { intScore: null, intScoreVotes: null, strReview: null };
    const text = buildClaimText(album);
    expect(text).toBe("Reviewed on TheAudioDB.");
  });
});
