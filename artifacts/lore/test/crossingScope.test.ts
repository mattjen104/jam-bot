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
