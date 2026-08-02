// @vitest-environment jsdom
/**
 * Contract: skeleton rows (.fdrow-skeleton) and real zone content (.fdrow)
 * must never appear simultaneously in the Dial front door.
 *
 * `crossingsLoading` gates the two render paths as strict mutual exclusions:
 *   - crossingsLoading=true  → skeleton rows present, no .fdrow elements
 *   - crossingsLoading=false → real .fdrow elements present (when data exists),
 *                              no skeleton rows
 *
 * This prevents a background refetch from briefly rendering both skeleton rows
 * and real zone rows at the same time, which would produce doubled headings.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

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

vi.mock("../src/hooks/useFrontDoorScan", () => ({
  useFrontDoorScan: vi.fn(() => ({
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
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { useDialData } from "../src/hooks/useDialData";
import { useMyGhostMissed } from "../src/lib/meHooks";
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

/** Ghost station — triggers Zone 2 ("Missed while you were away"). */
function makeGhostStation(slug: string): GhostStation {
  return {
    stationId: Math.abs(slug.split("").reduce((a, c) => a + c.charCodeAt(0), 0)),
    slug,
    name: `Ghost ${slug}`,
    streamUrl: `https://stream.${slug}.com`,
    streamFormat: "mp3",
    mode: "live",
    attribution: true,
    artistName: "Test Artist",
  };
}

/** Live station with artist crossings → lands in Zone 1 (r=4). */
function makeZone1Station(slug: string): DialStation {
  return {
    station: {
      slug,
      name: `Station ${slug}`,
      automationClass: null,
      streamUrl: null,
      websiteUrl: null,
      hidden: false,
      favorite: false,
    } as DialStation["station"],
    isLive: true,
    shows: [makeShow({ artistCrossings: 1 })],
    crossings: 0,
    artistCrossings: 1,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 1,
  };
}

/** Live station with no crossings → lands in Zone 3 (r=0). */
function makeZone3Station(slug: string): DialStation {
  return {
    station: {
      slug,
      name: `Station ${slug}`,
      automationClass: null,
      streamUrl: null,
      websiteUrl: null,
      hidden: false,
      favorite: false,
    } as DialStation["station"],
    isLive: true,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
  };
}

function mockDialData(crossingsLoading: boolean, stations: DialStation[] = []) {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations,
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading,
    hasLibrary: true,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
  });
  (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({ data: [] });
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
  // Clear zone-collapse localStorage keys so state doesn't leak between tests.
  try { localStorage.clear(); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("crossingsLoading=true — skeleton visible, real rows absent", () => {
  it("renders skeleton rows while crossing scores are in-flight", () => {
    mockDialData(true, [makeZone1Station("wfmu")]);
    render(<DialView />);
    // Skeleton gate uses useDelayedBoolean(crossingsLoading, 150) so shimmer
    // rows only appear after the grace period. Advance past it.
    act(() => { vi.advanceTimersByTime(150); });

    const skeletons = document.querySelectorAll(".fdrow-skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders no real Zone 1 (.fdrow) rows while crossing scores are in-flight", () => {
    mockDialData(true, [makeZone1Station("wfmu")]);
    render(<DialView />);

    const realRows = document.querySelectorAll(".fdrow");
    expect(realRows.length).toBe(0);
  });

  it("renders no real Zone 3 (.fdrow) rows while crossing scores are in-flight", () => {
    mockDialData(true, [makeZone3Station("kcrw")]);
    render(<DialView />);

    const realRows = document.querySelectorAll(".fdrow");
    expect(realRows.length).toBe(0);
  });

  it("renders no real rows even when both Zone 1 and Zone 3 stations are present", () => {
    mockDialData(true, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    render(<DialView />);

    const realRows = document.querySelectorAll(".fdrow");
    expect(realRows.length).toBe(0);
  });
});

describe("crossingsLoading=false — real rows visible, skeleton absent", () => {
  it("renders no skeleton rows once crossing scores have resolved", () => {
    mockDialData(false, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    render(<DialView />);

    const skeletons = document.querySelectorAll(".fdrow-skeleton");
    expect(skeletons.length).toBe(0);
  });

  it("renders real Zone 1 rows once crossing scores have resolved", () => {
    mockDialData(false, [makeZone1Station("wfmu")]);
    render(<DialView />);

    const realRows = document.querySelectorAll(".fdrow");
    expect(realRows.length).toBeGreaterThan(0);
  });

  it("renders real Zone 3 rows once crossing scores have resolved", () => {
    mockDialData(false, [makeZone3Station("kcrw")]);
    render(<DialView />);

    const realRows = document.querySelectorAll(".fdrow");
    expect(realRows.length).toBeGreaterThan(0);
  });

  it("skeletons absent and real rows present when multiple stations resolve", () => {
    mockDialData(false, [
      makeZone1Station("wfmu"),
      makeZone1Station("kexp"),
      makeZone3Station("kcrw"),
    ]);
    render(<DialView />);

    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
  });
});

describe("background refresh transition — crossingsLoading true → false", () => {
  it("no skeleton rows remain after crossingsLoading flips false following the grace period", () => {
    // Start in loading state and advance past the 150ms grace period so
    // skeleton rows are visible.
    mockDialData(true, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    const { rerender } = render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBeGreaterThan(0);

    // Simulate the background fetch completing (crossingsLoading → false).
    // useDelayedBoolean returns `value && delayed`, so the first render after
    // value flips false already produces showSkeleton=false — no frame where
    // skeletons and real rows coexist.
    mockDialData(false, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    act(() => { rerender(<DialView />); });

    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
  });

  it("skeletons and real rows never coexist after the loading → loaded transition", () => {
    mockDialData(true, [makeZone1Station("wfmu")]);
    const { rerender } = render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });

    mockDialData(false, [makeZone1Station("wfmu")]);
    act(() => { rerender(<DialView />); });

    const skeletonCount = document.querySelectorAll(".fdrow-skeleton").length;
    const realRowCount  = document.querySelectorAll(".fdrow").length;
    // Mutual exclusion: at most one category non-zero.
    expect(skeletonCount === 0 || realRowCount === 0).toBe(true);
    // Post-load: real rows must be present.
    expect(realRowCount).toBeGreaterThan(0);
  });
});

describe("instant resolution — loading flips false within the grace window", () => {
  it("no .fdrow-skeleton ever appears when crossingsLoading resolves before the grace timer fires", () => {
    // Start in the loading state but do NOT advance the fake timer past 150ms.
    // useDelayedBoolean returns `value && delayed`; since `delayed` is still
    // false (the setTimeout hasn't fired yet), showSkeleton is false from the
    // very first render.
    mockDialData(true, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    const { rerender } = render(<DialView />);

    // Sanity: immediately after the first render (0ms elapsed) no skeletons.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);

    // Flip crossingsLoading false before the 150ms timer ever fires.
    mockDialData(false, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    act(() => { rerender(<DialView />); });

    // Skeletons must still be absent — the timer was cancelled before it fired.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
  });

  it("real .fdrow rows are present after the instant flip without skeleton flash", () => {
    mockDialData(true, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    const { rerender } = render(<DialView />);

    // Resolve before the grace timer fires.
    mockDialData(false, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    act(() => { rerender(<DialView />); });

    // Real rows must be present and skeletons absent.
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
  });

  it("advancing time after the instant flip does not resurrect skeleton rows", () => {
    mockDialData(true, [makeZone1Station("wfmu")]);
    const { rerender } = render(<DialView />);

    // Flip false before grace period, then advance well past it.
    mockDialData(false, [makeZone1Station("wfmu")]);
    act(() => {
      rerender(<DialView />);
      vi.advanceTimersByTime(300);
    });

    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
  });
});

describe("mutual exclusion invariant — never both at once", () => {
  it("loading state: skeletons > 0 AND fdrows = 0 (never coexist)", () => {
    mockDialData(true, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });

    const skeletonCount = document.querySelectorAll(".fdrow-skeleton").length;
    const realRowCount  = document.querySelectorAll(".fdrow").length;

    expect(skeletonCount).toBeGreaterThan(0);
    expect(realRowCount).toBe(0);
  });

  it("loaded state: fdrows > 0 AND skeletons = 0 (never coexist)", () => {
    mockDialData(false, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    render(<DialView />);

    const skeletonCount = document.querySelectorAll(".fdrow-skeleton").length;
    const realRowCount  = document.querySelectorAll(".fdrow").length;

    expect(realRowCount).toBeGreaterThan(0);
    expect(skeletonCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Zone 2 collapse/expand toggle — skeleton guard during a live refresh
//
// Zone 2 ("Missed while you were away") appears only when !crossingsLoading
// and ghost stations are present.  Clicking its collapse button must not
// cause skeleton rows to appear, and the collapsed/expanded state must
// survive a background refresh cycle (crossingsLoading false→true→false).
// ---------------------------------------------------------------------------

describe("Zone 2 collapse toggle — skeleton guard during live refresh", () => {
  /**
   * Convenience: set up both the dial data mock and ghost stations in one call.
   * Ghost stations come from useMyGhostMissed, which is mocked at the module level.
   */
  function setupZone2(crossingsLoading: boolean, ghosts: GhostStation[]) {
    // Zone 3 station so the front door has content; Zone 2 supplied separately.
    mockDialData(crossingsLoading, [makeZone3Station("kcrw")]);
    (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({ data: ghosts });
  }

  it("no .fdrow-skeleton appears immediately after clicking the Zone 2 collapse button", () => {
    setupZone2(false, [makeGhostStation("ghost1")]);
    render(<DialView />);

    // Zone 2 is visible (crossingsLoading=false, ghost present).
    // Its ZoneLabel renders a "Collapse zone" button while expanded.
    const collapseBtn = document.querySelector<HTMLButtonElement>('[aria-label="Collapse zone"]');
    expect(collapseBtn).not.toBeNull();

    act(() => { fireEvent.click(collapseBtn!); });

    // The click must not trigger skeleton rows — it only toggles local state.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
  });

  it("Zone 2 collapsed state is preserved when crossingsLoading flips true then false", () => {
    setupZone2(false, [makeGhostStation("ghost1")]);
    const { rerender } = render(<DialView />);

    // Collapse Zone 2.
    const collapseBtn = document.querySelector<HTMLButtonElement>('[aria-label="Collapse zone"]');
    act(() => { fireEvent.click(collapseBtn!); });

    // Background refresh starts — skeletons eventually replace zone content.
    setupZone2(true, [makeGhostStation("ghost1")]);
    act(() => { rerender(<DialView />); });
    act(() => { vi.advanceTimersByTime(150); });

    // Confirm skeleton phase is active (grace period elapsed).
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBeGreaterThan(0);
    // No real fdrow rows while skeletons are shown.
    expect(document.querySelectorAll(".fdrow").length).toBe(0);

    // Refresh completes.
    setupZone2(false, [makeGhostStation("ghost1")]);
    act(() => { rerender(<DialView />); });

    // Skeleton rows are gone.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
    // Zone 2 is still collapsed — ghost rows must not be visible.
    expect(document.querySelectorAll(".ghost-row").length).toBe(0);
    // The expand button ("Expand zone") should now be present instead.
    expect(document.querySelector('[aria-label="Expand zone"]')).not.toBeNull();
  });

  it("Zone 2 expand restores ghost rows once crossingsLoading flips false", () => {
    // Start collapsed via localStorage pre-seed.
    try { localStorage.setItem("lore.zone.2.collapsed", "true"); } catch { /* ignore */ }
    setupZone2(false, [makeGhostStation("ghost1")]);
    const { rerender } = render(<DialView />);

    // Zone 2 is collapsed; its button shows "Expand zone".
    const expandBtn = document.querySelector<HTMLButtonElement>('[aria-label="Expand zone"]');
    expect(expandBtn).not.toBeNull();

    // Click expand.
    act(() => { fireEvent.click(expandBtn!); });

    // No skeleton rows from the expand click.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);

    // Simulate a background refresh (crossingsLoading true→false).
    setupZone2(true, [makeGhostStation("ghost1")]);
    act(() => { rerender(<DialView />); });
    act(() => { vi.advanceTimersByTime(150); });

    setupZone2(false, [makeGhostStation("ghost1")]);
    act(() => { rerender(<DialView />); });

    // After refresh, Zone 2 should be expanded — ghost rows visible.
    expect(document.querySelectorAll(".ghost-row").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Zone 3 collapse/expand toggle — skeleton guard during a live refresh
//
// Zone 3 ("Also on air") appears only when !crossingsLoading and at least one
// station lands in the alsoOnAir bucket (r=0 or r≥5).  Clicking its collapse
// button must not cause skeleton rows to appear, and the collapsed/expanded
// state must survive a background refresh cycle.
// ---------------------------------------------------------------------------

describe("Zone 3 collapse toggle — skeleton guard during live refresh", () => {
  /**
   * Zone 3 needs stations with no crossing evidence (makeZone3Station, r=0).
   * No ghost stations required; Zone 2 stays absent so its collapse button
   * does not conflict with Zone 3's selector queries.
   */
  function setupZone3(crossingsLoading: boolean, stations: DialStation[] = [makeZone3Station("kcrw")]) {
    mockDialData(crossingsLoading, stations);
    (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({ data: [] });
  }

  it("no .fdrow-skeleton appears immediately after clicking the Zone 3 collapse button", () => {
    setupZone3(false);
    render(<DialView />);

    // Zone 3 is visible; its label has a "Collapse zone" button.
    const collapseBtn = document.querySelector<HTMLButtonElement>('[aria-label="Collapse zone"]');
    expect(collapseBtn).not.toBeNull();

    act(() => { fireEvent.click(collapseBtn!); });

    // The click must not introduce skeleton rows.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
  });

  it("Zone 3 collapsed state is preserved when crossingsLoading flips true then false", () => {
    setupZone3(false);
    const { rerender } = render(<DialView />);

    // Collapse Zone 3.
    const collapseBtn = document.querySelector<HTMLButtonElement>('[aria-label="Collapse zone"]');
    act(() => { fireEvent.click(collapseBtn!); });

    // Background refresh starts.
    setupZone3(true);
    act(() => { rerender(<DialView />); });
    act(() => { vi.advanceTimersByTime(150); });

    // Skeleton phase is active.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".fdrow").length).toBe(0);

    // Refresh completes.
    setupZone3(false);
    act(() => { rerender(<DialView />); });

    // Skeletons gone, Zone 3 still collapsed (no .fdrow rows from it).
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
    expect(document.querySelectorAll(".fdrow").length).toBe(0);
    // The expand button should be present.
    expect(document.querySelector('[aria-label="Expand zone"]')).not.toBeNull();
  });

  it("Zone 3 expand restores fdrow rows once crossingsLoading flips false", () => {
    // Pre-seed Zone 3 as collapsed.
    try { localStorage.setItem("lore.zone.3.collapsed", "true"); } catch { /* ignore */ }
    setupZone3(false);
    const { rerender } = render(<DialView />);

    // Zone 3 is collapsed; expand button is present.
    const expandBtn = document.querySelector<HTMLButtonElement>('[aria-label="Expand zone"]');
    expect(expandBtn).not.toBeNull();

    act(() => { fireEvent.click(expandBtn!); });

    // No skeleton rows from the expand click.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);

    // Simulate a background refresh.
    setupZone3(true);
    act(() => { rerender(<DialView />); });
    act(() => { vi.advanceTimersByTime(150); });

    setupZone3(false);
    act(() => { rerender(<DialView />); });

    // After refresh, Zone 3 rows are visible and no skeleton rows remain.
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
  });

  it("skeletons and Zone 3 rows are mutually exclusive across the full toggle+refresh cycle", () => {
    setupZone3(false);
    const { rerender } = render(<DialView />);

    // Start expanded — real rows visible.
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);

    // Collapse Zone 3.
    act(() => { fireEvent.click(document.querySelector<HTMLButtonElement>('[aria-label="Collapse zone"]')!); });
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);

    // Background refresh — skeleton phase.
    setupZone3(true);
    act(() => { rerender(<DialView />); });
    act(() => { vi.advanceTimersByTime(150); });

    const skeletonsDuringRefresh = document.querySelectorAll(".fdrow-skeleton").length;
    const realRowsDuringRefresh  = document.querySelectorAll(".fdrow").length;
    expect(skeletonsDuringRefresh === 0 || realRowsDuringRefresh === 0).toBe(true);

    // Refresh resolves.
    setupZone3(false);
    act(() => { rerender(<DialView />); });

    // Collapsed state preserved → no real rows, no skeletons.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
    expect(document.querySelectorAll(".fdrow").length).toBe(0);
  });
});
