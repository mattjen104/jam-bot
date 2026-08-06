// @vitest-environment jsdom
/**
 * Per-zone truncation + inline "See all / See less" toggle tests.
 *
 * Covers:
 *  1. Zone 1 with 9 rows, 0 rung-1 → 5 rendered, control reads "See all 9"
 *  2. Zone 1 with 9 rows, 8 rung-1 → all 8 rung-1 rendered (rung-1 exemption)
 *  3. Zone 1 with exactly 5 rows → no control rendered
 *  4. Click "See all N" → all rows render, control reads "See less", aria-expanded=true
 *  5. Zone 2 with 7 ghosts → 3 rendered; Zone 3 with 12 → 3 rendered
 *  6. ZoneLabel n= shows 9 while collapsed at 5
 *  7. Scan regression: Zone 1 collapsed at 5 of 9; advance samplingIdx to 7 →
 *     zone auto-expands; station at unsliced index 7 is marked sampling
 *  8. Expansion resets on slug-set change; does NOT reset on same slugs with
 *     new object identities
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

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
import { usePlayer } from "../src/player/PlayerProvider";
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
  return render(<DialView />);
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

describe("Zone 1 truncation — 9 rows, 0 rung-1", () => {
  it("renders 5 rows and shows 'See all 9' control when collapsed", () => {
    // 9 Zone-1 stations with artistCrossings (r=2), none rung-1.
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    expect(fdrowCount()).toBe(5);
    const btn = screen.getByRole("button", { name: "See all 9" });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Zone 1 rung-1 exemption — 9 rows, 8 rung-1", () => {
  it("renders all 8 rung-1 rows (exemption fires, budget = max(5,8) = 8)", () => {
    // 8 rung-1 stations + 1 rung-2 station = 9 total Zone 1
    const rung1Stations = Array.from({ length: 8 }, (_, i) => makeRung1Station(`r1s${i}`));
    const rung2Station = makeZone1Station("r2s0", false);
    mockDialData([...rung1Stations, rung2Station]);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    // Budget = max(5, 8) = 8, so 8 rows visible (the 8 rung-1 + the 9th is hidden).
    expect(fdrowCount()).toBe(8);
    // Control appears because total (9) > zone1Visible (8).
    const btn = screen.getByRole("button", { name: "See all 9" });
    expect(btn).toBeTruthy();
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

describe("Zone 1 — click See all → expand; click See less → collapse", () => {
  it("expands all rows, button becomes 'See less' with aria-expanded=true", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    const btn = screen.getByRole("button", { name: "See all 9" });
    act(() => { fireEvent.click(btn); });

    expect(fdrowCount()).toBe(9);
    // Task #921 added a second inline "See less" in the zone header; both
    // should carry aria-expanded=true when expanded.
    const lessBtns = screen.getAllByRole("button", { name: "See less" });
    expect(lessBtns.length).toBeGreaterThanOrEqual(1);
    expect(lessBtns.every((b) => b.getAttribute("aria-expanded") === "true")).toBe(true);
  });
});

describe("Zone 2 and Zone 3 truncation", () => {
  it("Zone 2 with 7 ghosts renders 3 ghost rows; Zone 3 with 12 renders 3 fdrows", () => {
    // Zero Zone 1 stations (none with crossings), 12 Zone 3 stations (no show → r=0).
    const zone3Stations = Array.from({ length: 12 }, (_, i) => makeZone3Station(`z3s${i}`));
    mockDialData(zone3Stations);

    const ghosts = Array.from({ length: 7 }, (_, i) => makeGhostStation(`ghost${i}`));
    mockGhosts(ghosts);
    mockScan(null);

    renderDial();

    // Zone 2: 3 ghost rows visible.
    expect(ghostRowCount()).toBe(3);
    const zone2Btn = screen.getByRole("button", { name: "See all 7" });
    expect(zone2Btn).toBeTruthy();

    // Zone 3: 3 fdrows visible.
    expect(fdrowCount()).toBe(3);
    const zone3Btn = screen.getByRole("button", { name: "See all 12" });
    expect(zone3Btn).toBeTruthy();
  });
});

describe("ZoneLabel n= reflects total, not visible count", () => {
  it("ZoneLabel shows n=9 while only 5 rows are rendered", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    // fdzone-lbl__n for Zone 1 should show "9".
    const nBadges = Array.from(document.querySelectorAll(".fdzone-lbl__n"));
    const zone1Badge = nBadges.find((el) => el.textContent?.includes("9"));
    expect(zone1Badge).toBeTruthy();
    // Only 5 rows rendered.
    expect(fdrowCount()).toBe(5);
  });
});

describe("Scan regression — auto-expand when scan index exceeds visible budget", () => {
  it("Zone 1 collapsed at 5/9; advancing samplingIdx to 7 auto-expands, station 7 is sampling", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);

    // Initial render: samplingIdx=null (collapsed).
    mockScan(null, false);
    const { rerender } = renderDial();

    // Confirm collapsed.
    expect(fdrowCount()).toBe(5);

    // Advance scan to index 7 (beyond the 5-row visible budget).
    mockScan(7, true);
    act(() => {
      rerender(<DialView />);
    });

    // Zone 1 should have auto-expanded.
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
// Collapse behaviour
// ---------------------------------------------------------------------------

describe("Zone collapse — clicking 'Collapse zone' hides all rows", () => {
  it("Zone 1: collapse button hides all fdrows; label remains; no see-more", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    // Default: 5 rows visible.
    expect(fdrowCount()).toBe(5);

    // Find the collapse button on the zone label.
    const collapseBtn = screen.getByRole("button", { name: "Collapse zone" });
    expect(collapseBtn.getAttribute("aria-expanded")).toBe("true");

    act(() => { fireEvent.click(collapseBtn); });

    // All rows hidden.
    expect(fdrowCount()).toBe(0);
    // No see-more control either.
    expect(screen.queryByRole("button", { name: /^See all/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "See less" })).toBeNull();

    // The button should now read "Expand zone" with aria-expanded=false.
    const expandBtn = screen.getByRole("button", { name: "Expand zone" });
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
  });

  it("Zone 1: collapsing an expanded zone hides rows and removes see-less", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    // First expand.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "See all 9" })); });
    expect(fdrowCount()).toBe(9);

    // Now collapse.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Collapse zone" })); });

    expect(fdrowCount()).toBe(0);
    expect(screen.queryByRole("button", { name: "See less" })).toBeNull();
  });

  it("Zone 1: re-clicking Expand zone restores the default truncated view", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    // Collapse.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Collapse zone" })); });
    expect(fdrowCount()).toBe(0);

    // Expand again.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Expand zone" })); });

    // Back to default truncated view (5 of 9).
    expect(fdrowCount()).toBe(5);
    expect(screen.getByRole("button", { name: "See all 9" })).toBeTruthy();
  });
});

describe("Zone collapse — Zone 2 (ghost) and Zone 3", () => {
  it("Zone 2: collapse hides ghost rows", () => {
    const zone3Stations = Array.from({ length: 3 }, (_, i) => makeZone3Station(`z3s${i}`));
    mockDialData(zone3Stations);
    const ghosts = Array.from({ length: 5 }, (_, i) => makeGhostStation(`ghost${i}`));
    mockGhosts(ghosts);
    mockScan(null);

    renderDial();

    expect(ghostRowCount()).toBe(3); // ZONE2_VISIBLE

    // There are two collapse buttons (Zone 2 and Zone 3) — find the right one by
    // confirming ghost rows disappear after clicking the first one.
    const collapseBtns = screen.getAllByRole("button", { name: "Collapse zone" });
    // Zone 2 is rendered before Zone 3.
    act(() => { fireEvent.click(collapseBtns[0]); });

    expect(ghostRowCount()).toBe(0);
    // Zone 3 rows are unaffected.
    expect(fdrowCount()).toBe(3);
  });

  it("Zone 3: collapse hides fdrows while Zone 2 stays visible", () => {
    const zone3Stations = Array.from({ length: 5 }, (_, i) => makeZone3Station(`z3s${i}`));
    mockDialData(zone3Stations);
    const ghosts = Array.from({ length: 2 }, (_, i) => makeGhostStation(`ghost${i}`));
    mockGhosts(ghosts);
    mockScan(null);

    renderDial();

    expect(fdrowCount()).toBe(3); // ZONE3_VISIBLE

    const collapseBtns = screen.getAllByRole("button", { name: "Collapse zone" });
    // Zone 3 collapse button is last.
    act(() => { fireEvent.click(collapseBtns[collapseBtns.length - 1]); });

    expect(fdrowCount()).toBe(0);
    // Zone 2 ghost rows are unaffected.
    expect(ghostRowCount()).toBe(2);
  });
});

describe("Zone collapse — resets on slug-set change", () => {
  it("collapsed zone re-shows rows when the station set changes", () => {
    const stations9 = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations9);
    mockGhosts([]);
    mockScan(null);
    const { rerender } = renderDial();

    // Collapse Zone 1.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Collapse zone" })); });
    expect(fdrowCount()).toBe(0);

    // New slug set arrives.
    const stations9New = Array.from({ length: 9 }, (_, i) => makeZone1Station(`new${i}`));
    mockDialData(stations9New);
    act(() => { rerender(<DialView />); });

    // Should be back to default truncated view (collapsed reset).
    expect(fdrowCount()).toBe(5);
  });

  it("does NOT reset collapse when same slugs arrive with new object identities", () => {
    const stations9 = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations9);
    mockGhosts([]);
    mockScan(null);
    const { rerender } = renderDial();

    // Collapse.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Collapse zone" })); });
    expect(fdrowCount()).toBe(0);

    // Same slugs, fresh object references.
    const stationsCopy = stations9.map((ds) => ({ ...ds, station: { ...ds.station } }));
    mockDialData(stationsCopy);
    act(() => { rerender(<DialView />); });

    // Still collapsed.
    expect(fdrowCount()).toBe(0);
    expect(screen.getByRole("button", { name: "Expand zone" })).toBeTruthy();
  });
});

describe("Zone collapse — scan auto-uncollapses Zone 1", () => {
  it("advancing samplingIdx within zone1Visible into a collapsed Zone 1 uncollapses (default budget rows appear)", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);

    mockScan(null, false);
    const { rerender } = renderDial();

    // Collapse Zone 1 — all rows hidden.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Collapse zone" })); });
    expect(fdrowCount()).toBe(0);

    // Scan advances to index 3 (within zone1Visible=5).
    mockScan(3, true);
    act(() => { rerender(<DialView />); });

    // Zone 1 should be un-collapsed — default budget (5) rows now visible.
    expect(fdrowCount()).toBe(5);
    // The row at index 3 ("s3") should carry the sampling class.
    const samplingRows = document.querySelectorAll(".fdrow--sampling");
    expect(samplingRows.length).toBeGreaterThan(0);
    expect(samplingRows[0].textContent).toContain("s3");
  });

  it("advancing samplingIdx beyond zone1Visible into a collapsed Zone 1 uncollapses AND expands it", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);

    mockScan(null, false);
    const { rerender } = renderDial();

    // Collapse Zone 1.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Collapse zone" })); });
    expect(fdrowCount()).toBe(0);

    // Scan advances into index 7 (beyond zone1Visible=5).
    mockScan(7, true);
    act(() => { rerender(<DialView />); });

    // Zone 1 should be un-collapsed and expanded so station 7 is visible.
    expect(fdrowCount()).toBe(9);
    expect(document.querySelectorAll(".fdrow--sampling").length).toBeGreaterThan(0);
  });
});

describe("Expansion state reset behaviour", () => {
  it("resets to collapsed when slug set changes", () => {
    const stations9 = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations9);
    mockGhosts([]);
    mockScan(null);
    const { rerender } = renderDial();

    // Expand Zone 1.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "See all 9" })); });
    expect(fdrowCount()).toBe(9);

    // Simulate a live update — new slug set (different stations).
    const stations9New = Array.from({ length: 9 }, (_, i) => makeZone1Station(`new${i}`));
    mockDialData(stations9New);
    act(() => { rerender(<DialView />); });

    // Should have collapsed back to 5.
    expect(fdrowCount()).toBe(5);
    expect(screen.getByRole("button", { name: "See all 9" })).toBeTruthy();
  });

  it("does NOT reset when same slugs arrive with new object identities", () => {
    const stations9 = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations9);
    mockGhosts([]);
    mockScan(null);
    const { rerender } = renderDial();

    // Expand Zone 1.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "See all 9" })); });
    expect(fdrowCount()).toBe(9);

    // Re-render with fresh objects but same slugs.
    const stationsCopy = stations9.map((ds) => ({ ...ds, station: { ...ds.station } }));
    mockDialData(stationsCopy);
    act(() => { rerender(<DialView />); });

    // Should remain expanded.
    expect(fdrowCount()).toBe(9);
    expect(screen.getAllByRole("button", { name: "See less" }).length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT reset when same slugs arrive in a different order (live rerank)", () => {
    const stations9 = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations9);
    mockGhosts([]);
    mockScan(null);
    const { rerender } = renderDial();

    // Expand Zone 1.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "See all 9" })); });
    expect(fdrowCount()).toBe(9);

    // Re-render with same slugs but reversed order (simulates a live rescore).
    const reordered = [...stations9].reverse();
    mockDialData(reordered);
    act(() => { rerender(<DialView />); });

    // Same membership → should remain expanded.
    expect(fdrowCount()).toBe(9);
    expect(screen.getAllByRole("button", { name: "See less" }).length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Transient-shrink resilience.
   *
   * When a slow-connection refetch temporarily drops stations and then restores
   * the original set, Zone 1 should stay expanded rather than collapsing on the
   * user mid-session.
   *
   *   expand (9 slugs) → shrink (7 slugs) → collapses to default truncated view
   *                    → recover (9 slugs) → silently re-expands (key matches
   *                                          the expand-time anchor)
   *
   * Only a genuinely different slug set (new stations appear / old ones stay
   * gone) triggers a permanent reset.
   */
// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

describe("Zone collapse — localStorage persistence", () => {
  const LS_ZONE1 = "lore.zone.1.collapsed";
  const LS_ZONE2 = "lore.zone.2.collapsed";
  const LS_ZONE3 = "lore.zone.3.collapsed";

  it("collapsing Zone 1 writes 'true' to localStorage", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    expect(localStorage.getItem(LS_ZONE1)).toBeNull();

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Collapse zone" })); });

    expect(localStorage.getItem(LS_ZONE1)).toBe("true");
    expect(fdrowCount()).toBe(0);
  });

  it("expanding a collapsed Zone 1 removes the localStorage key", () => {
    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    // Collapse then expand.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Collapse zone" })); });
    expect(localStorage.getItem(LS_ZONE1)).toBe("true");

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Expand zone" })); });
    expect(localStorage.getItem(LS_ZONE1)).toBeNull();
    expect(fdrowCount()).toBe(5); // back to default truncated view
  });

  it("on mount, reads Zone 1 collapsed preference from localStorage", () => {
    localStorage.setItem(LS_ZONE1, "true");

    const stations = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations);
    mockGhosts([]);
    mockScan(null);

    renderDial();

    // Should start collapsed because localStorage says so.
    expect(fdrowCount()).toBe(0);
    expect(screen.getByRole("button", { name: "Expand zone" })).toBeTruthy();
  });

  it("on mount, reads Zone 2 and Zone 3 collapsed preferences from localStorage", () => {
    localStorage.setItem(LS_ZONE2, "true");
    localStorage.setItem(LS_ZONE3, "true");

    const zone3Stations = Array.from({ length: 5 }, (_, i) => makeZone3Station(`z3s${i}`));
    mockDialData(zone3Stations);
    const ghosts = Array.from({ length: 4 }, (_, i) => makeGhostStation(`ghost${i}`));
    mockGhosts(ghosts);
    mockScan(null);

    renderDial();

    // Both Zone 2 and Zone 3 start collapsed.
    expect(ghostRowCount()).toBe(0);
    expect(fdrowCount()).toBe(0);

    // Both expand buttons should be present.
    const expandBtns = screen.getAllByRole("button", { name: "Expand zone" });
    expect(expandBtns.length).toBe(2);
  });

  it("slug-set change resets both in-memory state and localStorage", () => {
    const stations9 = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations9);
    mockGhosts([]);
    mockScan(null);
    const { rerender } = renderDial();

    // Collapse Zone 1 — should write to localStorage.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Collapse zone" })); });
    expect(localStorage.getItem(LS_ZONE1)).toBe("true");
    expect(fdrowCount()).toBe(0);

    // New slug set arrives — reset should fire.
    const stations9New = Array.from({ length: 9 }, (_, i) => makeZone1Station(`new${i}`));
    mockDialData(stations9New);
    act(() => { rerender(<DialView />); });

    // Back to default truncated view, localStorage cleared.
    expect(fdrowCount()).toBe(5);
    expect(localStorage.getItem(LS_ZONE1)).toBeNull();
  });

  it("same slugs with new object identities do NOT clear localStorage", () => {
    const stations9 = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations9);
    mockGhosts([]);
    mockScan(null);
    const { rerender } = renderDial();

    // Collapse Zone 1.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Collapse zone" })); });
    expect(localStorage.getItem(LS_ZONE1)).toBe("true");

    // Same slugs, fresh object references (live poll re-render).
    const stationsCopy = stations9.map((ds) => ({ ...ds, station: { ...ds.station } }));
    mockDialData(stationsCopy);
    act(() => { rerender(<DialView />); });

    // Still collapsed; localStorage still set.
    expect(fdrowCount()).toBe(0);
    expect(localStorage.getItem(LS_ZONE1)).toBe("true");
  });
});

  it("restores expanded state when the full slug set recovers after a transient shrink", () => {
    const stations9 = Array.from({ length: 9 }, (_, i) => makeZone1Station(`s${i}`));
    mockDialData(stations9);
    mockGhosts([]);
    mockScan(null);
    const { rerender } = renderDial();

    // Expand Zone 1.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "See all 9" })); });
    expect(fdrowCount()).toBe(9);

    // Simulate a fast refetch that temporarily drops two stations.
    const stations7 = stations9.slice(0, 7);
    mockDialData(stations7);
    act(() => { rerender(<DialView />); });

    // Slug key changed → zone collapses to default truncated view.
    expect(fdrowCount()).toBe(5);
    expect(screen.getByRole("button", { name: "See all 7" })).toBeTruthy();

    // Full set returns (same nine slugs as the original expanded state).
    mockDialData(stations9);
    act(() => { rerender(<DialView />); });

    // Key matches the expand-time anchor → zone silently re-expands.
    expect(fdrowCount()).toBe(9);
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
    // Both are Zone 3 restBand; ZONE3_VISIBLE=3, so both appear.
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
