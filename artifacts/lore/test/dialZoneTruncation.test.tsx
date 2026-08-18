// @vitest-environment jsdom
/**
 * Zone visibility tests.
 *
 * Covers:
 *  1. Zone 1 with 9 rows → every live crossing is rendered, no control.
 *  2. Zone 1 keeps currently-playing (rung-1) rows at the leading edge.
 *  3. Zone 1 with exactly 5 rows → no control rendered.
 *  5. Zone 2 with 7 ghosts → 3 rendered; Zone 3 with 12 → 3 rendered
 *  6. Scan regression: station at unsliced index 7 is marked sampling.
 *
 * NOTE: the hero-art dial refactor removed the per-zone collapse/expand
 * affordance ("Collapse zone"/"Expand zone" buttons + lore.zone.N.collapsed
 * localStorage) and the estimated zone-count badge (.fdzone-lbl__n). The
 * describe blocks that exercised those features were dropped; the inline
 * "See all N"/"See less" truncation toggle (and its scan auto-expand and
 * slug-set reset behaviour) is the surviving contract and is still covered.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
      scan: { active: false, samplingIdx: null, scanning: false },
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
vi.mock("../src/hooks/useStationPresence", () => ({
  useStationPresence: vi.fn(() => new Map()),
}));

// useFrontDoorScan is extracted so it can be mocked per-test to control
// scan.samplingIdx without real timers.
const mockScanReturn = {
  scanning: false,
  samplingIdx: null as number | null,
  dwellMs: 7000,
  progress: 0,
  toggle: vi.fn(),
  back: vi.fn(),
  next: vi.fn(),
  land: vi.fn(),
  adjustDwell: vi.fn(),
  stop: vi.fn(),
};

vi.mock("../src/hooks/useFrontDoorScan", () => ({
  useFrontDoorScan: vi.fn(() => ({ ...mockScanReturn })),
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { useDialData, readPins } from "../src/hooks/useDialData";
import { useMyGhostMissed } from "../src/lib/meHooks";
import { useFrontDoorScan } from "../src/hooks/useFrontDoorScan";
import { DialView } from "../src/components/DialView";
import type { DialStation, DialShow } from "../src/hooks/useDialData";
import type { GhostStation } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Factories
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

/**
 * Build a live DialStation that will land in Zone 1 (r=2: artistCrossings > 0)
 * or Zone 1 rung-1 (isLibraryHit = true on the spin → crossings > 0).
 */
function makeZone1Station(slug: string, rung1 = false): DialStation {
  return {
    station: { slug, name: `Station ${slug}`, automationClass: null, streamUrl: null, websiteUrl: null, hidden: false, favorite: false } as DialStation["station"],
    isLive: true,
    shows: [makeShow({ crossings: rung1 ? 1 : 0, artistCrossings: rung1 ? 0 : 1 })],
    crossings: rung1 ? 1 : 0,
    artistCrossings: rung1 ? 0 : 1,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
  };
}

/** Station that lands in Zone 3 (r=0: no show, no crossings). */
function makeZone3Station(slug: string): DialStation {
  return {
    station: { slug, name: `Station ${slug}`, automationClass: null, streamUrl: null, websiteUrl: null, hidden: false, favorite: false } as DialStation["station"],
    isLive: true,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
  };
}

/**
 * Zone 1 rung-1 station: show with currentTrack.isLibraryHit=true so
 * reason() returns r=1 (exact library track playing right now).
 */
function makeRung1Station(slug: string): DialStation {
  const libraryHitTrack = {
    mbid: null,
    artistMbid: null,
    title: `Track ${slug}`,
    artist: "Test Artist",
    playedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    isLibraryHit: true,
    isArtistHit: false,
    isFirstSpin: false,
  };
  return {
    station: { slug, name: `Station ${slug}`, automationClass: null, streamUrl: null, websiteUrl: null, hidden: false, favorite: false } as DialStation["station"],
    isLive: true,
    shows: [makeShow({
      crossings: 1,
      artistCrossings: 0,
      currentTrack: libraryHitTrack,
      spins: [libraryHitTrack],
    })],
    crossings: 1,
    artistCrossings: 0,
    lifetimeCrossings: 1,
    lifetimeArtistCrossings: 0,
  };
}

function makeGhostStation(slug: string): GhostStation {
  return {
    stationId: Math.random() * 10000 | 0,
    slug,
    name: `Ghost ${slug}`,
    streamUrl: "",
    streamFormat: "mp3",
    mode: "spinitron",
    attribution: true,
    artistName: "Ghost Artist",
    playedAt: null,
    day: "2026-08-06",
    showName: null,
    djName: null,
    runId: null,
  };
}

function mockDialData(stations: DialStation[]) {
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

function mockGhosts(ghosts: GhostStation[]) {
  (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({ data: ghosts });
}

/** Control the scan cursor returned by useFrontDoorScan for a single test. */
function mockScan(samplingIdx: number | null = null, scanning = false) {
  (useFrontDoorScan as ReturnType<typeof vi.fn>).mockReturnValue({
    scanning,
    samplingIdx,
    dwellMs: 7000,
    progress: 0,
    toggle: vi.fn(),
    back: vi.fn(),
    next: vi.fn(),
    land: vi.fn(),
    adjustDwell: vi.fn(),
    stop: vi.fn(),
  });
}

function renderDial() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrap = (ui: React.ReactElement) => (
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
  );
  const utils = render(wrap(<DialView />));
  // Wrap rerender so tests that pass a bare <DialView /> keep the provider.
  const rerender = (ui: React.ReactElement) => utils.rerender(wrap(ui));
  return { ...utils, rerender };
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count rendered .fdrow elements. */
function fdrowCount() {
  return document.querySelectorAll(".fdrow").length;
}

/** Count rendered .ghost-row elements. */
function ghostRowCount() {
  return document.querySelectorAll(".ghost-row").length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Zone 1 live crossings", () => {
  it("renders all 9 rows with no See all control", () => {
    // 9 Zone-1 stations with artistCrossings (r=2), none rung-1.
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    expect(fdrowCount()).toBe(9);
    expect(screen.queryByRole("button", { name: /^See all 9$/ })).toBeNull();
  });
});

describe("Zone 1 live ordering", () => {
  it("keeps every rung-1 row visible", () => {
    // 8 rung-1 stations + 1 rung-2 station = 9 total Zone 1
    const rung1Stations = Array.from({ length: 8 }, (_, i) => makeRung1Station(`r1s${i}`));
    const rung2Station = makeZone1Station("r2s0", false);
    mockDialData([...rung1Stations, rung2Station]);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    expect(fdrowCount()).toBe(9);
  });
});

describe("Zone 1 — exactly 5 rows", () => {
  it("renders all 5 rows and shows NO see-more control", () => {
    const stations = Array.from({ length: 5 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    expect(fdrowCount()).toBe(5);
    // No "See all" button should exist.
    expect(screen.queryByRole("button", { name: /^See all/ })).toBeNull();
  });
});

describe("Unified feed — no truncation toggles", () => {
  it("renders all ghost rows and all live rows with no See all buttons", () => {
    // Zero crossing stations, 12 unattributed live stations (no show → r=0).
    // Radio mode (crossings off): the crossing-positive filter would hide all
    // twelve — this test is about truncation, not the crossing filter.
    localStorage.setItem("lore:radioMode", "true");
    const restStations = Array.from({ length: 12 }, (_, i) => makeZone3Station(`z3s${i}`));
    mockDialData(restStations);

    const ghosts = Array.from({ length: 7 }, (_, i) => makeGhostStation(`ghost${i}`));
    mockGhosts(ghosts);
    mockScan(null);

    renderDial();

    // Ghost subsection: every row renders (jsdom has no IntersectionObserver,
    // so the infinite-scroll lane takes its render-everything fallback).
    expect(ghostRowCount()).toBe(7);

    // Live feed: every live station renders — no cap, no toggle.
    expect(fdrowCount()).toBe(12);
    expect(screen.queryByRole("button", { name: /^See all/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "See less" })).toBeNull();
  });
});

describe("Scan regression", () => {
  it("sampling index 7 marks station 7 without needing expansion", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);

    // Initial render: all live crossings are visible.
    mockScan(null, false);
    const { rerender } = renderDial();

    expect(fdrowCount()).toBe(9);

    // Advance scan to index 7 (beyond the 5-row visible budget).
    mockScan(7, true);
    act(() => {
      rerender(<DialView />);
    });

    expect(fdrowCount()).toBe(9);

    // The row at unsliced index 7 should carry the sampling class.
    const samplingRows = document.querySelectorAll(".fdrow--sampling");
    expect(samplingRows.length).toBeGreaterThan(0);
    // Station at index 7 is "s7".
    const samplingRow = samplingRows[0];
    expect(samplingRow.textContent).toContain("s7");
  });
});


// ---------------------------------------------------------------------------
// New sort/band tests (Task #1038)
// ---------------------------------------------------------------------------

/** Zone 1 station with a named DJ (r=2: artistCrossings > 0 + djName). */
function makeZone1DjStation(slug: string, lifetimeCrossings = 10): DialStation {
  return {
    station: { slug, name: `Station ${slug}`, automationClass: null, streamUrl: null, websiteUrl: null, hidden: false, favorite: false } as DialStation["station"],
    isLive: true,
    shows: [makeShow({ djName: "DJ Test", crossings: 0, artistCrossings: 1 })],
    crossings: 0,
    artistCrossings: 1,
    lifetimeCrossings,
    lifetimeArtistCrossings: 0,
  };
}

/** Zone 1 station with NO DJ name (r=2: artistCrossings > 0, automated stream). */
function makeZone1StreamStation(slug: string, lifetimeCrossings = 500): DialStation {
  return {
    station: { slug, name: `Station ${slug}`, automationClass: null, streamUrl: null, websiteUrl: null, hidden: false, favorite: false } as DialStation["station"],
    isLive: true,
    shows: [makeShow({ djName: null, crossings: 0, artistCrossings: 1 })],
    crossings: 0,
    artistCrossings: 1,
    lifetimeCrossings,
    lifetimeArtistCrossings: 0,
  };
}

/** Zone 3 r=0 station: live but no shows, no crossings. */
function makeZone3R0Station(slug: string, lifetimeCrossings = 0): DialStation {
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

describe("Zone 1 sort — DJ band above stream band (Fix 1)", () => {
  it("(a) DJ with 10 lifetime crossings outranks automated stream with 500 in Zone 1", () => {
    // Stream station has 500 lifetime crossings but no DJ; DJ station has only 10.
    // After the attribution-band fix the DJ must appear at index 0.
    const djStation = makeZone1DjStation("dj0", 10);
    const streamStation = makeZone1StreamStation("stream0", 500);
    mockDialData([streamStation, djStation]);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    const rows = document.querySelectorAll(".fdrow");
    // Both are Zone 1 so 2 rows visible.
    expect(rows.length).toBe(2);
    // DJ row must be first regardless of the stream's higher crossing count.
    expect(rows[0].textContent).toContain("dj0");
    expect(rows[1].textContent).toContain("stream0");
  });

  it("r=1 (exact match playing now) still floats above the DJ band", () => {
    // A rung-1 station (exact library track) must always be first even if a DJ
    // station has higher picker overlap.
    const rung1 = makeRung1Station("rung1s");
    const djStation = makeZone1DjStation("dj0", 999);
    mockDialData([djStation, rung1]);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    const rows = document.querySelectorAll(".fdrow");
    expect(rows.length).toBe(2);
    // rung-1 must be first.
    expect(rows[0].textContent).toContain("rung1s");
    expect(rows[1].textContent).toContain("dj0");
  });
});

describe("Zone 3 restBand — pinned stations float above non-pinned (Fix 3)", () => {
  // These fixtures are zero-crossing r=0 stations; radio mode (crossings off)
  // lifts the crossing-positive filter so the pin/sort behavior stays the
  // variable under test.
  beforeEach(() => {
    localStorage.setItem("lore:radioMode", "true");
  });

  it("(c) pinned r=0 row appears before non-pinned r=0 row with higher crossing count", () => {
    // 'high' has more lifetime crossings but is not pinned.
    // 'pinned' has zero crossings but is pinned.
    // Expected: pinned row first.
    const pinnedStation = makeZone3R0Station("pinned", 0);
    const highStation = makeZone3R0Station("high", 200);

    (readPins as ReturnType<typeof vi.fn>).mockReturnValue(new Set(["pinned"]));
    mockDialData([highStation, pinnedStation]);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    const rows = document.querySelectorAll(".fdrow");
    // Both are rest-band rows in the unified feed; both appear.
    expect(rows.length).toBe(2);
    // Pinned row comes first despite zero crossings.
    expect(rows[0].textContent).toContain("pinned");
    expect(rows[1].textContent).toContain("high");
  });

  it("non-pinned restBand rows sort by lifetimeCrossings desc when no pin set", () => {
    (readPins as ReturnType<typeof vi.fn>).mockReturnValue(new Set<string>());
    const lo = makeZone3R0Station("lo", 5);
    const hi = makeZone3R0Station("hi", 100);
    mockDialData([lo, hi]);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    const rows = document.querySelectorAll(".fdrow");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("hi");
    expect(rows[1].textContent).toContain("lo");
  });
});

// ---------------------------------------------------------------------------
// Front-door topbar absence (task: mobile five-row fit)
// ---------------------------------------------------------------------------

describe("Front-door topbar chrome", () => {
  it("renders no dial-topbar--all element at the all level", () => {
    const stations = Array.from({ length: 5 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    // The front door intentionally omits the topbar (renderTopbar returns null
    // for level === "all"). No .dial-topbar--all element must appear.
    expect(document.querySelector(".dial-topbar--all")).toBeNull();
    // And no wordmark or moon chrome inside the dial root.
    expect(document.querySelector(".dial-topbar__wordmark")).toBeNull();
    expect(document.querySelector(".dial-topbar__moon-btn")).toBeNull();
  });

  it("still renders five fdrow elements in the front-door layout", () => {
    const stations = Array.from({ length: 8 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    // All 8 Zone-1 rows are visible (no truncation at this count).
    // The important thing: rows exist and there is no topbar consuming space.
    expect(document.querySelectorAll(".fdrow").length).toBe(8);
    expect(document.querySelector(".dial-topbar--all")).toBeNull();
  });

  it("each fdrow carries role=button and tabIndex=0 for keyboard access", () => {
    const stations = Array.from({ length: 5 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    const rows = document.querySelectorAll<HTMLElement>(".fdrow");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      expect(row.getAttribute("role")).toBe("button");
      expect(row.getAttribute("tabindex")).toBe("0");
    }
  });
});
