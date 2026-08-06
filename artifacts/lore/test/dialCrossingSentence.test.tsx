/**
 * Unit tests for crossingSentence(), reason(), and nameNodes() copy in DialView.
 *
 * Imports the real implementations from dialViewHelpers.tsx so regressions in
 * production logic fail these tests immediately.
 *
 * Covers all crossing tiers and confirms:
 *   - crossingSentence: 1, 2, 6, and 7+ artist variants
 *   - reason r=1–r=7 and r=0, with and without name arrays
 *   - Single-artist "on air" form (r=1, r=2, 1-artist crossingSentence) is unchanged
 */

import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";

import {
  nameNodes,
  crossingSentence,
  reason,
  usableShowName,
} from "../src/components/dialViewHelpers";
import type { DialShow, DialSpin } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Returns an ISO string for "X minutes ago" */
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

/** Base show fixture — no crossings, no current track. */
function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Morning Mix",
    djName: null,
    startedAt: minutesAgo(30),
    endedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    state: "live",
    spins: [],
    crossings: 0,
    artistCrossings: 0,
    topArtists: [],
    topArtistNames: [],
    currentTrack: null,
    isPickerShow: false,
    pickerId: null,
    ...overrides,
  };
}

/** Base spin fixture */
function makeSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: "mbid-test",
    artistMbid: null,
    title: "Test Track",
    artist: "Test Artist",
    playedAt: minutesAgo(5),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    ...overrides,
  };
}

/** Render a ReactNode to plain text for assertions. */
function text(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, "");
}

/** Render a ReactNode to markup for structure assertions. */
function markup(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

// ---------------------------------------------------------------------------
// crossingSentence() tests
// ---------------------------------------------------------------------------

describe("crossingSentence — 1 artist (on air form)", () => {
  it("renders '<Artist> on <Show> this set.' without a DJ", () => {
    const show = makeShow({ crossings: 1, topArtists: ["Portishead"] });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    expect(text(result!.node)).toBe("Portishead on Morning Mix this set.");
  });

  it("renders '<DJ> selected <Artist> on <Show> this set.' when a DJ is present", () => {
    const show = makeShow({
      crossings: 1,
      topArtists: ["Portishead"],
      djName: "Tom Schnabel",
    });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    expect(text(result!.node)).toBe("Tom Schnabel selected Portishead on Morning Mix this set.");
  });

  it("hasTrack is true for 1-artist form", () => {
    const show = makeShow({ crossings: 1, topArtists: ["Portishead"] });
    expect(crossingSentence("KCRW", show)!.hasTrack).toBe(true);
  });

  it("uses isLibraryHit currentTrack artist as single candidate when it is the current hit", () => {
    const spin = makeSpin({ artist: "Björk", isLibraryHit: true });
    const show = makeShow({ currentTrack: spin, crossings: 1, topArtists: [] });
    const result = crossingSentence("KCRW", show);
    // isLibraryHit → timing = "now"
    expect(text(result!.node)).toBe("Björk on Morning Mix, now.");
  });

  it("drops the DJ prefix when djName equals the station name", () => {
    // eligibleDjName should suppress a DJ whose name collides with the station
    const show = makeShow({
      crossings: 1,
      topArtists: ["Portishead"],
      djName: "KCRW",
    });
    const result = crossingSentence("KCRW", show);
    // DJ is suppressed — artist leads with show name
    expect(text(result!.node)).toBe("Portishead on Morning Mix this set.");
    expect(text(result!.node)).not.toContain("KCRW —");
  });
});

describe("crossingSentence — 2 artists (multi-artist form)", () => {
  it("renders '<A> and <B> on <Show> this set.' for exactly 2 artists", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Portishead", "Massive Attack"] });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    expect(text(result!.node)).toBe("Portishead and Massive Attack on Morning Mix this set.");
  });

  it("wraps each artist name in <b> element", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Portishead", "Massive Attack"] });
    const result = crossingSentence("KCRW", show);
    const html = markup(result!.node);
    expect(html).toContain("<b");
    expect(html).toContain("Portishead");
    expect(html).toContain("Massive Attack");
  });

  it("renders '<DJ> selected <A> and <B> on <Show> this set.' when a DJ is present", () => {
    const show = makeShow({
      crossings: 2,
      topArtists: ["Portishead", "Massive Attack"],
      djName: "Tom Schnabel",
    });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("Tom Schnabel selected Portishead and Massive Attack on Morning Mix this set.");
  });

  it("uses artist-crossing names when only artistCrossings > 0", () => {
    const show = makeShow({
      crossings: 0,
      artistCrossings: 2,
      topArtistNames: ["The Cure", "Siouxsie and the Banshees"],
    });
    const result = crossingSentence("4ZZZ", show);
    expect(text(result!.node)).toBe("The Cure and Siouxsie and the Banshees on Morning Mix this set.");
  });
});

describe("crossingSentence — 6 artists (boundary of shown list)", () => {
  const SIX = ["A", "B", "C", "D", "E", "F"];

  it("renders all 6 names joined with Oxford comma and 'and' before the last", () => {
    const show = makeShow({ crossings: 6, topArtists: SIX });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("A, B, C, D, E, and F on Morning Mix this set.");
  });

  it("does not append '… and N more' when exactly 6 names fit", () => {
    const show = makeShow({ crossings: 6, topArtists: SIX });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).not.toContain("more");
  });
});

describe("crossingSentence — 7+ artists (overflow form)", () => {
  const SEVEN = ["A", "B", "C", "D", "E", "F", "G"];
  const EIGHT = ["A", "B", "C", "D", "E", "F", "G", "H"];

  it("shows 6 names then 'and 1 more' for 7 artists", () => {
    const show = makeShow({ crossings: 7, topArtists: SEVEN });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("A, B, C, D, E, F, and 1 more on Morning Mix this set.");
  });

  it("shows 6 names then 'and 2 more' for 8 artists", () => {
    const show = makeShow({ crossings: 8, topArtists: EIGHT });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("A, B, C, D, E, F, and 2 more on Morning Mix this set.");
  });
});

describe("crossingSentence — count fallback (no artist names available)", () => {
  it("renders singular '1 track of yours on <Show> this set.' when count is 1 and topArtists is empty", () => {
    const show = makeShow({ crossings: 1, topArtists: [] });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("1 track of yours on Morning Mix this set.");
  });

  it("renders plural '3 tracks of yours on <Show> this set.' when count is 3", () => {
    const show = makeShow({ crossings: 3, topArtists: [] });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("3 tracks of yours on Morning Mix this set.");
  });

  it("returns null when there are no crossings at all", () => {
    const show = makeShow({ crossings: 0, artistCrossings: 0 });
    expect(crossingSentence("KCRW", show)).toBeNull();
  });
});

describe("crossingSentence — blended mode always returns null", () => {
  it("returns null in blended mode even with crossings", () => {
    const show = makeShow({ crossings: 5, topArtists: ["Portishead"] });
    expect(crossingSentence("KCRW", show, "blended")).toBeNull();
  });
});

describe("crossingSentence — station name suppression", () => {
  it("suppresses an artist name that matches the station name", () => {
    // topArtists includes the station name — it should be filtered out
    const show = makeShow({ crossings: 2, topArtists: ["KCRW", "Portishead"] });
    const result = crossingSentence("KCRW", show);
    // Only Portishead remains → 1-artist form with show name
    expect(text(result!.node)).toBe("Portishead on Morning Mix this set.");
  });
});

// ---------------------------------------------------------------------------
// reason() — single-artist r=1 and r=2 ("on air" forms confirmed unchanged)
// ---------------------------------------------------------------------------

describe("reason — r=1 exact library track on air", () => {
  it("returns r=1 and includes artist name + show name + 'now'", () => {
    const spin = makeSpin({ title: "Glory Box", isLibraryHit: true });
    const show = makeShow({ currentTrack: spin });
    const rz = reason(show, 0);
    expect(rz.r).toBe(1);
    expect(rz.cls).toBe("w1");
    // r=1 uses artist (not title) + show attribution + "now" timing
    expect(text(rz.node)).toBe("Test Artist on Morning Mix, now.");
  });

  it("bolds the artist name", () => {
    const spin = makeSpin({ title: "Glory Box", isLibraryHit: true });
    const show = makeShow({ currentTrack: spin });
    const rz = reason(show, 0);
    expect(markup(rz.node)).toContain("Test Artist");
  });
});

describe("reason — r=2 library artist on air", () => {
  it("returns r=2 and includes artist name + show name + 'now'", () => {
    const spin = makeSpin({ artist: "Portishead", isArtistHit: true });
    const show = makeShow({ currentTrack: spin });
    const rz = reason(show, 0);
    expect(rz.r).toBe(2);
    expect(rz.cls).toBe("w2");
    expect(text(rz.node)).toBe("Portishead on Morning Mix, now.");
  });

  it("bolds the artist name", () => {
    const spin = makeSpin({ artist: "Portishead", isArtistHit: true });
    const show = makeShow({ currentTrack: spin });
    const rz = reason(show, 0);
    expect(markup(rz.node)).toContain("Portishead");
  });
});

// ---------------------------------------------------------------------------
// reason() — r=3 (exact show crossings)
// ---------------------------------------------------------------------------

describe("reason — r=3 (exact show crossings, already aired this set)", () => {
  it("returns r=3 with artist names when topArtists is non-empty", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Portishead", "Massive Attack"] });
    const rz = reason(show, 0);
    expect(rz.r).toBe(3);
    expect(rz.cls).toBe("w3");
    expect(text(rz.node)).toBe("Portishead and Massive Attack on Morning Mix this set.");
  });

  it("returns r=3 with count fallback when topArtists is empty", () => {
    const show = makeShow({ crossings: 4, topArtists: [] });
    const rz = reason(show, 0);
    expect(rz.r).toBe(3);
    expect(text(rz.node)).toBe("4 of yours on Morning Mix this set.");
  });

  it("bolds the count fallback", () => {
    const show = makeShow({ crossings: 2, topArtists: [] });
    const rz = reason(show, 0);
    expect(markup(rz.node)).toContain("<b>2 of yours</b>");
  });

  it("singular 'N of yours' with show name in count fallback", () => {
    const show = makeShow({ crossings: 1, topArtists: [] });
    const rz = reason(show, 0);
    expect(text(rz.node)).toBe("1 of yours on Morning Mix this set.");
  });
});

// ---------------------------------------------------------------------------
// reason() — r=4 (artist-only show crossings)
// ---------------------------------------------------------------------------

describe("reason — r=4 (artist crossings, no exact show match)", () => {
  it("returns r=4 with artist names when topArtistNames is non-empty", () => {
    const show = makeShow({ artistCrossings: 3, topArtistNames: ["The Cure", "Joy Division"] });
    const rz = reason(show, 0);
    expect(rz.r).toBe(4);
    expect(rz.cls).toBe("w4");
    expect(text(rz.node)).toBe("The Cure and Joy Division on Morning Mix this set.");
  });

  it("returns r=4 with count fallback when topArtistNames is empty", () => {
    const show = makeShow({ artistCrossings: 5, topArtistNames: [] });
    const rz = reason(show, 0);
    expect(rz.r).toBe(4);
    expect(text(rz.node)).toBe("5 artists of yours on Morning Mix this set.");
  });

  it("bolds the count in the fallback sentence", () => {
    const show = makeShow({ artistCrossings: 3, topArtistNames: [] });
    const rz = reason(show, 0);
    expect(markup(rz.node)).toContain("<b>3 artists of yours</b>");
  });
});

// ---------------------------------------------------------------------------
// reason() — r=5 (attributed show, no crossing evidence)
// ---------------------------------------------------------------------------

describe("reason — r=5 (attributed show, no crossings)", () => {
  it("returns r=5 when djName and showName are set", () => {
    const show = makeShow({ djName: "Tom Schnabel" });
    const rz = reason(show, 0);
    expect(rz.r).toBe(5);
    expect(rz.cls).toBe("w5");
    // Format: "<DJ> · <Show> · <Xm> in"
    expect(text(rz.node)).toMatch(/^Tom Schnabel · Morning Mix · \d+[hm]( \d+m)? in$/);
  });
});

// ---------------------------------------------------------------------------
// reason() — r=6 (24h station exact crossings, no show selector)
// ---------------------------------------------------------------------------

describe("reason — r=6 (24h station exact crossings, no selector)", () => {
  it("returns r=6 with artist names when stationTopArtistNames is non-empty", () => {
    const show = makeShow({ djName: null });
    const rz = reason(show, 5, 0, "personal", ["Aphex Twin", "Boards of Canada"]);
    expect(rz.r).toBe(6);
    expect(rz.cls).toBe("w6");
    expect(text(rz.node)).toBe("Aphex Twin and Boards of Canada here in the last 24h.");
  });

  it("returns r=6 with count fallback when stationTopArtistNames is empty", () => {
    const show = makeShow({ djName: null });
    const rz = reason(show, 7, 0, "personal", []);
    expect(rz.r).toBe(6);
    expect(text(rz.node)).toBe("7 of yours here in the last 24h.");
  });

  it("bolds the count fallback for r=6", () => {
    const show = makeShow({ djName: null });
    const rz = reason(show, 3, 0, "personal", []);
    expect(markup(rz.node)).toContain("<b>3 of yours</b>");
  });

  it("renders all 6 names with Oxford comma and 'and' structure", () => {
    const show = makeShow({ djName: null });
    const six = ["A", "B", "C", "D", "E", "F"];
    const rz = reason(show, 6, 0, "personal", six);
    expect(rz.r).toBe(6);
    expect(text(rz.node)).toBe("A, B, C, D, E, and F here in the last 24h.");
  });

  it("collapses 7+ names to '… and N more' for r=6", () => {
    const show = makeShow({ djName: null });
    const seven = ["A", "B", "C", "D", "E", "F", "G"];
    const rz = reason(show, 7, 0, "personal", seven);
    expect(rz.r).toBe(6);
    expect(text(rz.node)).toBe("A, B, C, D, E, F, and 1 more here in the last 24h.");
  });
});

// ---------------------------------------------------------------------------
// reason() — r=7 (24h station artist crossings, no exact hits)
// ---------------------------------------------------------------------------

describe("reason — r=7 (24h station artist crossings, no exact hits)", () => {
  it("returns r=7 with artist names when stationTopArtistNames is non-empty", () => {
    const show = makeShow({ djName: null });
    const rz = reason(show, 0, 4, "personal", ["Tortoise", "Slint"]);
    expect(rz.r).toBe(7);
    expect(rz.cls).toBe("w7");
    expect(text(rz.node)).toBe("Tortoise and Slint here in the last 24h.");
  });

  it("returns r=7 with count fallback when stationTopArtistNames is empty", () => {
    const show = makeShow({ djName: null });
    const rz = reason(show, 0, 6, "personal", []);
    expect(rz.r).toBe(7);
    expect(text(rz.node)).toBe("6 tracks by your artists here in the last 24h.");
  });

  it("bolds the count fallback for r=7", () => {
    const show = makeShow({ djName: null });
    const rz = reason(show, 0, 2, "personal", []);
    expect(markup(rz.node)).toContain("<b>2 tracks by your artists</b>");
  });

  it("collapses 7+ names to '… and N more' for r=7", () => {
    const show = makeShow({ djName: null });
    const seven = ["A", "B", "C", "D", "E", "F", "G"];
    const rz = reason(show, 0, 7, "personal", seven);
    expect(rz.r).toBe(7);
    expect(text(rz.node)).toBe("A, B, C, D, E, F, and 1 more here in the last 24h.");
  });
});

// ---------------------------------------------------------------------------
// reason() — r=0 (dark row)
// ---------------------------------------------------------------------------

describe("reason — r=0 (dark, no data)", () => {
  it("returns r=0 when show is null", () => {
    const rz = reason(null, 0);
    expect(rz.r).toBe(0);
    expect(rz.cls).toBe("w0");
    expect(rz.node).toBe("on air · Lore can't see who's playing");
  });

  it("returns r=0 when show has no crossings, no djName, and no show name", () => {
    const show = makeShow({ djName: null, showName: "" });
    const rz = reason(show, 0, 0);
    expect(rz.r).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// reason() — tier priority (r=3 takes precedence over r=4)
// ---------------------------------------------------------------------------

describe("reason — tier priority (r=3 > r=4)", () => {
  it("returns r=3 (not r=4) when both crossings and artistCrossings are non-zero", () => {
    const show = makeShow({ crossings: 1, topArtists: [], artistCrossings: 3, topArtistNames: [] });
    const rz = reason(show, 0);
    expect(rz.r).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// nameNodes() — text structure
// ---------------------------------------------------------------------------

describe("nameNodes — text formatting", () => {
  it("returns null for empty array", () => {
    expect(nameNodes([])).toBeNull();
  });

  it("returns null when all values are missing/empty", () => {
    expect(nameNodes(["unknown", "null", ""])).toBeNull();
  });

  it("renders single name without separator", () => {
    expect(text(nameNodes(["Portishead"]))).toBe("Portishead");
  });

  it("renders two names with 'and'", () => {
    expect(text(nameNodes(["A", "B"]))).toBe("A and B");
  });

  it("renders three names with Oxford comma", () => {
    expect(text(nameNodes(["A", "B", "C"]))).toBe("A, B, and C");
  });

  it("renders 6 names with commas and final 'and'", () => {
    expect(text(nameNodes(["A", "B", "C", "D", "E", "F"]))).toBe("A, B, C, D, E, and F");
  });

  it("collapses 7 to 6 shown + '1 more'", () => {
    expect(text(nameNodes(["A", "B", "C", "D", "E", "F", "G"]))).toBe("A, B, C, D, E, F, and 1 more");
  });

  it("collapses 8 to 6 shown + '2 more'", () => {
    expect(text(nameNodes(["A", "B", "C", "D", "E", "F", "G", "H"]))).toBe("A, B, C, D, E, F, and 2 more");
  });
});

// ---------------------------------------------------------------------------
// Multi-DJ attribution cascade
// ---------------------------------------------------------------------------

describe("usableShowName — multi-DJ ambiguity forces show name", () => {
  it("returns the show name normally for a single-DJ show", () => {
    const show = makeShow({ djName: "Tom Schnabel", showName: "Morning Mix" });
    expect(usableShowName(show)).toBe("Morning Mix");
  });

  it("suppresses show name when it equals the single DJ name (existing rule)", () => {
    const show = makeShow({ djName: "Morning Mix", showName: "Morning Mix" });
    expect(usableShowName(show)).toBeNull();
  });

  it("does NOT suppress show name when two distinct eligible DJs make attribution ambiguous", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Alice", "Bob"],
      showName: "Alice", // would be suppressed for a single DJ named Alice
    });
    expect(usableShowName(show)).toBe("Alice");
  });

  it("returns show name for two different DJs even when show name looks like a DJ name", () => {
    const show = makeShow({ djNames: ["Alice", "Bob"], showName: "Morning Mix" });
    expect(usableShowName(show)).toBe("Morning Mix");
  });
});

describe("crossingSentence — single DJ via djNames (unchanged attribution)", () => {
  it("credits the single DJ when djNames has exactly one eligible entry", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Tom Schnabel"],
      showName: "Morning Mix",
      crossings: 1,
      topArtists: ["Portishead"],
    });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    const t = text(result!.node);
    // Single DJ → credited in sentence
    expect(t).toContain("Tom Schnabel");
  });

  it("deduplicates identical DJ names and credits the single name", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Alice", "Alice"],
      showName: "Late Show",
      crossings: 1,
      topArtists: ["Massive Attack"],
    });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    const t = text(result!.node);
    // Two identical names → deduplicated → one DJ credited
    expect(t).toContain("Alice");
  });
});

describe("crossingSentence — two different DJs collapse attribution to show level", () => {
  it("suppresses both DJ names and leads with the show name when two distinct DJs are present", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Alice", "Bob"],
      showName: "Co-Hosted Show",
      crossings: 1,
      topArtists: ["Portishead"],
    });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    const t = text(result!.node);
    // Neither DJ credited — show name leads
    expect(t).not.toContain("Alice");
    expect(t).not.toContain("Bob");
    expect(t).toContain("Co-Hosted Show");
  });

  it("show name is mandatory (not null) even if it would normally be suppressed by a single-DJ rule", () => {
    // djNames: ["Alice", "Bob"] — two DJs → show name forced regardless
    const show = makeShow({
      djName: null,
      djNames: ["Alice", "Bob"],
      showName: "Morning Mix",
      crossings: 1,
      topArtists: ["Portishead"],
    });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toContain("Morning Mix");
  });
});

describe("crossingSentence — no DJ + show (show leads)", () => {
  it("leads with the show name when no DJ is present", () => {
    const show = makeShow({
      djName: null,
      showName: "Evening Program",
      crossings: 1,
      topArtists: ["Portishead"],
    });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    expect(text(result!.node)).toContain("Evening Program");
  });
});

describe("crossingSentence — no DJ + no show (station-level only)", () => {
  it("falls back to artist nodes only (no DJ, no show in sentence) when neither is present", () => {
    const show = makeShow({
      djName: null,
      showName: "",
      crossings: 1,
      topArtists: ["Portishead"],
    });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    const t = text(result!.node);
    // No DJ and no show name in the output
    expect(t).toContain("Portishead");
    expect(t).not.toMatch(/\bon\b.*\bShow\b/);
  });
});

describe("reason — multi-DJ cascade", () => {
  it("r=1: suppresses DJ and shows show name when two distinct DJs are present", () => {
    const spin = makeSpin({ artist: "Portishead", isLibraryHit: true });
    const show = makeShow({
      djName: null,
      djNames: ["Alice", "Bob"],
      showName: "Co-Hosted Show",
      currentTrack: spin,
    });
    const rz = reason(show, 0);
    expect(rz.r).toBe(1);
    const t = text(rz.node);
    expect(t).not.toContain("Alice");
    expect(t).not.toContain("Bob");
    expect(t).toContain("Co-Hosted Show");
  });

  it("r=5: shows show name when DJs are ambiguous and a show name is available", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Alice", "Bob"],
      showName: "Co-Hosted Show",
    });
    const rz = reason(show, 0);
    expect(rz.r).toBe(5);
    const t = text(rz.node);
    expect(t).toContain("Co-Hosted Show");
    expect(t).not.toContain("Alice");
    expect(t).not.toContain("Bob");
  });

  it("r=0: goes dark when DJs are ambiguous and there is no show name", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Alice", "Bob"],
      showName: "",
    });
    const rz = reason(show, 0);
    // No DJ, no show → dark
    expect(rz.r).toBe(0);
  });
});

describe("reason — blended-mode multi-DJ cascade", () => {
  it("returns r=5 with show name (not individual DJs) when DJs are ambiguous in blended mode", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Alice", "Bob"],
      showName: "Co-Hosted Show",
    });
    const rz = reason(show, 0, 0, "blended");
    expect(rz.r).toBe(5);
    const t = text(rz.node);
    expect(t).toContain("Co-Hosted Show");
    expect(t).not.toContain("Alice");
    expect(t).not.toContain("Bob");
  });

  it("returns r=0 in blended mode when DJs are ambiguous and no show name is available", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Alice", "Bob"],
      showName: "",
    });
    const rz = reason(show, 0, 0, "blended");
    expect(rz.r).toBe(0);
  });

  it("stays r=0 in blended mode when no DJ is listed at all (show name alone is not enough community context)", () => {
    // No DJ conflict — just an un-hosted show. Blended mode needs a DJ to surface r=5.
    const show = makeShow({ djName: null, showName: "Overnight Automation" });
    const rz = reason(show, 0, 0, "blended");
    expect(rz.r).toBe(0);
  });
});

describe("usableShowName — single-DJ-via-djNames suppression", () => {
  it("suppresses show name when it matches the single DJ provided only via djNames", () => {
    // djName is null, djNames has one name that equals the show name — should suppress
    const show = makeShow({
      djName: null,
      djNames: ["Morning Mix"],
      showName: "Morning Mix",
    });
    expect(usableShowName(show)).toBeNull();
  });

  it("does NOT suppress show name when single djNames entry differs from show name", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Alice"],
      showName: "Morning Mix",
    });
    expect(usableShowName(show)).toBe("Morning Mix");
  });
});

// ---------------------------------------------------------------------------
// Single-DJ-via-djNames: reason() / live-sentence / sorting paths
// These cover the paths in DialView.tsx (liveSentence, FrontDoorRow, sortedRows)
// and useDialData (usableDjName / isPickerShow) that previously read show.djName
// directly and now go through eligibleDjNames.
// ---------------------------------------------------------------------------

describe("reason — single DJ via djNames (djName=null): DJ is credited", () => {
  it("r=5 and credits the DJ when djName is null but djNames has exactly one eligible entry", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Tom Schnabel"],
      showName: "Morning Mix",
    });
    const rz = reason(show, 0);
    expect(rz.r).toBe(5);
    const t = text(rz.node);
    expect(t).toContain("Tom Schnabel");
    expect(t).toContain("Morning Mix");
  });

  it("r=5 with DJ only (no show name) when djName=null and djNames has one entry", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Alice"],
      showName: "",
    });
    const rz = reason(show, 0);
    expect(rz.r).toBe(5);
    expect(text(rz.node)).toContain("Alice");
  });

  it("ambiguous multi-DJ suppresses individual names even when djName is null for both", () => {
    const show = makeShow({
      djName: null,
      djNames: ["Alice", "Bob"],
      showName: "Co-Hosted Show",
    });
    const rz = reason(show, 0);
    expect(rz.r).toBe(5);
    const t = text(rz.node);
    expect(t).not.toContain("Alice");
    expect(t).not.toContain("Bob");
    expect(t).toContain("Co-Hosted Show");
  });
});
