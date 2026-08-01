// @vitest-environment jsdom
/**
 * Component tests for FrontDoorRow — the main dial card.
 *
 * Covers the six rung cases produced by reason():
 *   r=1  exact library track playing now     ("◆ playing … — in your library")
 *   r=2  library artist playing now          ("playing … — an artist from your library")
 *   r=3  exact tracks already aired          ("… already this set")
 *   r=4  artist tracks already aired         ("… — an artist from your library")
 *   r=5  attributed show, no crossings       ("on air · … into the set")
 *   r=0  no now-playing data (show=null)     ("on air · Lore can't see who's playing")
 *
 * Each case asserts:
 *   - The reason sentence (fdrow__t1) is the first child of fdrow__c.
 *   - "Unknown show" never appears anywhere in the rendered output.
 *   - The station name always appears in fdrow__t3 (Tier 3).
 *   - Automated stations have no fdrow__t2 element (no phantom DJ slot).
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock DialView's module-level dependencies (none are used by FrontDoorRow
// itself, but they are evaluated when the module loads).
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("../src/hooks/useDialData", () => ({
  useDialData: vi.fn(),
}));

vi.mock("../src/lib/meHooks", () => ({
  useMyOverlapSelectors: vi.fn(() => ({ data: null })),
  useMyGhostMissed: vi.fn(() => ({ data: null })),
  useSpotifyLibraryConnected: vi.fn(() => false),
  startSpotifyLibraryConnect: vi.fn(),
}));

vi.mock("../src/components/StationLane", () => ({
  StationLane: () => <div />,
}));

vi.mock("../src/components/ContextRail", () => ({
  ContextRail: () => <div />,
}));

vi.mock("../src/components/SearchOverlay", () => ({
  SearchOverlay: () => <div />,
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: vi.fn(() => ({ ride: {}, spotify: {}, scan: {}, radio: {} })),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { FrontDoorRow } from "../src/components/DialView";
import type { DialStation, DialShow } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeStation(overrides: Partial<DialStation["station"]> = {}): DialStation["station"] {
  return {
    slug: "test-fm",
    name: "Test FM",
    streamUrl: null,
    websiteUrl: null,
    description: null,
    logoUrl: null,
    radioBrowserId: null,
    automationClass: null,
    ...overrides,
  } as DialStation["station"];
}

function makeDialStation(
  stationOverrides: Partial<DialStation["station"]> = {},
  dsOverrides: Partial<Omit<DialStation, "station">> = {},
): DialStation {
  return {
    station: makeStation(stationOverrides),
    isLive: true,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    ...dsOverrides,
  };
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Morning Mix",
    djName: null,
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    endedAt: new Date().toISOString(),
    state: "live",
    spins: [],
    crossings: 0,
    artistCrossings: 0,
    topArtists: [],
    topArtistNames: [],
    currentTrack: null,
    isPickerShow: false,
    ...overrides,
  };
}

function makeSpin(overrides: Partial<DialShow["spins"][number]> = {}): DialShow["spins"][number] {
  return {
    mbid: "mbid-1",
    artistMbid: null,
    title: "Test Track",
    artist: "Test Artist",
    playedAt: new Date().toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    ...overrides,
  };
}

function renderRow(ds: DialStation, show: DialShow | null, ov = 0) {
  return render(
    <FrontDoorRow
      ds={ds}
      show={show}
      ov={ov}
      isActive={false}
      isSampling={false}
      onTuneIn={vi.fn()}
      onEarlier={vi.fn()}
    />,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns [t1El, t2El|null, t3El] within fdrow__c. */
function getTiers(container: HTMLElement) {
  // fdrow__c is the inner column wrapper
  const inner = container.querySelector(".fdrow__c");
  expect(inner).not.toBeNull();
  const t1 = inner!.querySelector(".fdrow__t1");
  const t2 = inner!.querySelector(".fdrow__t2");
  const t3 = inner!.querySelector(".fdrow__t3");
  expect(t1).not.toBeNull();
  expect(t3).not.toBeNull();
  return { inner: inner!, t1: t1!, t2, t3: t3! };
}

/** Assert t1 is the first element child of fdrow__c */
function assertT1LeadsRow(inner: Element, t1: Element) {
  expect(inner.firstElementChild).toBe(t1);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// r=1: exact library track playing now
// ---------------------------------------------------------------------------

describe("r=1 — exact library track playing now", () => {
  it("reason sentence leads the row (fdrow__t1 is first child)", () => {
    const spin = makeSpin({ title: "Go Your Own Way", isLibraryHit: true });
    const show = makeShow({ currentTrack: spin });
    const { container } = renderRow(makeDialStation(), show);
    const { inner, t1 } = getTiers(container);
    assertT1LeadsRow(inner, t1);
  });

  it("reason mentions the track title and 'in your library'", () => {
    const spin = makeSpin({ title: "Go Your Own Way", isLibraryHit: true });
    const show = makeShow({ currentTrack: spin });
    const { container } = renderRow(makeDialStation(), show);
    const { t1 } = getTiers(container);
    expect(t1.textContent).toContain("Go Your Own Way");
    expect(t1.textContent).toContain("in your library");
  });

  it("Tier 3 contains the station name", () => {
    const spin = makeSpin({ isLibraryHit: true });
    const show = makeShow({ currentTrack: spin });
    const { container } = renderRow(makeDialStation(), show);
    const { t3 } = getTiers(container);
    expect(t3.textContent).toContain("Test FM");
  });

  it("never renders 'Unknown show'", () => {
    const spin = makeSpin({ isLibraryHit: true });
    const show = makeShow({ currentTrack: spin, showName: "Unknown show" });
    const { container } = renderRow(makeDialStation(), show);
    expect(container.textContent).not.toMatch(/unknown show/i);
  });
});

// ---------------------------------------------------------------------------
// r=2: library artist playing now (no exact track match)
// ---------------------------------------------------------------------------

describe("r=2 — library artist playing now", () => {
  it("reason sentence leads the row", () => {
    const spin = makeSpin({ artist: "Fleetwood Mac", isArtistHit: true });
    const show = makeShow({ currentTrack: spin });
    const { container } = renderRow(makeDialStation(), show);
    const { inner, t1 } = getTiers(container);
    assertT1LeadsRow(inner, t1);
  });

  it("reason mentions the artist name and 'an artist from your library'", () => {
    const spin = makeSpin({ artist: "Fleetwood Mac", isArtistHit: true });
    const show = makeShow({ currentTrack: spin });
    const { container } = renderRow(makeDialStation(), show);
    const { t1 } = getTiers(container);
    expect(t1.textContent).toContain("Fleetwood Mac");
    expect(t1.textContent).toContain("an artist from your library");
  });

  it("Tier 3 contains the station name", () => {
    const spin = makeSpin({ isArtistHit: true });
    const show = makeShow({ currentTrack: spin });
    const { container } = renderRow(makeDialStation(), show);
    const { t3 } = getTiers(container);
    expect(t3.textContent).toContain("Test FM");
  });

  it("never renders 'Unknown show'", () => {
    const spin = makeSpin({ isArtistHit: true });
    const show = makeShow({ currentTrack: spin, showName: "Unknown show" });
    const { container } = renderRow(makeDialStation(), show);
    expect(container.textContent).not.toMatch(/unknown show/i);
  });
});

// ---------------------------------------------------------------------------
// r=3: exact library tracks already aired this show
// ---------------------------------------------------------------------------

describe("r=3 — exact tracks already aired this show", () => {
  it("reason sentence leads the row", () => {
    const show = makeShow({
      crossings: 2,
      topArtists: ["Radiohead"],
    });
    const { container } = renderRow(makeDialStation(), show);
    const { inner, t1 } = getTiers(container);
    assertT1LeadsRow(inner, t1);
  });

  it("reason mentions 'already this set'", () => {
    const show = makeShow({ crossings: 2, topArtists: ["Radiohead"] });
    const { container } = renderRow(makeDialStation(), show);
    const { t1 } = getTiers(container);
    expect(t1.textContent).toContain("already this set");
  });

  it("Tier 3 contains the station name", () => {
    const show = makeShow({ crossings: 1, topArtists: [] });
    const { container } = renderRow(makeDialStation(), show);
    const { t3 } = getTiers(container);
    expect(t3.textContent).toContain("Test FM");
  });

  it("never renders 'Unknown show'", () => {
    const show = makeShow({ crossings: 1, showName: "Unknown show" });
    const { container } = renderRow(makeDialStation(), show);
    expect(container.textContent).not.toMatch(/unknown show/i);
  });
});

// ---------------------------------------------------------------------------
// r=4: library artists aired this show (no exact track match)
// ---------------------------------------------------------------------------

describe("r=4 — library artists aired, no exact track match", () => {
  it("reason sentence leads the row", () => {
    const show = makeShow({
      crossings: 0,
      artistCrossings: 3,
      topArtistNames: ["The National"],
    });
    const { container } = renderRow(makeDialStation(), show);
    const { inner, t1 } = getTiers(container);
    assertT1LeadsRow(inner, t1);
  });

  it("reason mentions 'an artist from your library'", () => {
    const show = makeShow({
      crossings: 0,
      artistCrossings: 3,
      topArtistNames: ["The National"],
    });
    const { container } = renderRow(makeDialStation(), show);
    const { t1 } = getTiers(container);
    expect(t1.textContent).toContain("an artist from your library");
  });

  it("Tier 3 contains the station name", () => {
    const show = makeShow({ crossings: 0, artistCrossings: 1, topArtistNames: [] });
    const { container } = renderRow(makeDialStation(), show);
    const { t3 } = getTiers(container);
    expect(t3.textContent).toContain("Test FM");
  });

  it("never renders 'Unknown show'", () => {
    const show = makeShow({ crossings: 0, artistCrossings: 1, showName: "Unknown show" });
    const { container } = renderRow(makeDialStation(), show);
    expect(container.textContent).not.toMatch(/unknown show/i);
  });
});

// ---------------------------------------------------------------------------
// r=5: attributed show on air, no crossing evidence
// ---------------------------------------------------------------------------

describe("r=5 — attributed show on air, no crossings", () => {
  it("reason sentence leads the row", () => {
    const show = makeShow({ djName: "DJ Cosmos", crossings: 0, artistCrossings: 0 });
    const { container } = renderRow(makeDialStation(), show);
    const { inner, t1 } = getTiers(container);
    assertT1LeadsRow(inner, t1);
  });

  it("reason mentions 'on air' and 'into the set'", () => {
    const show = makeShow({ djName: "DJ Cosmos", crossings: 0, artistCrossings: 0 });
    const { container } = renderRow(makeDialStation(), show);
    const { t1 } = getTiers(container);
    expect(t1.textContent).toContain("on air");
    expect(t1.textContent).toContain("into the set");
  });

  it("Tier 3 contains the station name", () => {
    const show = makeShow({ djName: "DJ Cosmos", crossings: 0, artistCrossings: 0 });
    const { container } = renderRow(makeDialStation(), show);
    const { t3 } = getTiers(container);
    expect(t3.textContent).toContain("Test FM");
  });

  it("never renders 'Unknown show'", () => {
    const show = makeShow({
      djName: "DJ Cosmos",
      crossings: 0,
      artistCrossings: 0,
      showName: "Unknown show",
    });
    const { container } = renderRow(makeDialStation(), show);
    expect(container.textContent).not.toMatch(/unknown show/i);
  });
});

// ---------------------------------------------------------------------------
// r=0: show=null — Lore has no now-playing data
// ---------------------------------------------------------------------------

describe("r=0 — no now-playing data (show=null)", () => {
  it("reason sentence leads the row", () => {
    const { container } = renderRow(makeDialStation(), null);
    const { inner, t1 } = getTiers(container);
    assertT1LeadsRow(inner, t1);
  });

  it("reason mentions 'Lore can't see who's playing'", () => {
    const { container } = renderRow(makeDialStation(), null);
    const { t1 } = getTiers(container);
    expect(t1.textContent).toContain("Lore can't see who's playing");
  });

  it("Tier 3 contains the station name", () => {
    const { container } = renderRow(makeDialStation(), null);
    const { t3 } = getTiers(container);
    expect(t3.textContent).toContain("Test FM");
  });

  it("never renders 'Unknown show'", () => {
    const { container } = renderRow(makeDialStation(), null);
    expect(container.textContent).not.toMatch(/unknown show/i);
  });
});

// ---------------------------------------------------------------------------
// Automated stations — phantom DJ fallback must be suppressed
//
// The `isNonHuman` guard blocks the *fallback* from recently-ended shows when
// the current live show has no djName.  A stale name from a past slot must not
// bleed into Tier 2 for automated or mixed stations.
// ---------------------------------------------------------------------------

function makePastShow(djName: string): DialShow {
  return makeShow({
    djName,
    state: "past",
    // ended 30 minutes ago — within the 4-hour cutoff used by the fallback logic
    endedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  });
}

describe("automated stations — phantom DJ fallback suppressed", () => {
  it("does not render fdrow__t2 when automationClass='automated' and the live show has no djName, even if a recent past show does", () => {
    const past = makePastShow("AutoBot");
    const ds = makeDialStation({ automationClass: "automated" }, { shows: [past] });
    // Live show has no djName — would trigger fallback on a human station
    const liveShow = makeShow({ djName: null, crossings: 0, artistCrossings: 0 });
    const { container } = renderRow(ds, liveShow);
    expect(container.querySelector(".fdrow__t2")).toBeNull();
  });

  it("does not render fdrow__t2 when automationClass='mixed' and a recent past show had a DJ name", () => {
    const past = makePastShow("Some Host");
    const ds = makeDialStation({ automationClass: "mixed" }, { shows: [past] });
    const liveShow = makeShow({ djName: null, crossings: 1, topArtists: ["Blur"] });
    const { container } = renderRow(ds, liveShow);
    expect(container.querySelector(".fdrow__t2")).toBeNull();
  });

  it("still renders fdrow__t2 on a human station when the fallback fires from a recent past show", () => {
    const past = makePastShow("DJ Luna");
    const ds = makeDialStation({ automationClass: null }, { shows: [past] });
    const liveShow = makeShow({ djName: null });
    const { container } = renderRow(ds, liveShow);
    expect(container.querySelector(".fdrow__t2")).not.toBeNull();
    expect(container.querySelector(".fdrow__t2")!.textContent).toContain("DJ Luna");
  });

  it("still renders fdrow__t2 when automationClass='human' and the live show carries a djName directly", () => {
    const ds = makeDialStation({ automationClass: "human" });
    const show = makeShow({ djName: "DJ Sol" });
    const { container } = renderRow(ds, show);
    expect(container.querySelector(".fdrow__t2")).not.toBeNull();
  });
});
