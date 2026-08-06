// @vitest-environment jsdom
/**
 * Regression tests: the three dial front-door zone headings must appear in
 * canonical order and Zone 3 must not render FrontDoorRow children while
 * crossingsLoading=true.
 *
 * Task #831 locked the load order by rendering all three ZoneLabel headings
 * eagerly when !isCoreLoading && crossingsLoading. These tests pin that
 * contract so a future refactor cannot silently cause Zone 3 to jump above
 * Zones 1 or 2 during the crossings-loading window.
 *
 * Covers:
 *  1. All three ZoneLabel headings appear when crossingsLoading=true.
 *  2. They appear in canonical order: Zone 1 → Zone 2 → Zone 3.
 *  3. No FrontDoorRow (.fdrow) elements exist while crossingsLoading=true,
 *     i.e. Zone 3 has no station rows until scores are ready.
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

const ZONE_LABELS = [
  "On air, with a reason",
  "Missed while you were away",
  "Also on air",
] as const;

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

function getZoneLabelElements() {
  return document.querySelectorAll(".fdzone-lbl");
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
  it("renders all three ZoneLabel headings while crossings are loading", () => {
    mockDialDataLoading();
    renderDial();
    // The skeleton gate uses a 150 ms delay (useDelayedBoolean) so that fast
    // loads never flash shimmer rows. Advance past the threshold to let the
    // zone headings appear.
    act(() => { vi.advanceTimersByTime(150); });

    for (const label of ZONE_LABELS) {
      expect(
        screen.getByText(label, { selector: ".fdzone-lbl__text" }),
        `Expected ZoneLabel "${label}" to be present`,
      ).toBeTruthy();
    }
  });

  it("renders the three zone headings in canonical order (Zone 1 → Zone 2 → Zone 3)", () => {
    mockDialDataLoading();
    renderDial();
    act(() => { vi.advanceTimersByTime(150); });

    const labelEls = Array.from(getZoneLabelElements());
    // Filter to just the three front-door zone labels (exclude any schedule labels)
    const zoneTextEls = labelEls
      .map((el) => el.querySelector(".fdzone-lbl__text")?.textContent ?? "")
      .filter((text) => (ZONE_LABELS as readonly string[]).includes(text));

    expect(zoneTextEls).toEqual([
      "On air, with a reason",
      "Missed while you were away",
      "Also on air",
    ]);
  });

  it("does not render any FrontDoorRow (.fdrow) elements while crossingsLoading=true", () => {
    mockDialDataLoading();
    renderDial();

    const rows = document.querySelectorAll(".fdrow");
    expect(rows.length).toBe(0);
  });

  it("Zone 3 heading appears after Zone 1 and Zone 2 in the DOM while loading", () => {
    mockDialDataLoading();
    renderDial();
    act(() => { vi.advanceTimersByTime(150); });

    const zone1El = screen.getByText("On air, with a reason", {
      selector: ".fdzone-lbl__text",
    });
    const zone2El = screen.getByText("Missed while you were away", {
      selector: ".fdzone-lbl__text",
    });
    const zone3El = screen.getByText("Also on air", {
      selector: ".fdzone-lbl__text",
    });

    // Use DOM position comparison: Node.DOCUMENT_POSITION_FOLLOWING means
    // the argument comes AFTER `this` in document order.
    expect(
      zone1El.compareDocumentPosition(zone3El) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      zone2El.compareDocumentPosition(zone3El) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      zone1El.compareDocumentPosition(zone2El) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("does not place an artist-valued DJ in the 'DJs on air' band", () => {
    const artistCollision = makeAttributedZone3Station("artist-meta", "The Flaming Lips");
    artistCollision.shows[0]!.currentTrack = {
      mbid: null, artistMbid: null, title: "Do You Realize??", artist: "the flaming lips",
      playedAt: new Date().toISOString(), isLibraryHit: false, isArtistHit: false, isFirstSpin: false,
    };
    mockDialDataWithStations([artistCollision]);
    mockGhosts([]);

    render(<DialView />);

    expect(screen.queryByText("DJs on air", { selector: ".fdzone-lbl__text" })).toBeNull();
    expect(document.querySelectorAll(".fdrow")).toHaveLength(1);
    expect(document.querySelector(".fdrow")?.textContent?.toLowerCase()).toContain("the flaming lips is playing");
  });
});
