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
  it("renders '<Artist> on air.' without a DJ", () => {
    const show = makeShow({ crossings: 1, topArtists: ["Portishead"] });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    expect(text(result!.node)).toBe("Portishead on air.");
  });

  it("renders '<DJ> — <Artist> on air.' when a DJ is present", () => {
    const show = makeShow({
      crossings: 1,
      topArtists: ["Portishead"],
      djName: "Tom Schnabel",
    });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    expect(text(result!.node)).toBe("Tom Schnabel — Portishead on air.");
  });

  it("hasTrack is true for 1-artist form", () => {
    const show = makeShow({ crossings: 1, topArtists: ["Portishead"] });
    expect(crossingSentence("KCRW", show)!.hasTrack).toBe(true);
  });

  it("uses isLibraryHit currentTrack artist as single candidate when it is the current hit", () => {
    const spin = makeSpin({ artist: "Björk", isLibraryHit: true });
    const show = makeShow({ currentTrack: spin, crossings: 1, topArtists: [] });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("Björk on air.");
  });

  it("drops the DJ prefix when djName equals the station name", () => {
    // eligibleDjName should suppress a DJ whose name collides with the station
    const show = makeShow({
      crossings: 1,
      topArtists: ["Portishead"],
      djName: "KCRW",
    });
    const result = crossingSentence("KCRW", show);
    // DJ is suppressed — single-artist no-DJ form
    expect(text(result!.node)).toBe("Portishead on air.");
    expect(text(result!.node)).not.toContain("KCRW —");
  });
});

describe("crossingSentence — 2 artists (multi-artist form)", () => {
  it("renders '<A> and <B> this set' for exactly 2 artists", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Portishead", "Massive Attack"] });
    const result = crossingSentence("KCRW", show);
    expect(result).not.toBeNull();
    expect(text(result!.node)).toBe("Portishead and Massive Attack this set");
  });

  it("wraps each artist name in <b> element", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Portishead", "Massive Attack"] });
    const result = crossingSentence("KCRW", show);
    const html = markup(result!.node);
    expect(html).toContain("<b");
    expect(html).toContain("Portishead");
    expect(html).toContain("Massive Attack");
  });

  it("renders '<DJ> — <A> and <B> this set' when a DJ is present", () => {
    const show = makeShow({
      crossings: 2,
      topArtists: ["Portishead", "Massive Attack"],
      djName: "Tom Schnabel",
    });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("Tom Schnabel — Portishead and Massive Attack this set");
  });

  it("uses artist-crossing names when only artistCrossings > 0", () => {
    const show = makeShow({
      crossings: 0,
      artistCrossings: 2,
      topArtistNames: ["The Cure", "Siouxsie and the Banshees"],
    });
    const result = crossingSentence("4ZZZ", show);
    expect(text(result!.node)).toBe("The Cure and Siouxsie and the Banshees this set");
  });
});

describe("crossingSentence — 6 artists (boundary of shown list)", () => {
  const SIX = ["A", "B", "C", "D", "E", "F"];

  it("renders all 6 names joined with commas and 'and' before the last", () => {
    const show = makeShow({ crossings: 6, topArtists: SIX });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("A, B, C, D, E and F this set");
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
    expect(text(result!.node)).toBe("A, B, C, D, E, F and 1 more this set");
  });

  it("shows 6 names then 'and 2 more' for 8 artists", () => {
    const show = makeShow({ crossings: 8, topArtists: EIGHT });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("A, B, C, D, E, F and 2 more this set");
  });
});

describe("crossingSentence — count fallback (no artist names available)", () => {
  it("renders singular '1 track … has aired.' when count is 1 and topArtists is empty", () => {
    const show = makeShow({ crossings: 1, topArtists: [] });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("1 track from your library has aired.");
  });

  it("renders plural '3 tracks … have aired.' when count is 3", () => {
    const show = makeShow({ crossings: 3, topArtists: [] });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).toBe("3 tracks from your library have aired.");
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
    // Only Portishead remains → 1-artist form
    expect(text(result!.node)).toBe("Portishead on air.");
  });
});

// ---------------------------------------------------------------------------
// reason() — single-artist r=1 and r=2 ("on air" forms confirmed unchanged)
// ---------------------------------------------------------------------------

describe("reason — r=1 exact library track on air", () => {
  it("returns r=1 and includes track title + 'in your library'", () => {
    const spin = makeSpin({ title: "Glory Box", isLibraryHit: true });
    const show = makeShow({ currentTrack: spin });
    const rz = reason(show, 0);
    expect(rz.r).toBe(1);
    expect(rz.cls).toBe("w1");
    expect(text(rz.node)).toBe("Glory Box on air — in your library");
  });

  it("bolds the track title", () => {
    const spin = makeSpin({ title: "Glory Box", isLibraryHit: true });
    const show = makeShow({ currentTrack: spin });
    const rz = reason(show, 0);
    expect(markup(rz.node)).toContain("<b>Glory Box</b>");
  });
});

describe("reason — r=2 library artist on air", () => {
  it("returns r=2 and includes artist name + 'artist from your library'", () => {
    const spin = makeSpin({ artist: "Portishead", isArtistHit: true });
    const show = makeShow({ currentTrack: spin });
    const rz = reason(show, 0);
    expect(rz.r).toBe(2);
    expect(rz.cls).toBe("w2");
    expect(text(rz.node)).toBe("Portishead on air — artist from your library");
  });

  it("bolds the artist name", () => {
    const spin = makeSpin({ artist: "Portishead", isArtistHit: true });
    const show = makeShow({ currentTrack: spin });
    const rz = reason(show, 0);
    expect(markup(rz.node)).toContain("<b>Portishead</b>");
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
    expect(text(rz.node)).toBe("Portishead and Massive Attack this set");
  });

  it("returns r=3 with count fallback when topArtists is empty", () => {
    const show = makeShow({ crossings: 4, topArtists: [] });
    const rz = reason(show, 0);
    expect(rz.r).toBe(3);
    expect(text(rz.node)).toBe("4 of yours this set");
  });

  it("bolds the count fallback", () => {
    const show = makeShow({ crossings: 2, topArtists: [] });
    const rz = reason(show, 0);
    expect(markup(rz.node)).toContain("<b>2 of yours</b>");
  });

  it("singular 'N of yours' is still bolded correctly for count=1", () => {
    const show = makeShow({ crossings: 1, topArtists: [] });
    const rz = reason(show, 0);
    expect(text(rz.node)).toBe("1 of yours this set");
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
    expect(text(rz.node)).toBe("The Cure and Joy Division this set");
  });

  it("returns r=4 with count fallback when topArtistNames is empty", () => {
    const show = makeShow({ artistCrossings: 5, topArtistNames: [] });
    const rz = reason(show, 0);
    expect(rz.r).toBe(4);
    expect(text(rz.node)).toBe("5 tracks by artists from your library");
  });

  it("bolds the count in the fallback sentence", () => {
    const show = makeShow({ artistCrossings: 3, topArtistNames: [] });
    const rz = reason(show, 0);
    expect(markup(rz.node)).toContain("<b>3</b>");
  });
});

// ---------------------------------------------------------------------------
// reason() — r=5 (attributed show, no crossing evidence)
// ---------------------------------------------------------------------------

describe("reason — r=5 (attributed show, no crossings)", () => {
  it("returns r=5 when only djName is set", () => {
    const show = makeShow({ djName: "Tom Schnabel" });
    const rz = reason(show, 0);
    expect(rz.r).toBe(5);
    expect(rz.cls).toBe("w5");
    expect(typeof rz.node).toBe("string");
    expect(rz.node as string).toMatch(/^on air · \d+[hm]( \d+m)? into the set$/);
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
    expect(text(rz.node)).toBe("Aphex Twin and Boards of Canada in the last 24 hours");
  });

  it("returns r=6 with count fallback when stationTopArtistNames is empty", () => {
    const show = makeShow({ djName: null });
    const rz = reason(show, 7, 0, "personal", []);
    expect(rz.r).toBe(6);
    expect(text(rz.node)).toBe("7 of yours here in the last 24h");
  });

  it("bolds the count fallback for r=6", () => {
    const show = makeShow({ djName: null });
    const rz = reason(show, 3, 0, "personal", []);
    expect(markup(rz.node)).toContain("<b>3 of yours</b>");
  });

  it("renders all 6 names with correct comma/and structure", () => {
    const show = makeShow({ djName: null });
    const six = ["A", "B", "C", "D", "E", "F"];
    const rz = reason(show, 6, 0, "personal", six);
    expect(rz.r).toBe(6);
    expect(text(rz.node)).toBe("A, B, C, D, E and F in the last 24 hours");
  });

  it("collapses 7+ names to '… and N more' for r=6", () => {
    const show = makeShow({ djName: null });
    const seven = ["A", "B", "C", "D", "E", "F", "G"];
    const rz = reason(show, 7, 0, "personal", seven);
    expect(rz.r).toBe(6);
    expect(text(rz.node)).toBe("A, B, C, D, E, F and 1 more in the last 24 hours");
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
    expect(text(rz.node)).toBe("Tortoise and Slint in the last 24 hours");
  });

  it("returns r=7 with count fallback when stationTopArtistNames is empty", () => {
    const show = makeShow({ djName: null });
    const rz = reason(show, 0, 6, "personal", []);
    expect(rz.r).toBe(7);
    expect(text(rz.node)).toBe("6 tracks by your artists here in the last 24h");
  });

  it("bolds the count fallback for r=7", () => {
    const show = makeShow({ djName: null });
    const rz = reason(show, 0, 2, "personal", []);
    expect(markup(rz.node)).toContain("<b>2</b>");
  });

  it("collapses 7+ names to '… and N more' for r=7", () => {
    const show = makeShow({ djName: null });
    const seven = ["A", "B", "C", "D", "E", "F", "G"];
    const rz = reason(show, 0, 7, "personal", seven);
    expect(rz.r).toBe(7);
    expect(text(rz.node)).toBe("A, B, C, D, E, F and 1 more in the last 24 hours");
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

  it("returns r=0 when show has no crossings and no djName", () => {
    const show = makeShow({ djName: null });
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
    expect(text(nameNodes(["A", "B", "C"]))).toBe("A, B and C");
  });

  it("renders 6 names with commas and final 'and'", () => {
    expect(text(nameNodes(["A", "B", "C", "D", "E", "F"]))).toBe("A, B, C, D, E and F");
  });

  it("collapses 7 to 6 shown + '1 more'", () => {
    expect(text(nameNodes(["A", "B", "C", "D", "E", "F", "G"]))).toBe("A, B, C, D, E, F and 1 more");
  });

  it("collapses 8 to 6 shown + '2 more'", () => {
    expect(text(nameNodes(["A", "B", "C", "D", "E", "F", "G", "H"]))).toBe("A, B, C, D, E, F and 2 more");
  });
});
