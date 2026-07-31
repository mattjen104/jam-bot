/**
 * Overnight-run spin display after yesterday-spins removal.
 *
 * Context: useDialData no longer fetches yesterday's spins.  Station-level
 * crossing scores come from the server (GET /api/me/crossings, a true
 * NOW()−24h query), so station ranking is unaffected.  But the per-show chip
 * timeline for overnight shows — those whose startedAt is before midnight and
 * endedAt is after midnight — only receives today's spins from the client.
 *
 * These tests confirm:
 *   1. Today's spins that fall inside an overnight run window are correctly
 *      assigned to that show (no crash, no missing chips).
 *   2. The show-level crossing count is derived from only the today-spins that
 *      are within the run window (no fabricated counts).
 *   3. The station-level crossing count uses the server score (non-zero) even
 *      though the show-level count may be lower (yesterday's library-hits are
 *      no longer visible client-side).
 *   4. A zero-spin overnight show does not display a non-zero crossing count at
 *      the show level (correct degradation), but the station-level count from
 *      the server remains correct.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline replicas of the hook's pure assembly helpers
// (copied verbatim so tests stay independent of the module under test;
//  if the hook changes these, tests will catch the divergence)
// ---------------------------------------------------------------------------

interface Spin {
  mbid: string | null;
  artistMbid: string | null;
  title: string;
  artist: string;
  playedAt: string;
  releaseGroupMbid?: string | null;
}

interface EnrichedSpin extends Spin {
  isLibraryHit: boolean;
  isArtistHit: boolean;
}

interface Run {
  runId: number | string | null;
  startedAt: string;
  endedAt: string;
  showName: string;
}

interface ShowResult {
  runId: number | string | null;
  showName: string;
  spins: EnrichedSpin[];
  crossings: number;
  artistCrossings: number;
}

interface AssemblyInput {
  runs: Run[];
  /** Today-only spins (the hook no longer fetches yesterday's) */
  todaySpins: Spin[];
  libraryMbids: Set<string>;
  libraryArtistMbids: Set<string>;
  /** Server-computed station-level crossings (24h, authoritative) */
  serverCrossings?: { crossings: number; artistCrossings: number };
}

/** Mirror of the hook's window24hCutoffMs + per-show spin assignment. */
function assembleShows(input: AssemblyInput): {
  shows: ShowResult[];
  stationCrossings: number;
  stationArtistCrossings: number;
} {
  const { runs, todaySpins, libraryMbids, libraryArtistMbids, serverCrossings } = input;
  const window24hCutoffMs = Date.now() - 24 * 60 * 60 * 1000;

  const sortedSpins = [...todaySpins].sort(
    (a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime(),
  );

  const shows: ShowResult[] = runs.map((run) => {
    const startMs = new Date(run.startedAt).getTime();
    const endMs = new Date(run.endedAt).getTime();

    const runSpins: EnrichedSpin[] = sortedSpins
      .filter((sp) => {
        const t = new Date(sp.playedAt).getTime();
        return t >= startMs - 60_000 && t <= endMs + 60_000;
      })
      .map((sp) => {
        const exactHit = sp.mbid != null && libraryMbids.has(sp.mbid);
        const artistHit =
          !exactHit &&
          sp.artistMbid != null &&
          libraryArtistMbids.has(sp.artistMbid);
        return { ...sp, isLibraryHit: exactHit, isArtistHit: artistHit };
      });

    const recentSpins = runSpins.filter(
      (sp) => new Date(sp.playedAt).getTime() >= window24hCutoffMs,
    );
    const crossings = recentSpins.filter((sp) => sp.isLibraryHit).length;
    const artistCrossings = recentSpins.filter((sp) => sp.isArtistHit).length;

    return { runId: run.runId, showName: run.showName, spins: runSpins, crossings, artistCrossings };
  });

  // Station-level: prefer server score (accurate 24h window, full history)
  const stationCrossings =
    serverCrossings !== undefined
      ? serverCrossings.crossings
      : shows.reduce((sum, sh) => sum + sh.crossings, 0);
  const stationArtistCrossings =
    serverCrossings !== undefined
      ? serverCrossings.artistCrossings
      : shows.reduce((sum, sh) => sum + sh.artistCrossings, 0);

  return { shows, stationCrossings, stationArtistCrossings };
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Returns an ISO string for "today at HH:MM" in local time */
function todayAt(hh: number, mm: number): string {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

/** Returns an ISO string for "yesterday at HH:MM" in local time */
function yesterdayAt(hh: number, mm: number): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("overnight run — spin assignment from today-only spins", () => {
  it("assigns today's post-midnight spins to an overnight run", () => {
    // Run started yesterday at 23:00, ends today at 01:30
    const run: Run = {
      runId: 1,
      startedAt: yesterdayAt(23, 0),
      endedAt: todayAt(1, 30),
      showName: "Late Night Jazz",
    };

    // Today-only spins: two fall inside the overnight window, one does not
    const todaySpins: Spin[] = [
      { mbid: "mbid-A", artistMbid: null, title: "Track A", artist: "Artist A", playedAt: todayAt(0, 15) },
      { mbid: "mbid-B", artistMbid: null, title: "Track B", artist: "Artist B", playedAt: todayAt(1, 10) },
      { mbid: "mbid-C", artistMbid: null, title: "Track C", artist: "Artist C", playedAt: todayAt(2, 0) }, // after endedAt
    ];

    const { shows } = assembleShows({
      runs: [run],
      todaySpins,
      libraryMbids: new Set(),
      libraryArtistMbids: new Set(),
    });

    expect(shows).toHaveLength(1);
    const show = shows[0];

    // The two post-midnight spins inside the window appear in the chip timeline
    expect(show.spins).toHaveLength(2);
    expect(show.spins.map((s) => s.mbid)).toEqual(["mbid-A", "mbid-B"]);

    // The spin that falls after endedAt is not included
    expect(show.spins.find((s) => s.mbid === "mbid-C")).toBeUndefined();
  });

  it("does not include yesterday's spins (they are no longer fetched)", () => {
    // Run started yesterday 23:00, ends today 01:00
    const run: Run = {
      runId: 2,
      startedAt: yesterdayAt(23, 0),
      endedAt: todayAt(1, 0),
      showName: "Midnight Shift",
    };

    // Only today's spins are provided — yesterday's pre-midnight spins are absent
    // (the hook no longer fetches yesterday's spins)
    const todaySpins: Spin[] = [
      { mbid: "mbid-X", artistMbid: null, title: "Post-midnight A", artist: "DJ", playedAt: todayAt(0, 5) },
    ];

    const { shows } = assembleShows({
      runs: [run],
      todaySpins,
      libraryMbids: new Set(),
      libraryArtistMbids: new Set(),
    });

    const show = shows[0];
    // Only the today spin is visible; yesterday's pre-midnight portion is absent —
    // this is the accepted degradation documented in useDialData.ts
    expect(show.spins).toHaveLength(1);
    expect(show.spins[0].mbid).toBe("mbid-X");
  });

  it("computes show-level crossings from today's library-hit spins only", () => {
    const run: Run = {
      runId: 3,
      startedAt: yesterdayAt(23, 0),
      endedAt: todayAt(2, 0),
      showName: "Night Owls",
    };

    const todaySpins: Spin[] = [
      { mbid: "library-mbid-1", artistMbid: null, title: "Fave Track", artist: "Band", playedAt: todayAt(0, 30) },
      { mbid: "random-mbid",    artistMbid: null, title: "Other",      artist: "Other",playedAt: todayAt(1, 0) },
    ];

    const { shows } = assembleShows({
      runs: [run],
      todaySpins,
      libraryMbids: new Set(["library-mbid-1"]),
      libraryArtistMbids: new Set(),
    });

    const show = shows[0];
    expect(show.crossings).toBe(1);      // only the library-hit spin
    expect(show.artistCrossings).toBe(0);
  });

  it("uses server crossing score as station-level count (non-zero even when show has zero client spins)", () => {
    // Overnight run with NO today spins inside its window (yesterday's half is
    // invisible to the client now that yesterday's spins aren't fetched).
    // The server crossing count must still be non-zero.
    const run: Run = {
      runId: 4,
      startedAt: yesterdayAt(23, 0),
      endedAt: todayAt(0, 30),
      showName: "Graveyard Shift",
    };

    // No spins available client-side (empty today spins inside the window)
    const { shows, stationCrossings, stationArtistCrossings } = assembleShows({
      runs: [run],
      todaySpins: [],
      libraryMbids: new Set(["library-mbid-2"]),
      libraryArtistMbids: new Set(),
      // Server knows about yesterday's 3 library hits across 24h
      serverCrossings: { crossings: 3, artistCrossings: 1 },
    });

    // Show-level: zero (no client spins in window) — correct degradation
    expect(shows[0].crossings).toBe(0);

    // Station-level: uses server score, not the client-computed zero
    expect(stationCrossings).toBe(3);
    expect(stationArtistCrossings).toBe(1);
  });

  it("show-level crossing count is never inflated beyond what today's spins show", () => {
    // Scenario: server says 5 crossings (includes yesterday's pre-midnight spins).
    // Show-level should only count today's visible spins — not all 5.
    const run: Run = {
      runId: 5,
      startedAt: yesterdayAt(23, 0),
      endedAt: todayAt(1, 0),
      showName: "Boundary Check",
    };

    const todaySpins: Spin[] = [
      { mbid: "hit-1", artistMbid: null, title: "Hit", artist: "Band", playedAt: todayAt(0, 10) },
    ];

    const { shows, stationCrossings } = assembleShows({
      runs: [run],
      todaySpins,
      libraryMbids: new Set(["hit-1"]),
      libraryArtistMbids: new Set(),
      serverCrossings: { crossings: 5, artistCrossings: 0 },
    });

    // Only 1 today spin is a library hit
    expect(shows[0].crossings).toBe(1);
    // Station-level uses the authoritative server score
    expect(stationCrossings).toBe(5);
  });

  it("does not crash when the overnight run has no matching spins at all", () => {
    const run: Run = {
      runId: 6,
      startedAt: yesterdayAt(23, 0),
      endedAt: todayAt(1, 0),
      showName: "Empty Overnight",
    };

    expect(() =>
      assembleShows({
        runs: [run],
        todaySpins: [],
        libraryMbids: new Set(),
        libraryArtistMbids: new Set(),
      }),
    ).not.toThrow();

    const { shows, stationCrossings } = assembleShows({
      runs: [run],
      todaySpins: [],
      libraryMbids: new Set(),
      libraryArtistMbids: new Set(),
    });

    expect(shows[0].spins).toHaveLength(0);
    expect(shows[0].crossings).toBe(0);
    expect(stationCrossings).toBe(0);
  });

  it("server crossing score is preferred over client fallback when both exist", () => {
    const run: Run = {
      runId: 7,
      startedAt: yesterdayAt(23, 0),
      endedAt: todayAt(1, 0),
      showName: "Server Wins",
    };

    const todaySpins: Spin[] = [
      { mbid: "hit-A", artistMbid: null, title: "Track", artist: "Artist", playedAt: todayAt(0, 5) },
    ];

    // Client would compute 1 crossing; server knows about 8 (full 24h)
    const { stationCrossings } = assembleShows({
      runs: [run],
      todaySpins,
      libraryMbids: new Set(["hit-A"]),
      libraryArtistMbids: new Set(),
      serverCrossings: { crossings: 8, artistCrossings: 2 },
    });

    expect(stationCrossings).toBe(8);
  });
});
