// @vitest-environment node
/**
 * Unit tests for the Beato episode resolution pipeline.
 *
 * Tests cover:
 *  - normalizeTitleForFallback: parenthetical qualifier stripping
 *  - resolveRecordingMbid: primary pass, fallback pass, top-3 scanning,
 *    error vs miss discrimination
 *
 * No real DB or network I/O — fetchFn is injected for all MB calls.
 */

import { describe, it, expect, vi } from "vitest";
import {
  normalizeTitleForFallback,
  resolveRecordingMbid,
  MAX_MISS_ATTEMPTS,
  type MbSearchResult,
} from "../../src/lore/beato.js";

// ---------------------------------------------------------------------------
// Helpers — build mock fetch responses
// ---------------------------------------------------------------------------

/** Build a 200-OK MB recording search response. */
function mbOk(recordings: Array<{ id: string; score: number }>): Response {
  return {
    ok: true,
    json: async () => ({ recordings }),
  } as unknown as Response;
}

/** An empty 200-OK response (no recordings). */
const MB_EMPTY: Response = {
  ok: true,
  json: async () => ({ recordings: [] }),
} as unknown as Response;

/** A non-OK HTTP response (e.g. 503). */
const MB_ERROR: Response = { ok: false, status: 503 } as unknown as Response;

// ---------------------------------------------------------------------------
// normalizeTitleForFallback
// ---------------------------------------------------------------------------

describe("normalizeTitleForFallback", () => {
  it("strips a trailing (Remastered) suffix", () => {
    expect(normalizeTitleForFallback("Comfortably Numb (Remastered)")).toBe(
      "Comfortably Numb",
    );
  });

  it("strips a trailing (2016 Remaster) suffix", () => {
    expect(normalizeTitleForFallback("Paranoid Android (2016 Remaster)")).toBe(
      "Paranoid Android",
    );
  });

  it("strips a trailing (Live) suffix", () => {
    expect(normalizeTitleForFallback("Every Breath You Take (Live)")).toBe(
      "Every Breath You Take",
    );
  });

  it("strips a trailing (Single Version) suffix", () => {
    expect(normalizeTitleForFallback("Go Your Own Way (Single Version)")).toBe(
      "Go Your Own Way",
    );
  });

  it("strips a trailing (Radio Edit) suffix", () => {
    expect(normalizeTitleForFallback("Superstition (Radio Edit)")).toBe(
      "Superstition",
    );
  });

  it("strips a trailing (Remastered 2011) suffix", () => {
    expect(normalizeTitleForFallback("Roundabout (Remastered 2011)")).toBe(
      "Roundabout",
    );
  });

  it("does NOT strip a parenthetical that is part of the canonical title", () => {
    // The subtitle is not a production qualifier keyword.
    const title = "Rocket Man (I Think It's Going to Be a Long, Long Time)";
    expect(normalizeTitleForFallback(title)).toBe(title);
  });

  it("returns the title unchanged when there are no parentheticals", () => {
    expect(normalizeTitleForFallback("Bohemian Rhapsody")).toBe(
      "Bohemian Rhapsody",
    );
  });

  it("is case-insensitive for qualifier keywords", () => {
    expect(normalizeTitleForFallback("1979 (REMASTERED)")).toBe("1979");
  });
});

// ---------------------------------------------------------------------------
// resolveRecordingMbid — primary pass (hit on first result)
// ---------------------------------------------------------------------------

describe("resolveRecordingMbid — primary pass", () => {
  it("returns a hit when the first result has score ≥ 85", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(mbOk([{ id: "mbid-aaa", score: 100 }]));

    const result = await resolveRecordingMbid(
      "Nirvana",
      "Smells Like Teen Spirit",
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toEqual<MbSearchResult>({ kind: "hit", mbid: "mbid-aaa" });
    // Only one fetch call — no fallback needed.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns miss (not error) when the title has no parenthetical and MB returns empty", async () => {
    const mockFetch = vi.fn().mockResolvedValue(MB_EMPTY);

    const result = await resolveRecordingMbid(
      "Queen",
      "Bohemian Rhapsody",
      mockFetch as unknown as typeof fetch,
    );

    // The normalized title is identical so no second fetch.
    expect(result).toEqual<MbSearchResult>({ kind: "miss" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns error when the HTTP response is not-ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue(MB_ERROR);

    const result = await resolveRecordingMbid(
      "Pink Floyd",
      "Comfortably Numb",
      mockFetch as unknown as typeof fetch,
    );

    // Non-OK HTTP → error, NOT miss (don't count toward sentinel).
    expect(result).toEqual<MbSearchResult>({ kind: "error" });
  });

  it("returns error when fetch throws (network error)", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("network timeout"));

    const result = await resolveRecordingMbid(
      "Led Zeppelin",
      "Stairway to Heaven",
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toEqual<MbSearchResult>({ kind: "error" });
  });
});

// ---------------------------------------------------------------------------
// resolveRecordingMbid — top-3 scanning
// ---------------------------------------------------------------------------

describe("resolveRecordingMbid — top-3 scanning", () => {
  it("returns the second result when the first has score < 85", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mbOk([
        { id: "mbid-live", score: 70 }, // live recording ranked first — skip
        { id: "mbid-studio", score: 92 }, // studio recording — accept
        { id: "mbid-alt", score: 90 },
      ]),
    );

    const result = await resolveRecordingMbid(
      "Fleetwood Mac",
      "Go Your Own Way",
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toEqual<MbSearchResult>({ kind: "hit", mbid: "mbid-studio" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns the third result when the first two have low scores", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mbOk([
        { id: "mbid-a", score: 60 },
        { id: "mbid-b", score: 72 },
        { id: "mbid-c", score: 88 },
      ]),
    );

    const result = await resolveRecordingMbid(
      "The Police",
      "Every Breath You Take",
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toEqual<MbSearchResult>({ kind: "hit", mbid: "mbid-c" });
  });

  it("returns miss when all top-3 results have score < 85", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mbOk([
        { id: "mbid-a", score: 70 },
        { id: "mbid-b", score: 75 },
        { id: "mbid-c", score: 80 },
      ]),
    );

    // No parenthetical → no fallback.
    const result = await resolveRecordingMbid(
      "Radiohead",
      "Paranoid Android",
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toEqual<MbSearchResult>({ kind: "miss" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// resolveRecordingMbid — fallback pass (normalized title)
// ---------------------------------------------------------------------------

describe("resolveRecordingMbid — fallback pass", () => {
  it("retries with a stripped title when the full title misses, returning hit", async () => {
    const mockFetch = vi
      .fn()
      // First call (full title) — miss
      .mockResolvedValueOnce(MB_EMPTY)
      // Second call (normalized title) — hit
      .mockResolvedValueOnce(mbOk([{ id: "mbid-studio", score: 95 }]));

    const result = await resolveRecordingMbid(
      "Pink Floyd",
      "Comfortably Numb (Remastered)",
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toEqual<MbSearchResult>({ kind: "hit", mbid: "mbid-studio" });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // The second call should use the stripped title.
    const secondUrl = decodeURIComponent(mockFetch.mock.calls[1]![0] as string);
    expect(secondUrl).toContain("Comfortably Numb");
    expect(secondUrl).not.toContain("Remastered");
  });

  it("returns miss when both primary and fallback searches complete but find nothing", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(MB_EMPTY)
      .mockResolvedValueOnce(MB_EMPTY);

    const result = await resolveRecordingMbid(
      "Elton John",
      "Rocket Man (Remastered)",
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toEqual<MbSearchResult>({ kind: "miss" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns error (not miss) when primary errors but fallback completes with no match", async () => {
    // Primary errored → we cannot assert the recording is unresolvable, even
    // though the fallback search completed.  Return error so the sentinel is
    // NOT incremented and the episode is retried on the next pass.
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(MB_ERROR)
      .mockResolvedValueOnce(MB_EMPTY);

    const result = await resolveRecordingMbid(
      "Led Zeppelin",
      "Whole Lotta Love (Remastered)",
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toEqual<MbSearchResult>({ kind: "error" });
  });

  it("returns error when both primary and fallback error (transient failures)", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(MB_ERROR)
      .mockResolvedValueOnce(MB_ERROR);

    const result = await resolveRecordingMbid(
      "Led Zeppelin",
      "Whole Lotta Love (Remastered)",
      mockFetch as unknown as typeof fetch,
    );

    // Both requests failed — return error so the sentinel is NOT incremented.
    expect(result).toEqual<MbSearchResult>({ kind: "error" });
  });

  it("finds a hit from the fallback's top-3 scan when the first fallback result is low-score", async () => {
    const mockFetch = vi
      .fn()
      // Primary: all low-score
      .mockResolvedValueOnce(mbOk([{ id: "mbid-live", score: 65 }]))
      // Fallback: second result is confident
      .mockResolvedValueOnce(
        mbOk([
          { id: "mbid-live2", score: 60 },
          { id: "mbid-studio", score: 90 },
        ]),
      );

    const result = await resolveRecordingMbid(
      "Led Zeppelin",
      "Whole Lotta Love (Remastered)",
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toEqual<MbSearchResult>({ kind: "hit", mbid: "mbid-studio" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns error (not miss) when primary misses but fallback errors", async () => {
    // Symmetric case: fallback errored → we still can't assert unresolvable.
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(MB_EMPTY)
      .mockResolvedValueOnce(MB_ERROR);

    const result = await resolveRecordingMbid(
      "Led Zeppelin",
      "Ramble On (Remastered)",
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toEqual<MbSearchResult>({ kind: "error" });
  });

  it("regression: three mixed error+miss passes never produce a definitive miss", async () => {
    // Simulates three consecutive runPass() calls where each time one pass
    // errors and the other returns no confident results.  The result must
    // always be `error` so the sentinel is never incremented and the episode
    // is not permanently suppressed.
    for (let i = 0; i < 3; i++) {
      const mockFetch = vi
        .fn()
        // Primary errors, fallback returns empty (or vice-versa).
        .mockResolvedValueOnce(i % 2 === 0 ? MB_ERROR : MB_EMPTY)
        .mockResolvedValueOnce(i % 2 === 0 ? MB_EMPTY : MB_ERROR);

      const result = await resolveRecordingMbid(
        "Stevie Wonder",
        "Superstition (Remastered)",
        mockFetch as unknown as typeof fetch,
      );

      expect(result).toEqual<MbSearchResult>(
        { kind: "error" },
      );
    }
  });

  it("does NOT make a second fetch when the normalized title equals the original", async () => {
    // "Bohemian Rhapsody" has no parenthetical qualifier.
    const mockFetch = vi.fn().mockResolvedValue(MB_EMPTY);

    await resolveRecordingMbid(
      "Queen",
      "Bohemian Rhapsody",
      mockFetch as unknown as typeof fetch,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// MAX_MISS_ATTEMPTS constant sanity check
// ---------------------------------------------------------------------------

describe("MAX_MISS_ATTEMPTS", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(MAX_MISS_ATTEMPTS)).toBe(true);
    expect(MAX_MISS_ATTEMPTS).toBeGreaterThan(0);
  });
});
