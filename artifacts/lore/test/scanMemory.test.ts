// @vitest-environment jsdom
/**
 * Scan memory (lib/scanMemory.ts) — the local-first record of what the
 * listener has already scanned: live-scan freshness identities and
 * set-scanner progress with forward-biased resume, stale-set invalidation,
 * and bounded storage.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearScanMemory,
  getScannedIndexes,
  getSetScanProgress,
  hasStaleSetScan,
  isUnchangedSinceLastScan,
  liveScanIdentity,
  recordLiveScan,
  recordSetScan,
} from "../src/lib/scanMemory";

beforeEach(() => {
  localStorage.clear();
  clearScanMemory();
});

describe("liveScanIdentity", () => {
  it("prefers the recording MBID and includes playedAt so replays count as fresh", () => {
    expect(
      liveScanIdentity({ mbid: "m1", artist: "A", title: "T", playedAt: "2026-01-05T15:00:00Z" }),
    ).toBe("mbid:m1@2026-01-05T15:00:00Z");
  });

  it("falls back to normalized artist|title text when unresolved", () => {
    expect(liveScanIdentity({ artist: "  The Beta  ", title: "Song!", playedAt: null }))
      .toBe("text:the beta|song!");
  });

  it("returns null when there is nothing usable to remember", () => {
    expect(liveScanIdentity(null)).toBeNull();
    expect(liveScanIdentity({ artist: "Only Artist" })).toBeNull();
  });
});

describe("live scan freshness", () => {
  it("marks a station unchanged only while the same identity plays", () => {
    const id = liveScanIdentity({ mbid: "m1", playedAt: "2026-01-05T15:00:00Z" });
    recordLiveScan("kexp", id);
    expect(isUnchangedSinceLastScan("kexp", id)).toBe(true);
    // A new spin of a DIFFERENT song is fresh.
    expect(
      isUnchangedSinceLastScan(
        "kexp",
        liveScanIdentity({ mbid: "m2", playedAt: "2026-01-05T15:04:00Z" }),
      ),
    ).toBe(false);
    // A LATER replay of the same song is fresh (playedAt differs).
    expect(
      isUnchangedSinceLastScan(
        "kexp",
        liveScanIdentity({ mbid: "m1", playedAt: "2026-01-05T16:00:00Z" }),
      ),
    ).toBe(false);
  });

  it("is false for stations never scanned or tracks without identity", () => {
    expect(isUnchangedSinceLastScan("kcrw", "mbid:x@t")).toBe(false);
    recordLiveScan("kcrw", "mbid:x@t");
    expect(isUnchangedSinceLastScan("kcrw", null)).toBe(false);
  });

  it("ignores empty slugs and null identities", () => {
    recordLiveScan("", "mbid:x@t");
    recordLiveScan("kexp", null);
    expect(isUnchangedSinceLastScan("kexp", "mbid:x@t")).toBe(false);
  });

  it("evicts the oldest stations past the live cap", () => {
    for (let i = 0; i < 105; i++) recordLiveScan(`s${i}`, `id-${i}`);
    expect(isUnchangedSinceLastScan("s0", "id-0")).toBe(false);
    expect(isUnchangedSinceLastScan("s104", "id-104")).toBe(true);
  });
});

describe("set scanner progress", () => {
  it("records scanned indexes sorted and deduped", () => {
    recordSetScan("kexp", 10, 4);
    recordSetScan("kexp", 10, 2);
    recordSetScan("kexp", 10, 4);
    expect(getScannedIndexes("kexp", 10)).toEqual([2, 4]);
  });

  it("resumes at the first unscanned track after the furthest scanned one", () => {
    for (const i of [0, 1, 2, 3, 4]) recordSetScan("kexp", 10, i);
    const progress = getSetScanProgress("kexp", 10, 12);
    expect(progress?.resumeIndex).toBe(5);
    expect(progress?.scanned).toEqual([0, 1, 2, 3, 4]);
  });

  it("stays at the furthest position when everything past it is scanned", () => {
    for (const i of [0, 1, 2]) recordSetScan("kexp", 10, i);
    expect(getSetScanProgress("kexp", 10, 3)?.resumeIndex).toBe(2);
  });

  it("never goes back: a lone late scan resumes after it, not at 0", () => {
    recordSetScan("kexp", 10, 7);
    expect(getSetScanProgress("kexp", 10, 12)?.resumeIndex).toBe(8);
  });

  it("clamps the resume point into the set", () => {
    recordSetScan("kexp", 10, 11);
    expect(getSetScanProgress("kexp", 10, 12)?.resumeIndex).toBe(11);
  });

  it("returns null for a station with no memory or a stale (older) run", () => {
    expect(getSetScanProgress("kexp", 10, 12)).toBeNull();
    recordSetScan("kexp", 9, 3);
    expect(getSetScanProgress("kexp", 10, 12)).toBeNull();
    expect(hasStaleSetScan("kexp", 10)).toBe(true);
    expect(hasStaleSetScan("kexp", 9)).toBe(false);
  });

  it("replaces progress when a newer run is scanned", () => {
    recordSetScan("kexp", 9, 3);
    recordSetScan("kexp", 10, 1);
    expect(getScannedIndexes("kexp", 10)).toEqual([1]);
    expect(hasStaleSetScan("kexp", 10)).toBe(false);
  });

  it("drops out-of-range indexes from progress", () => {
    recordSetScan("kexp", 10, 50);
    const progress = getSetScanProgress("kexp", 10, 12);
    expect(progress?.scanned).toEqual([]);
    expect(progress?.resumeIndex).toBe(0);
  });

  it("evicts the oldest stations past the set cap", () => {
    for (let i = 0; i < 45; i++) recordSetScan(`st${i}`, 1, 0);
    expect(getScannedIndexes("st0", 1)).toBeNull();
    expect(getScannedIndexes("st44", 1)).toEqual([0]);
  });
});
