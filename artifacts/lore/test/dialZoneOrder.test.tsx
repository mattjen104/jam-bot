// @vitest-environment jsdom
/**
 * Regression tests for the crossings-loading window and Zone 3 DJ-band split.
 *
 * During crossingsLoading=true the dial suppresses all real station rows and
 * renders only the Zone 1 loading placeholder (Zone1Placeholder). No
 * FrontDoorRow (.fdrow) elements — and in particular no Zone 3 "also on air"
 * rows — may appear until crossing scores resolve, so Zone 3 can never jump
 * above the (not-yet-computed) crossing rows.
 *
 * Covers:
 *  1. The Zone 1 loading placeholder appears when crossingsLoading=true.
 *  2. No FrontDoorRow (.fdrow) elements exist while crossingsLoading=true.
 *  3. Once crossings resolve with an empty station list, no rows render.
 *  4. Zone 3 DJ band split (djBand / restBand ordering + "DJs on air" label).
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../src/hooks/useDialData", () => ({
  useDialData: vi.fn(),
  readPins: vi.fn(() => new Set<string>()),
  togglePin: vi.fn(),
  normalizeDjName: vi.fn((s: string | null) => s ?? ""),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal);
});

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyOverlapSelectors: vi.fn(() => ({ data: [] })),
    useMyGhostMissed: vi.fn(() => ({ data: [] })),
    useMyOverlapRunsRecent: vi.fn(() => ({ data: [], isLoading: false })),
    useMyRunCrossings: vi.fn(() => ({ data: [], isLoading: false })),
    useMyOverlapRunsFor: vi.fn(() => ({ data: [], isLoading: false })),
    useMyWeeklyRecap: vi.fn(() => ({ data: undefined })),
    useSpotifyLibraryConnected: vi.fn(() => true),
    startSpotifyLibraryConnect: vi.fn(),
  });
});

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      radio: {
        status: "idle",
        station: null,
        scanning: false,
        preview: vi.fn(),
        toggle: vi.fn(),
        stop: vi.fn(),
      },
      ride: { active: false },
      spotify: { connected: false, premium: false },
      scan: { active: false },
    })),
  });
});

vi.mock("../src/components/StationLane", () => ({
  StationLane: () => <div data-testid="station-lane" />,
}));
vi.mock("../src/components/ContextRail", () => ({
  ContextRail: () => <div data-testid="context-rail" />,
}));
vi.mock("../src/components/SearchOverlay", () => ({
  SearchOverlay: () => null,
}));
vi.mock("../src/components/LibraryChip", () => ({
  LibraryChip: () => null,
}));
vi.mock("../src/components/ManualImportModal", () => ({
  ManualImportModal: () => null,
}));

vi.mock("../src/hooks/useFrontDoorScan", () => ({
  useFrontDoorScan: vi.fn(() => ({
    scanning: false,
    samplingIdx: null,
    dwellMs: 7000,
    progress: 0,
    toggle: vi.fn(),
    back: vi.fn(),
    next: vi.fn(),
    land: vi.fn(),
    adjustDwell: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("../src/hooks/useStationPresence", () => ({
  useStationPresence: vi.fn(() => new Map()),
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { useDialData } from "../src/hooks/useDialData";
import { useMyGhostMissed } from "../src/lib/meHooks";
import { DialView } from "../src/components/DialView";
import type { DialStation, DialShow } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockDialDataLoading() {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations: [],
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: true,
    hasLibrary: true,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
  });
}

function mockDialDataLoaded() {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations: [],
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: true,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
  });
}

function renderDial() {
  return render(<DialView />);
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dial front-door zone order — crossingsLoading=true", () => {
  it("renders the Zone 1 loading placeholder while crossings are loading", () => {
    mockDialDataLoading();
    renderDial();
    // The skeleton gate uses a 150 ms delay (useDelayedBoolean) so that fast
    // loads never flash shimmer rows. Advance past the threshold to let the
    // placeholder appear.
    act(() => { vi.advanceTimersByTime(150); });

    // With hasLibrary=true the placeholder shows the "finding stations" status.
    expect(
      screen.getByText("Finding which stations are playing your music…"),
    ).toBeTruthy();
    expect(document.querySelector(".z1-placeholder--loading")).toBeTruthy();
  });

  it("does not render any FrontDoorRow (.fdrow) elements while crossingsLoading=true (before the skeleton gate)", () => {
    mockDialDataLoading();
    renderDial();

    const rows = document.querySelectorAll(".fdrow");
    expect(rows.length).toBe(0);
  });

  it("does not render any real FrontDoorRow (.fdrow) elements once the skeleton gate opens", () => {
    mockDialDataLoading();
    renderDial();
    act(() => { vi.advanceTimersByTime(150); });

    // The placeholder renders shimmer skeletons (.fdrow-skeleton), never real
    // station rows (.fdrow), so Zone 3 can never surface before scores resolve.
    const rows = document.querySelectorAll(".fdrow");
    expect(rows.length).toBe(0);
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBeGreaterThan(0);
  });

  it("does not surface any Zone 3 'DJs on air' band while crossings are loading", () => {
    mockDialDataLoading();
    renderDial();
    act(() => { vi.advanceTimersByTime(150); });

    expect(
      screen.queryByText("DJs on air", { selector: ".fdzone-lbl__text" }),
    ).toBeNull();
  });
});

describe("Dial front-door zone order — crossingsLoading=false (loaded state)", () => {
  it("does not render the three-zone loading skeleton once crossings resolve", () => {
    mockDialDataLoaded();
    renderDial();

    // With no live stations and no ghost data the zone labels should be absent
    // (they are only rendered conditionally when there is content to show).
    // We only assert no .fdrow exists for an empty station list.
    const rows = document.querySelectorAll(".fdrow");
    expect(rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Zone 3 DJ slot reservation
// ---------------------------------------------------------------------------

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Test Show",
    djName: null,
    startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
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

/** Zone 3 attributed station (r=5): live show with djName but no crossings. */
function makeAttributedZone3Station(slug: string, djName = "DJ Attributed"): DialStation {
  return {
    station: { slug, name: `Station ${slug}`, automationClass: null, streamUrl: null, websiteUrl: null, hidden: false, favorite: false } as DialStation["station"],
    isLive: true,
    shows: [makeShow({ djName, crossings: 0, artistCrossings: 0 })],
    crossings: 0,
    artistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
  };
}

/**
 * Zone 3 unattributed station (r=0): live but no shows.
 * High lifetimeCrossings so sortedRows places it before the attributed row.
 */
function makeUnattributedZone3Station(slug: string, lifetimeCrossings = 100): DialStation {
  return {
    station: { slug, name: `Station ${slug}`, automationClass: null, streamUrl: null, websiteUrl: null, hidden: false, favorite: false } as DialStation["station"],
    isLive: true,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    lifetimeCrossings,
    lifetimeArtistCrossings: 0,
  };
}

function mockDialDataWithStations(stations: DialStation[]) {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations,
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: true,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
  });
}

function mockGhosts(ghosts: unknown[] = []) {
  (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({ data: ghosts });
}

describe("Zone 3 DJ band split", () => {
  it("attributed (r=5) rows appear in the DJ band above all unattributed rows", () => {
    // Three unattributed stations (r=0) with high lifetime crossings and one
    // attributed station (r=5). The band split places the attributed row in
    // djBand (always fully shown) and the three unattributed rows in restBand
    // (subject to ZONE3_VISIBLE=3 cap).
    const stations: DialStation[] = [
      makeUnattributedZone3Station("ua0", 300),
      makeUnattributedZone3Station("ua1", 200),
      makeUnattributedZone3Station("ua2", 150),
      makeAttributedZone3Station("attr0", "DJ Featured"),
    ];
    mockDialDataWithStations(stations);
    mockGhosts([]);

    render(<DialView />);

    const rows = document.querySelectorAll(".fdrow");
    // djBand: 1 attributed row (always visible).
    // restBand: 3 rows visible (ZONE3_VISIBLE cap = 3, and there are exactly 3).
    // Total: 4 rows.
    expect(rows.length).toBe(4);

    // The first row must be the attributed station (djBand comes first).
    expect(rows[0].textContent).toContain("DJ Featured");
    // No "See all" button — restBand.length === ZONE3_VISIBLE.
    expect(screen.queryByRole("button", { name: /^See all/ })).toBeNull();
  });

  it("restBand sorts by lifetimeCrossings desc when no attributed row exists", () => {
    // All unattributed (r=0); djBand is empty. restBand is sorted by
    // lifetimeCrossings desc and capped at ZONE3_VISIBLE = 3.
    const stations: DialStation[] = [
      makeUnattributedZone3Station("ua0", 300),
      makeUnattributedZone3Station("ua1", 200),
      makeUnattributedZone3Station("ua2", 150),
      makeUnattributedZone3Station("ua3", 100),
    ];
    mockDialDataWithStations(stations);
    mockGhosts([]);

    render(<DialView />);

    const rows = document.querySelectorAll(".fdrow");
    expect(rows.length).toBe(3);

    // First row should be the highest-crossing station (ua0).
    expect(rows[0].textContent).toContain("ua0");
    expect(rows[1].textContent).toContain("ua1");
    expect(rows[2].textContent).toContain("ua2");
  });

  it("all-attributed Zone 3 shows all rows in djBand with no restBand cap", () => {
    // All attributed (r=5) → djBand has both; restBand empty.
    // djBand is always fully shown regardless of ZONE3_VISIBLE.
    const stations: DialStation[] = [
      makeAttributedZone3Station("attr0", "DJ Alpha"),
      makeAttributedZone3Station("attr1", "DJ Beta"),
    ];
    mockDialDataWithStations(stations);
    mockGhosts([]);

    render(<DialView />);

    const rows = document.querySelectorAll(".fdrow");
    // Both rows render (djBand, no cap).
    expect(rows.length).toBe(2);
    // No empty/ghost slots.
    expect(rows[0].textContent).toBeTruthy();
    expect(rows[1].textContent).toBeTruthy();
    // No "See all" control.
    expect(screen.queryByRole("button", { name: /^See all/ })).toBeNull();
  });

  it("r=5 rows render inside the 'DJs on air' sub-label band with picker accent", () => {
    const stations: DialStation[] = [
      makeAttributedZone3Station("attr0", "DJ Picker"),
    ];
    mockDialDataWithStations(stations);
    mockGhosts([]);

    render(<DialView />);

    // The "DJs on air" sub-label must appear.
    expect(
      screen.getByText("DJs on air", { selector: ".fdzone-lbl__text" }),
    ).toBeTruthy();
    // The attributed row renders.
    const rows = document.querySelectorAll(".fdrow");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("DJ Picker");
  });

  it("does not credit an artist-valued DJ name as a selector", () => {
    // A djName that collides with the currently-playing artist must be
    // suppressed (eligibleDjName rejects it), so the row never presents the
    // artist as a DJ. The station still surfaces as an also-on-air row and the
    // artist appears in the sentence, but no DJ-credit sentence is produced.
    const artistCollision = makeAttributedZone3Station("artist-meta", "The Flaming Lips");
    artistCollision.shows[0]!.currentTrack = {
      mbid: null, artistMbid: null, title: "Do You Realize??", artist: "the flaming lips",
      playedAt: new Date().toISOString(), isLibraryHit: false, isArtistHit: false, isFirstSpin: false,
    };
    mockDialDataWithStations([artistCollision]);
    mockGhosts([]);

    render(<DialView />);

    expect(document.querySelectorAll(".fdrow")).toHaveLength(1);
    const row = document.querySelector(".fdrow")!;
    // The artist name is shown in the sentence …
    expect(row.textContent?.toLowerCase()).toContain("the flaming lips");
    // … but never as a DJ credit (no fdrow__dj node carrying the name).
    expect(row.querySelector(".fdrow__dj")).toBeNull();
  });
});
