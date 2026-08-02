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

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyOverlapSelectors: vi.fn(() => ({ data: [] })),
    useMyGhostMissed: vi.fn(() => ({ data: [] })),
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

describe("Zone 3 DJ slot reservation", () => {
  it("promotes the attributed row to index 0 when it would otherwise appear at index 3+", () => {
    // Three unattributed stations with high lifetime crossings sort before the
    // attributed one in sortedRows. Without reservation the attributed row
    // would be hidden at index 3 in the default 3-row collapsed view.
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
    // Zone 3 is truncated to ZONE3_VISIBLE = 3 by default.
    expect(rows.length).toBe(3);

    // The first row must be the attributed station, not one of the unattributed ones.
    expect(rows[0].textContent).toContain("DJ Featured");
  });

  it("preserves original order when no attributed row exists in Zone 3", () => {
    // All unattributed; sort order is by lifetimeCrossings descending.
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

    // First row should be the highest-crossing station (ua0), not any other.
    expect(rows[0].textContent).toContain("ua0");
    expect(rows[1].textContent).toContain("ua1");
    expect(rows[2].textContent).toContain("ua2");
  });

  it("does not add an empty reserved slot when Zone 3 is all attributed", () => {
    // All attributed; attributed row is already at index 0 — no promotion needed.
    const stations: DialStation[] = [
      makeAttributedZone3Station("attr0", "DJ Alpha"),
      makeAttributedZone3Station("attr1", "DJ Beta"),
    ];
    mockDialDataWithStations(stations);
    mockGhosts([]);

    render(<DialView />);

    const rows = document.querySelectorAll(".fdrow");
    // Both rows render (total 2 < ZONE3_VISIBLE = 3, so no truncation).
    expect(rows.length).toBe(2);
    // No empty/ghost slots.
    expect(rows[0].textContent).toBeTruthy();
    expect(rows[1].textContent).toBeTruthy();
  });
});
