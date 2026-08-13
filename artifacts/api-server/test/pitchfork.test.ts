import { describe, it, expect } from "vitest";
import {
  tokenise,
  hasTokenOverlap,
  extractArtistNames,
  extractAlbumNames,
  pickMatchingReview,
  buildPitchforkClaimText,
} from "../src/lore/pitchfork.js";

// ---------------------------------------------------------------------------
// tokenise
// ---------------------------------------------------------------------------

describe("tokenise", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenise("Radiohead")).toEqual(["radiohead"]);
    expect(tokenise("OK Computer")).toEqual(["ok", "computer"]);
  });

  it("strips punctuation and collapses spaces", () => {
    expect(tokenise("Ys (Deluxe)")).toEqual(["ys", "deluxe"]);
    expect(tokenise("U2 — Achtung Baby")).toEqual(["u2", "achtung", "baby"]);
  });

  it("filters out single-character tokens", () => {
    expect(tokenise("A Tribe Called Quest")).toEqual(["tribe", "called", "quest"]);
  });

  it("returns empty array for blank input", () => {
    expect(tokenise("")).toEqual([]);
    expect(tokenise("   ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasTokenOverlap
// ---------------------------------------------------------------------------

describe("hasTokenOverlap", () => {
  it("matches when artist token appears in candidate", () => {
    expect(hasTokenOverlap("Radiohead", "Radiohead")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasTokenOverlap("radiohead", "RADIOHEAD")).toBe(true);
  });

  it("matches on any shared token (partial name / The-prefix)", () => {
    expect(hasTokenOverlap("The National", "National")).toBe(true);
    expect(hasTokenOverlap("Beach House", "Beach House")).toBe(true);
  });

  it("rejects when no token overlaps", () => {
    expect(hasTokenOverlap("Radiohead", "Taylor Swift")).toBe(false);
  });

  it("rejects spurious single-char matches (filtered out)", () => {
    // "A" is filtered, so "a" in source can't match "A" in candidate
    expect(hasTokenOverlap("A Place to Bury Strangers", "Taylor Swift")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractArtistNames
// ---------------------------------------------------------------------------

describe("extractArtistNames", () => {
  it("returns empty array when tombstone is absent", () => {
    expect(extractArtistNames({})).toEqual([]);
  });

  it("extracts from top-level tombstone.artists", () => {
    const item = {
      tombstone: {
        artists: [{ display_name: "Radiohead" }],
      },
    };
    expect(extractArtistNames(item)).toEqual(["Radiohead"]);
  });

  it("extracts from per-album artist entries", () => {
    const item = {
      tombstone: {
        albums: [{ artists: [{ display_name: "Beach House" }] }],
      },
    };
    expect(extractArtistNames(item)).toEqual(["Beach House"]);
  });

  it("collects artists from both top-level and per-album entries", () => {
    const item = {
      tombstone: {
        artists: [{ display_name: "Bon Iver" }],
        albums: [{ artists: [{ display_name: "Bon Iver" }] }],
      },
    };
    expect(extractArtistNames(item)).toEqual(["Bon Iver", "Bon Iver"]);
  });

  it("skips entries without display_name", () => {
    const item = {
      tombstone: {
        artists: [{}],
        albums: [{ artists: [{}] }],
      },
    };
    expect(extractArtistNames(item)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractAlbumNames
// ---------------------------------------------------------------------------

describe("extractAlbumNames", () => {
  it("returns empty array when tombstone is absent", () => {
    expect(extractAlbumNames({})).toEqual([]);
  });

  it("returns album display names", () => {
    const item = {
      tombstone: {
        albums: [{ album: { display_name: "OK Computer" } }],
      },
    };
    expect(extractAlbumNames(item)).toEqual(["OK Computer"]);
  });

  it("skips album entries without display_name", () => {
    const item = {
      tombstone: {
        albums: [{ album: {} }, { album: { display_name: "Kid A" } }],
      },
    };
    expect(extractAlbumNames(item)).toEqual(["Kid A"]);
  });
});

// ---------------------------------------------------------------------------
// pickMatchingReview — artist-only mode (albumHint = null)
// ---------------------------------------------------------------------------

describe("pickMatchingReview (artist only)", () => {
  const okComputer = {
    url: "/reviews/albums/radiohead-ok-computer/",
    rating: { rating: "10.0" },
    tombstone: {
      artists: [{ display_name: "Radiohead" }],
      albums: [{ album: { display_name: "OK Computer" }, artists: [{ display_name: "Radiohead" }] }],
    },
  };

  const amnesiac = {
    url: "/reviews/albums/radiohead-amnesiac/",
    rating: { rating: "8.5" },
    tombstone: {
      artists: [{ display_name: "Radiohead" }],
      albums: [{ album: { display_name: "Amnesiac" }, artists: [{ display_name: "Radiohead" }] }],
    },
  };

  it("returns the first artist-matched item when no albumHint", () => {
    const result = pickMatchingReview([okComputer, amnesiac], "Radiohead", null);
    expect(result).toBe(okComputer);
  });

  it("rejects items with no artist overlap", () => {
    const wrongArtist = {
      tombstone: { artists: [{ display_name: "Taylor Swift" }] },
    };
    expect(pickMatchingReview([wrongArtist], "Radiohead", null)).toBeNull();
  });

  it("returns null for an empty results list", () => {
    expect(pickMatchingReview([], "Radiohead", null)).toBeNull();
  });

  it("skips items with no tombstone/artist info", () => {
    const noArtist = { url: "/reviews/albums/something/" };
    expect(pickMatchingReview([noArtist], "Radiohead", null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pickMatchingReview — artist + album mode (albumHint supplied)
// ---------------------------------------------------------------------------

describe("pickMatchingReview (artist + album)", () => {
  const okComputer = {
    url: "/reviews/albums/radiohead-ok-computer/",
    rating: { rating: "10.0" },
    tombstone: {
      albums: [{ album: { display_name: "OK Computer" }, artists: [{ display_name: "Radiohead" }] }],
    },
  };

  const kidA = {
    url: "/reviews/albums/radiohead-kid-a/",
    rating: { rating: "10.0" },
    tombstone: {
      albums: [{ album: { display_name: "Kid A" }, artists: [{ display_name: "Radiohead" }] }],
    },
  };

  it("matches when both artist and album overlap", () => {
    const result = pickMatchingReview([okComputer, kidA], "Radiohead", "OK Computer");
    expect(result).toBe(okComputer);
  });

  it("skips results whose album does not overlap, even when artist matches", () => {
    // First result is Amnesiac; albumHint is OK Computer — should not match
    const amnesiac = {
      tombstone: {
        albums: [{ album: { display_name: "Amnesiac" }, artists: [{ display_name: "Radiohead" }] }],
      },
    };
    expect(pickMatchingReview([amnesiac], "Radiohead", "OK Computer")).toBeNull();
  });

  it("falls through to the second result when the first album mismatches", () => {
    // kidA comes first; albumHint is OK Computer — should skip kidA, return okComputer
    const result = pickMatchingReview([kidA, okComputer], "Radiohead", "OK Computer");
    expect(result).toBe(okComputer);
  });

  it("returns null when artist matches but no album matches the hint", () => {
    expect(pickMatchingReview([okComputer], "Radiohead", "The Bends")).toBeNull();
  });

  it("returns null when artist does not match regardless of album", () => {
    expect(pickMatchingReview([okComputer], "Portishead", "OK Computer")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPitchforkClaimText
// ---------------------------------------------------------------------------

describe("buildPitchforkClaimText", () => {
  it("includes score and accolade when both are present", () => {
    const text = buildPitchforkClaimText({
      rating: { rating: "8.8" },
      accolade: "Best New Music",
    });
    expect(text).toBe("Rated 8.8/10 by Pitchfork. Best New Music");
  });

  it("includes only score when no accolade", () => {
    const text = buildPitchforkClaimText({ rating: { rating: "7.2" } });
    expect(text).toBe("Rated 7.2/10 by Pitchfork.");
  });

  it("includes only accolade when no rating", () => {
    const text = buildPitchforkClaimText({ accolade: "Best New Reissue" });
    expect(text).toBe("Best New Reissue");
  });

  it("falls back to a generic string when neither is present", () => {
    const text = buildPitchforkClaimText({});
    expect(text).toBe("Reviewed by Pitchfork.");
  });

  it("handles null rating value gracefully", () => {
    const text = buildPitchforkClaimText({ rating: { rating: null } });
    expect(text).toBe("Reviewed by Pitchfork.");
  });
});
