/**
 * Unit tests for the Spotify sync receipt logic.
 *
 * These test the pure bucket-classification behaviour without a live DB or
 * Spotify connection — the same "pure-function first" pattern used for the
 * import/export tests.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Receipt shape helpers (extracted from library-sync.ts so they can be
// unit-tested without side-effects)
// ---------------------------------------------------------------------------

interface MatchedItem {
  mbid: string;
  title: string;
  artist: string;
  spotifyId: string;
  confidence: "link" | "isrc" | "search";
}

interface UnmatchedItem {
  mbid: string;
  title: string;
  artist: string;
}

const MBID_A = "aaaaaaaa-1111-2222-3333-444444444444";
const MBID_B = "bbbbbbbb-1111-2222-3333-444444444444";
const MBID_C = "cccccccc-1111-2222-3333-444444444444";
const MBID_D = "dddddddd-1111-2222-3333-444444444444";

/** Mirror of bandcampUrl in library-sync.ts — pure fn, safe to duplicate here. */
function bandcampUrl(artist: string, title: string): string {
  return `https://bandcamp.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
}

/**
 * Derive the sync receipt from match / contains / save results — pure logic.
 * Mirrors the three-phase pipeline in library-sync.ts:
 *   1. toSave = matched minus already-saved (contains check)
 *   2. confirmedSavedIds = what saveBatched actually confirmed (honest receipt)
 *   3. bucket by confidence × confirmed
 */
function buildReceipt(
  matched: MatchedItem[],
  alreadySavedIds: Set<string>,
  unmatched: UnmatchedItem[],
  /** IDs confirmed saved by saveBatched (defaults to all toSave for happy-path tests) */
  confirmedOverride?: Set<string>,
  cap = 200,
) {
  const toSave = matched.filter((m) => !alreadySavedIds.has(m.spotifyId));
  const alreadySavedCount = matched.length - toSave.length;
  const confirmedSavedIds = confirmedOverride ?? new Set(toSave.map((m) => m.spotifyId));
  const exactSynced = toSave.filter(
    (m) => confirmedSavedIds.has(m.spotifyId) && (m.confidence === "link" || m.confidence === "isrc"),
  );
  const searchSynced = toSave.filter(
    (m) => confirmedSavedIds.has(m.spotifyId) && m.confidence === "search",
  );

  return {
    synced: exactSynced.length,
    searchMatched: searchSynced.length,
    alreadySaved: alreadySavedCount,
    unavailable: unmatched.length,
    unavailableItems: unmatched.slice(0, cap).map((u) => ({
      mbid: u.mbid,
      title: u.title,
      artist: u.artist,
      bandcampUrl: bandcampUrl(u.artist, u.title),
    })),
    searchMatchedItems: searchSynced.slice(0, cap).map((m) => ({
      mbid: m.mbid,
      title: m.title,
      artist: m.artist,
      spotifyUrl: `https://open.spotify.com/track/${m.spotifyId}`,
    })),
  };
}

// ---------------------------------------------------------------------------

describe("sync receipt bucketing", () => {
  it("buckets isrc+link matches as synced and search matches separately", () => {
    const matched: MatchedItem[] = [
      { mbid: MBID_A, title: "Track A", artist: "Artist A", spotifyId: "sp1", confidence: "isrc" },
      { mbid: MBID_B, title: "Track B", artist: "Artist B", spotifyId: "sp2", confidence: "link" },
      { mbid: MBID_C, title: "Track C", artist: "Artist C", spotifyId: "sp3", confidence: "search" },
    ];
    const r = buildReceipt(matched, new Set(), []);
    expect(r.synced).toBe(2);
    expect(r.searchMatched).toBe(1);
    expect(r.alreadySaved).toBe(0);
    expect(r.unavailable).toBe(0);
    expect(r.searchMatchedItems).toHaveLength(1);
    expect(r.searchMatchedItems[0]?.mbid).toBe(MBID_C);
    expect(r.searchMatchedItems[0]?.spotifyUrl).toContain("sp3");
  });

  it("idempotency: already-saved tracks are counted but not re-saved", () => {
    const matched: MatchedItem[] = [
      { mbid: MBID_A, title: "A", artist: "Aa", spotifyId: "sp1", confidence: "isrc" },
      { mbid: MBID_B, title: "B", artist: "Bb", spotifyId: "sp2", confidence: "isrc" },
    ];
    // Both already in Spotify
    const r = buildReceipt(matched, new Set(["sp1", "sp2"]), []);
    expect(r.synced).toBe(0);
    expect(r.alreadySaved).toBe(2);
    expect(r.searchMatched).toBe(0);
  });

  it("partial idempotency: one already saved, one new", () => {
    const matched: MatchedItem[] = [
      { mbid: MBID_A, title: "A", artist: "Aa", spotifyId: "sp1", confidence: "isrc" },
      { mbid: MBID_B, title: "B", artist: "Bb", spotifyId: "sp2", confidence: "isrc" },
    ];
    const r = buildReceipt(matched, new Set(["sp1"]), []);
    expect(r.synced).toBe(1);
    expect(r.alreadySaved).toBe(1);
  });

  it("unavailable items get Bandcamp search links", () => {
    const unmatched: UnmatchedItem[] = [
      { mbid: MBID_D, title: "Obscure B-Side", artist: "The Recluse" },
    ];
    const r = buildReceipt([], new Set(), unmatched);
    expect(r.unavailable).toBe(1);
    expect(r.unavailableItems[0]?.bandcampUrl).toBe(
      "https://bandcamp.com/search?q=The%20Recluse%20Obscure%20B-Side",
    );
    expect(r.unavailableItems[0]?.mbid).toBe(MBID_D);
  });

  it("receipt list is capped at the configured limit", () => {
    const unmatched: UnmatchedItem[] = Array.from({ length: 300 }, (_, i) => ({
      mbid: `${"a".repeat(8)}-0000-0000-0000-${String(i).padStart(12, "0")}`,
      title: `Track ${i}`,
      artist: `Artist ${i}`,
    }));
    const r = buildReceipt([], new Set(), unmatched, 200);
    expect(r.unavailable).toBe(300); // total count is accurate
    expect(r.unavailableItems).toHaveLength(200); // list is capped
  });

  it("second-run is a no-op when all tracks are already saved (full idempotency)", () => {
    const matched: MatchedItem[] = [
      { mbid: MBID_A, title: "A", artist: "Aa", spotifyId: "sp1", confidence: "isrc" },
      { mbid: MBID_B, title: "B", artist: "Bb", spotifyId: "sp2", confidence: "search" },
    ];
    const r1 = buildReceipt(matched, new Set(), []);
    // Simulate second run: everything already saved
    const r2 = buildReceipt(matched, new Set(["sp1", "sp2"]), []);
    expect(r1.synced + r1.searchMatched).toBe(2);
    expect(r2.synced).toBe(0);
    expect(r2.searchMatched).toBe(0);
    expect(r2.alreadySaved).toBe(2);
  });

  it("mixed scenario: some synced, some already saved, some not on Spotify", () => {
    const matched: MatchedItem[] = [
      { mbid: MBID_A, title: "A", artist: "Aa", spotifyId: "sp1", confidence: "isrc" },
      { mbid: MBID_B, title: "B", artist: "Bb", spotifyId: "sp2", confidence: "search" },
      { mbid: MBID_C, title: "C", artist: "Cc", spotifyId: "sp3", confidence: "link" },
    ];
    const unmatched: UnmatchedItem[] = [
      { mbid: MBID_D, title: "D", artist: "Dd" },
    ];
    const r = buildReceipt(matched, new Set(["sp2"]), unmatched);
    expect(r.synced).toBe(2);          // A (isrc) + C (link)
    expect(r.searchMatched).toBe(0);   // B was already saved
    expect(r.alreadySaved).toBe(1);    // B
    expect(r.unavailable).toBe(1);     // D
  });

  it("partial save failure: only confirmed IDs count — failed batch not in receipt", () => {
    // sp1 + sp2 attempted; only sp1 confirmed (sp2 batch failed)
    const matched: MatchedItem[] = [
      { mbid: MBID_A, title: "A", artist: "Aa", spotifyId: "sp1", confidence: "isrc" },
      { mbid: MBID_B, title: "B", artist: "Bb", spotifyId: "sp2", confidence: "isrc" },
    ];
    const confirmedOnly = new Set(["sp1"]); // sp2 batch PUT failed
    const r = buildReceipt(matched, new Set(), [], confirmedOnly);
    expect(r.synced).toBe(1);      // only sp1 confirmed
    expect(r.alreadySaved).toBe(0);
    expect(r.unavailable).toBe(0); // unmatched is empty; sp2 just wasn't confirmed
  });

  it("partial save failure: search-matched track not in confirmed set stays out of searchMatched", () => {
    const matched: MatchedItem[] = [
      { mbid: MBID_A, title: "A", artist: "Aa", spotifyId: "sp1", confidence: "search" },
      { mbid: MBID_B, title: "B", artist: "Bb", spotifyId: "sp2", confidence: "search" },
    ];
    // Only sp2 PUT batch succeeded
    const confirmed = new Set(["sp2"]);
    const r = buildReceipt(matched, new Set(), [], confirmed);
    expect(r.searchMatched).toBe(1);
    expect(r.searchMatchedItems[0]?.mbid).toBe(MBID_B);
    expect(r.synced).toBe(0);
  });

  it("contains-check 429 is treated as unsaved (conservative: will attempt save)", () => {
    // Simulates containsCheck returning empty set on 429 failure —
    // all tracks proceed to save attempt rather than being skipped.
    const matched: MatchedItem[] = [
      { mbid: MBID_A, title: "A", artist: "Aa", spotifyId: "sp1", confidence: "isrc" },
    ];
    // containsCheck returned empty (failed after retry) → nothing pre-filtered
    const alreadySaved = new Set<string>(); // empty = conservative
    const confirmed = new Set(["sp1"]);     // save succeeded
    const r = buildReceipt(matched, alreadySaved, [], confirmed);
    expect(r.synced).toBe(1);
    expect(r.alreadySaved).toBe(0); // not counted as already-saved (unknown)
  });
});

describe("Bandcamp URL encoding", () => {
  it("encodes special characters in artist and title", () => {
    const url = bandcampUrl("Sigur Rós", "Hoppípolla");
    expect(url).toBe(
      `https://bandcamp.com/search?q=${encodeURIComponent("Sigur Rós Hoppípolla")}`,
    );
  });

  it("produces a valid URL even for empty strings", () => {
    const url = bandcampUrl("", "");
    // " " between two empty strings encodes to %20 — still a valid search URL
    expect(url).toContain("https://bandcamp.com/search?q=");
  });
});
