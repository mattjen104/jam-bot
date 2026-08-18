// @vitest-environment jsdom
/**
 * Unit tests for the crossing-scope module: the scope cycle, persistence
 * parsing, the pure hasAnyCrossing(ds, scope) mapping, and the inline-detail
 * derivation used by the ⬤ dot panel.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  CROSSING_SCOPE_ORDER,
  DEFAULT_CROSSING_SCOPE,
  crossingScopeDetail,
  crossingScopeLabel,
  crossingSpinsForScope,
  hasAnyCrossing,
  nextCrossingScope,
  parseCrossingScope,
  readCrossingScope,
  writeCrossingScope,
  type CrossingScope,
} from "../src/lib/crossingScope";
import type { DialStation, DialShow, DialSpin } from "../src/hooks/useDialData";

function makeSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: null, artistMbid: null, title: "Track", artist: "Live Artist",
    playedAt: new Date().toISOString(), isLibraryHit: false, isArtistHit: false,
    isFirstSpin: false, ...overrides,
  } as DialSpin;
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1, showName: "Show", djName: null,
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    state: "live", spins: [], crossings: 0, artistCrossings: 0,
    topArtists: [], topArtistNames: [], currentTrack: null,
    isPickerShow: false, pickerId: null, ...overrides,
  } as DialShow;
}

function makeDs(overrides: Partial<DialStation> = {}): DialStation {
  return {
    station: { slug: "kexp", name: "KEXP" } as DialStation["station"],
    isLive: true, shows: [],
    crossings: 0, artistCrossings: 0,
    weekCrossings: 0, weekArtistCrossings: 0,
    monthCrossings: 0, monthArtistCrossings: 0,
    lifetimeCrossings: 0, lifetimeArtistCrossings: 0,
    topArtistNames: [],
    topArtistNames24h: [],
    topArtistNames7d: [],
    topArtistNamesLifetime: [],
    ...overrides,
  } as DialStation;
}

describe("scope cycle & labels", () => {
  it("cycles now → this set → 24h → 7d → lifetime → now", () => {
    let s: CrossingScope = "now";
    const seen = [s];
    for (let i = 0; i < 5; i++) { s = nextCrossingScope(s); seen.push(s); }
    expect(seen).toEqual(["now", "set", "24h", "7d", "lifetime", "now"]);
  });

  it("labels each scope for the pill", () => {
    expect(CROSSING_SCOPE_ORDER.map(crossingScopeLabel)).toEqual(
      ["now", "this set", "24h", "7d", "lifetime"],
    );
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to 'set' and round-trips through localStorage", () => {
    expect(readCrossingScope()).toBe(DEFAULT_CROSSING_SCOPE);
    writeCrossingScope("7d");
    expect(readCrossingScope()).toBe("7d");
  });

  it("falls back to the default on corrupt values", () => {
    expect(parseCrossingScope("!!junk!!")).toBe("set");
    expect(parseCrossingScope(null)).toBe("set");
    localStorage.setItem("lore:crossingScope", "yesteryear");
    expect(readCrossingScope()).toBe("set");
  });
});

describe("hasAnyCrossing", () => {
  it("'now' is true only for a live library/artist hit", () => {
    const hit = makeDs({ liveTrack: makeSpin({ isArtistHit: true }) });
    const miss = makeDs({ liveTrack: makeSpin() });
    expect(hasAnyCrossing(hit, "now")).toBe(true);
    expect(hasAnyCrossing(miss, "now")).toBe(false);
    // Falls back to the live show's current track.
    const viaShow = makeDs({ shows: [makeShow({ currentTrack: makeSpin({ isLibraryHit: true }) })] });
    expect(hasAnyCrossing(viaShow, "now")).toBe(true);
  });

  it("'set' reads the live show's crossings (and includes a live hit)", () => {
    const setCx = makeDs({ shows: [makeShow({ crossings: 2 })] });
    const artistCx = makeDs({ shows: [makeShow({ artistCrossings: 1 })] });
    const liveOnly = makeDs({ liveTrack: makeSpin({ isArtistHit: true }) });
    const none = makeDs({ shows: [makeShow()] });
    expect(hasAnyCrossing(setCx, "set")).toBe(true);
    expect(hasAnyCrossing(artistCx, "set")).toBe(true);
    expect(hasAnyCrossing(liveOnly, "set")).toBe(true);
    expect(hasAnyCrossing(none, "set")).toBe(false);
  });

  it("'24h' reads station-level crossings + artistCrossings", () => {
    expect(hasAnyCrossing(makeDs({ crossings: 1 }), "24h")).toBe(true);
    expect(hasAnyCrossing(makeDs({ artistCrossings: 3 }), "24h")).toBe(true);
    expect(hasAnyCrossing(makeDs(), "24h")).toBe(false);
  });

  it("'7d' reads weekCrossings + weekArtistCrossings", () => {
    expect(hasAnyCrossing(makeDs({ weekCrossings: 1 }), "7d")).toBe(true);
    expect(hasAnyCrossing(makeDs({ weekArtistCrossings: 2 }), "7d")).toBe(true);
    expect(hasAnyCrossing(makeDs({ crossings: 5 }), "7d")).toBe(false);
  });

  it("'lifetime' reads lifetimeCrossings + lifetimeArtistCrossings", () => {
    expect(hasAnyCrossing(makeDs({ lifetimeCrossings: 9 }), "lifetime")).toBe(true);
    expect(hasAnyCrossing(makeDs({ lifetimeArtistCrossings: 1 }), "lifetime")).toBe(true);
    expect(hasAnyCrossing(makeDs({ weekCrossings: 5 }), "lifetime")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// crossingSpinsForScope — drill-down helper (24h boundary + scope mapping)
// ---------------------------------------------------------------------------

describe("crossingSpinsForScope", () => {
  const NOW = new Date("2025-06-10T14:00:00Z").getTime();
  const within24h = new Date(NOW - 6 * 60 * 60 * 1000).toISOString();  // 6h ago — in window
  const outside24h = new Date(NOW - 25 * 60 * 60 * 1000).toISOString(); // 25h ago — out of window

  function makeHitSpin(overrides: Partial<DialSpin> = {}): DialSpin {
    return makeSpin({ isLibraryHit: true, playedAt: within24h, ...overrides });
  }

  it("'24h' includes spins within the rolling 24h window and is always partial", () => {
    const show = makeShow({
      state: "past",
      spins: [makeHitSpin({ playedAt: within24h })],
    });
    const ds = makeDs({ shows: [show], crossings: 1 });
    const { spins, partial, partialNote } = crossingSpinsForScope(ds, "24h", NOW);
    expect(spins).toHaveLength(1);
    // 24h is always partial: client holds today's spins only; rolling window
    // may include yesterday's spins that aren't in ds.shows[].spins.
    expect(partial).toBe(true);
    expect(partialNote).toBe("today's spins only");
  });

  it("'24h' shows empty spins (not missing crossings error) when server reports hits but client has no yesterday data", () => {
    // Simulates the after-midnight scenario: server's ds.crossings=2 reflects
    // spins from yesterday that are still in the rolling window, but
    // useDialData fetched today's spins only — ds.shows has no library hits.
    const show = makeShow({
      state: "past",
      spins: [makeSpin({ isLibraryHit: false, isArtistHit: false, playedAt: within24h })],
    });
    const ds = makeDs({ shows: [show], crossings: 2 }); // server says 2 crossings
    const { spins, partial } = crossingSpinsForScope(ds, "24h", NOW);
    // No local hits available — the list is empty, and partial signals the UI
    // to show a note rather than implying the count is wrong.
    expect(spins).toHaveLength(0);
    expect(partial).toBe(true);
  });

  it("'24h' excludes spins older than 24h even when they live in a loaded show", () => {
    const inWindow = makeHitSpin({ playedAt: within24h });
    const outOfWindow = makeHitSpin({ playedAt: outside24h });
    const show = makeShow({ state: "past", spins: [inWindow, outOfWindow] });
    const ds = makeDs({ shows: [show], crossings: 1 });
    const { spins } = crossingSpinsForScope(ds, "24h", NOW);
    // Only the recent spin survives the rolling boundary.
    expect(spins).toHaveLength(1);
    expect(new Date(spins[0].playedAt).getTime()).toBeGreaterThanOrEqual(NOW - 24 * 60 * 60 * 1000);
  });

  it("'set' returns only the live show's hit spins, not other shows", () => {
    const liveShow = makeShow({
      state: "live",
      spins: [makeHitSpin({ artist: "Portishead", playedAt: within24h })],
    });
    const pastShow = makeShow({
      state: "past",
      spins: [makeHitSpin({ artist: "Broadcast", playedAt: outside24h })],
    });
    const ds = makeDs({ shows: [liveShow, pastShow] });
    const { spins, partial } = crossingSpinsForScope(ds, "set", NOW);
    expect(spins.map((s) => s.artist)).toEqual(["Portishead"]);
    expect(partial).toBe(false);
  });

  it("'7d' is partial and returns all available hit spins (no 24h cutoff)", () => {
    const show = makeShow({
      state: "past",
      spins: [makeHitSpin({ playedAt: outside24h })],
    });
    const ds = makeDs({ shows: [show] });
    const { spins, partial } = crossingSpinsForScope(ds, "7d", NOW);
    expect(spins).toHaveLength(1);
    expect(partial).toBe(true);
  });

  it("merges a confirmed liveTrack into 'set' even when show.spins hasn't caught up yet", () => {
    // SSE timing gap: ds.liveTrack arrives via the live-pulse path ahead of
    // the recent-spins poll. The ⬤ detail already reflects the crossing but
    // liveSh.spins does not yet contain the track.
    const liveTrack = makeHitSpin({ artist: "Portishead", title: "Glory Box", playedAt: within24h });
    const liveShow = makeShow({ state: "live", spins: [] }); // spin array not yet updated
    const ds = makeDs({ shows: [liveShow], liveTrack });
    const { spins } = crossingSpinsForScope(ds, "set", NOW);
    expect(spins).toHaveLength(1);
    expect(spins[0].artist).toBe("Portishead");
  });

  it("deduplicates liveTrack when it is also present in show.spins (poll caught up)", () => {
    const liveTrack = makeHitSpin({ artist: "Portishead", title: "Glory Box", playedAt: within24h });
    const liveShow = makeShow({ state: "live", spins: [liveTrack] }); // poll already included it
    const ds = makeDs({ shows: [liveShow], liveTrack });
    const { spins } = crossingSpinsForScope(ds, "set", NOW);
    expect(spins).toHaveLength(1); // exactly once
  });

  it("merges a confirmed liveTrack into '24h' when absent from show.spins", () => {
    const liveTrack = makeHitSpin({ artist: "Broadcast", title: "Come On Let's Go", playedAt: within24h });
    const liveShow = makeShow({ state: "live", spins: [] });
    const ds = makeDs({ shows: [liveShow], liveTrack, crossings: 1 });
    const { spins, partial } = crossingSpinsForScope(ds, "24h", NOW);
    expect(spins).toHaveLength(1);
    expect(spins[0].artist).toBe("Broadcast");
    expect(partial).toBe(true); // 24h is always partial
  });

  it("excludes resolving spins from all scopes", () => {
    const resolving = makeHitSpin({ resolving: true, playedAt: within24h });
    const confirmed = makeHitSpin({ artist: "Confirmed", playedAt: within24h });
    const liveShow = makeShow({ state: "live", spins: [resolving, confirmed] });
    const ds = makeDs({ shows: [liveShow] });
    for (const scope of ["now", "set", "24h", "7d", "lifetime"] as const) {
      const { spins } = crossingSpinsForScope(ds, scope, NOW);
      expect(spins.every((s) => !s.resolving), `scope ${scope} should exclude resolving`).toBe(true);
    }
  });
});

describe("crossingScopeDetail", () => {
  it("caps at three deduplicated artist names with the scope label and count", () => {
    const ds = makeDs({
      crossings: 3,
      artistCrossings: 2,
      topArtistNames24h: ["Wet Leg", "wet leg", "Deftones", "Weezer", "Pavement"],
    });
    const d = crossingScopeDetail(ds, "24h");
    expect(d.scopeLabel).toBe("24h");
    expect(d.count).toBe(5);
    expect(d.artists).toEqual(["Wet Leg", "Deftones", "Weezer"]);
  });

  it("'set' pulls names from the live show", () => {
    const ds = makeDs({
      shows: [makeShow({ crossings: 2, topArtists: ["Portishead", "Broadcast"] })],
      topArtistNames: ["Should Not Appear"],
    });
    const d = crossingScopeDetail(ds, "set");
    expect(d.scopeLabel).toBe("this set");
    expect(d.count).toBe(2);
    expect(d.artists).toEqual(["Portishead", "Broadcast"]);
  });

  it("'now' names the live crossing artist", () => {
    const ds = makeDs({ liveTrack: makeSpin({ artist: "Wet Leg", isArtistHit: true }) });
    const d = crossingScopeDetail(ds, "now");
    expect(d.count).toBe(1);
    expect(d.artists).toEqual(["Wet Leg"]);
  });
});
