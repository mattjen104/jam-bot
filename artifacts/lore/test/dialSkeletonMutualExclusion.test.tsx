// @vitest-environment jsdom
/**
 * Contract: skeleton rows (.fdrow-skeleton) and real ZONE 1 crossing rows
 * ([data-feed-band="reason"] .fdrow) must never appear simultaneously in the Dial front
 * door — the skeleton renders IN PLACE of the Zone 1 rows.
 *
 * Since the progressive-render change (task: fast front-door first load),
 * Zones 2/3 and the also-on-air bands render as soon as the station list is
 * available, even while crossing scores are still in-flight. Only Zone 1 —
 * the personalized crossing rows — is swapped for its skeleton:
 *   - crossingsLoading=true  → skeleton present, no [data-feed-band="reason"] .fdrow rows,
 *                              but Zone 3 station rows MAY render
 *   - crossingsLoading=false → real Zone 1 rows present (when data exists),
 *                              no skeleton rows
 *
 * This still prevents a background refetch from briefly rendering both the
 * skeleton and real Zone 1 rows at once (doubled headings), while no longer
 * blanking the whole dial behind the crossings query.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render as rtlRender } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// DialView now consumes react-query hooks directly (via meHooks that aren't all
// stubbed here), so every render must be wrapped in a QueryClientProvider.
function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: React.ReactElement) => (
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>
  );
  const utils = rtlRender(wrap(ui));
  const rerender = (node: React.ReactElement) => utils.rerender(wrap(node));
  return { ...utils, rerender };
}

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
vi.mock("../src/hooks/useStationPresence", () => ({
  useStationPresence: vi.fn(() => new Map()),
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

  it("renders no real reason-band (.fdrow) rows while crossing scores are in-flight", () => {
    mockDialData(true, [makeZone1Station("wfmu")]);
    render(<DialView />);

    const zone1Rows = document.querySelectorAll('[data-feed-band="reason"] .fdrow');
    expect(zone1Rows.length).toBe(0);
  });

  it("progressive render: Zone 3 station rows appear while crossing scores are in-flight", () => {
    mockDialData(true, [makeZone3Station("kcrw")]);
    render(<DialView />);

    // Zones 2/3 no longer wait on the crossings query — the dial renders
    // stations-only content immediately.
    const realRows = document.querySelectorAll(".fdrow");
    expect(realRows.length).toBeGreaterThan(0);
  });

  it("Zone 1 skeleton and Zone 3 rows coexist, but Zone 1 rows stay absent", () => {
    mockDialData(true, [makeZone1Station("wfmu"), makeZone3Station("kcrw")]);
    render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });

    expect(document.querySelectorAll(".fdrow-skeleton").length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-feed-band="reason"] .fdrow').length).toBe(0);
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

  it("renders real Zone 3 rows once crossing scores have resolved (crossings off)", () => {
    // With crossings on, a zero-crossing station is hidden by the
    // crossing-positive filter — so this skeleton-mutual-exclusion check
    // runs in radio mode, where no crossing filter applies.
    localStorage.setItem("lore:radioMode", "true");
    mockDialData(false, [makeZone3Station("kcrw")]);
    render(<DialView />);

    const realRows = document.querySelectorAll(".fdrow");
    expect(realRows.length).toBeGreaterThan(0);
  });

  it("crossings on: a zero-crossing Zone 3 station is hidden by the scope filter once scores resolve", () => {
    mockDialData(false, [makeZone3Station("kcrw")]);
    render(<DialView />);

    // Crossing-positive filter: zero crossings at the active scope → hidden.
    expect(document.querySelectorAll(".fdrow").length).toBe(0);
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
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
    // Progressive render: Zone 3 rows may be present — the exclusion contract
    // covers Zone 1's own rows, which the skeleton stands in for.
    const zone1RowCount = document.querySelectorAll('[data-feed-band="reason"] .fdrow').length;

    expect(skeletonCount).toBeGreaterThan(0);
    expect(zone1RowCount).toBe(0);
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

describe("Zone 2 (ghost rows) — skeleton guard during live refresh", () => {
  /**
   * Convenience: set up both the dial data mock and ghost stations in one call.
   * Ghost stations come from useMyGhostMissed, which is mocked at the module level.
   */
  function setupZone2(crossingsLoading: boolean, ghosts: GhostStation[]) {
    // Zone 3 station so the front door has content; Zone 2 supplied separately.
    mockDialData(crossingsLoading, [makeZone3Station("kcrw")]);
    (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({ data: ghosts });
  }

  it("renders ghost rows without a skeleton flash once crossings resolve", () => {
    setupZone2(false, [makeGhostStation("ghost1")]);
    render(<DialView />);

    // Zone 2 ghost rows are visible (crossingsLoading=false, ghost present).
    expect(document.querySelectorAll(".ghost-row").length).toBeGreaterThan(0);
    // No skeleton rows in the loaded state.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
  });

  it("keeps ghost rows visible while crossings reload (progressive render)", () => {
    setupZone2(false, [makeGhostStation("ghost1")]);
    const { rerender } = render(<DialView />);
    expect(document.querySelectorAll(".ghost-row").length).toBeGreaterThan(0);

    // Background refresh starts — Zone 1 swaps to its skeleton, but Zone 2
    // ghost rows stay put: crossings only rank Zone 1.
    setupZone2(true, [makeGhostStation("ghost1")]);
    act(() => { rerender(<DialView />); });
    act(() => { vi.advanceTimersByTime(150); });

    // Skeleton phase is active (grace period elapsed) …
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBeGreaterThan(0);
    // … and ghost rows remain visible throughout.
    expect(document.querySelectorAll(".ghost-row").length).toBeGreaterThan(0);

    // Refresh completes.
    setupZone2(false, [makeGhostStation("ghost1")]);
    act(() => { rerender(<DialView />); });

    // Skeleton rows are gone, ghost rows still present.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
    expect(document.querySelectorAll(".ghost-row").length).toBeGreaterThan(0);
  });

  it("Zone 1 rows and skeletons never coexist across a full refresh cycle", () => {
    setupZone2(false, [makeGhostStation("ghost1")]);
    const { rerender } = render(<DialView />);

    setupZone2(true, [makeGhostStation("ghost1")]);
    act(() => { rerender(<DialView />); });
    act(() => { vi.advanceTimersByTime(150); });

    const skeletons = document.querySelectorAll(".fdrow-skeleton").length;
    const zone1Rows = document.querySelectorAll('[data-feed-band="reason"] .fdrow').length;
    expect(skeletons === 0 || zone1Rows === 0).toBe(true);

    setupZone2(false, [makeGhostStation("ghost1")]);
    act(() => { rerender(<DialView />); });

    expect(document.querySelectorAll(".ghost-row").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Zone 2 and Zone 3 estimated-count stability during crossingsLoading transition
//
// When crossingsLoading is true, neither Zone 2 nor Zone 3 should show a
// numeric count in their headings.  This prevents a visible number-jump when
// the pre-load estimate differs from the post-score real count.
// ---------------------------------------------------------------------------

describe("Zone heading count stability during crossingsLoading transition", () => {
  it("Zone 3 heading shows no count element while crossingsLoading is true", () => {
    // Three Zone-3 stations so a pre-load estimate (if rendered) would be 3.
    mockDialData(true, [
      makeZone3Station("kcrw"),
      makeZone3Station("kexp"),
      makeZone3Station("wfmu"),
    ]);
    render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });

    // The skeleton phase is active — skeleton rows should be visible.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBeGreaterThan(0);

    // No .fdzone-lbl__n element must be present for Zone 3 during loading.
    // (Zone 2 also has no count in skeleton mode, so this query covers both.)
    const countEls = document.querySelectorAll(".fdzone-lbl__n");
    expect(countEls.length).toBe(0);
  });

  it("Zone 2 heading shows no count element while crossingsLoading is true", () => {
    mockDialData(true, [makeZone3Station("kcrw")]);
    (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [makeGhostStation("ghost1"), makeGhostStation("ghost2")],
    });
    render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });

    expect(document.querySelectorAll(".fdrow-skeleton").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".fdzone-lbl__n").length).toBe(0);
  });

  it("Zone 3 never renders a numeric count element (loading or loaded)", () => {
    // The dial no longer prints per-zone counts in its headings, so no
    // number-jump is possible between the pre-load estimate and the real count.
    // Radio mode (crossings off): the crossing-positive filter would hide
    // these zero-crossing stations and is not what this test is about.
    localStorage.setItem("lore:radioMode", "true");
    mockDialData(true, [
      makeZone3Station("kcrw"),
      makeZone3Station("kexp"),
      makeZone3Station("wfmu"),
    ]);
    const { rerender } = render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });

    // No count shown during the skeleton phase.
    expect(document.querySelector(".fdzone-lbl__n")).toBeNull();

    // Crossing scores resolve — still no count element, only real rows.
    mockDialData(false, [makeZone3Station("kcrw")]);
    act(() => { rerender(<DialView />); });

    expect(document.querySelector(".fdzone-lbl__n")).toBeNull();
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
  });

  it("Zone 3 renders real rows without any count element after load", () => {
    // Radio mode (crossings off): the crossing-positive filter would hide
    // these zero-crossing stations — this test is about the count element.
    localStorage.setItem("lore:radioMode", "true");
    mockDialData(true, [makeZone3Station("kcrw")]);
    const { rerender } = render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });

    expect(document.querySelector(".fdzone-lbl__n")).toBeNull();

    mockDialData(false, [makeZone3Station("kcrw")]);
    act(() => { rerender(<DialView />); });

    // After load, real rows are present and there is still no count element.
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
    expect(document.querySelector(".fdzone-lbl__n")).toBeNull();
  });

  it("Zone 1 heading shows no count element while crossingsLoading is true", () => {
    // Two Zone-1 stations so a pre-load estimate (if rendered) would be 2.
    mockDialData(true, [makeZone1Station("wfmu"), makeZone1Station("kexp")]);
    render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });

    // The skeleton phase is active — skeleton rows should be visible.
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBeGreaterThan(0);

    // No .fdzone-lbl__n element must be present during loading.
    expect(document.querySelector(".fdzone-lbl__n")).toBeNull();
  });

  it("Zone 1 never renders a numeric count element (loading or loaded)", () => {
    mockDialData(true, [makeZone1Station("wfmu"), makeZone1Station("kexp")]);
    const { rerender } = render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });

    // No count shown during the skeleton phase.
    expect(document.querySelector(".fdzone-lbl__n")).toBeNull();

    // Crossing scores resolve — still no count element, only real rows.
    mockDialData(false, [makeZone1Station("wfmu")]);
    act(() => { rerender(<DialView />); });

    expect(document.querySelector(".fdzone-lbl__n")).toBeNull();
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
  });

  it("Zone 1 renders real rows without any count element after load", () => {
    mockDialData(true, [makeZone1Station("wfmu")]);
    const { rerender } = render(<DialView />);
    act(() => { vi.advanceTimersByTime(150); });

    expect(document.querySelector(".fdzone-lbl__n")).toBeNull();

    mockDialData(false, [makeZone1Station("wfmu")]);
    act(() => { rerender(<DialView />); });

    // After load, real rows are present and there is still no count element.
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
    expect(document.querySelector(".fdzone-lbl__n")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Zone 3 (also-on-air rows) — skeleton guard during a live refresh
//
// Zone 3 ("also on air") appears only when !crossingsLoading and at least one
// station lands in the alsoOnAir bucket (r=0 or r=5).  A background refresh
// must never let skeleton rows and real Zone 3 rows coexist, and real rows must
// return once crossings resolve again.
// ---------------------------------------------------------------------------

describe("Zone 3 (also-on-air rows) — skeleton guard during live refresh", () => {
  /**
   * Zone 3 needs stations with no crossing evidence (makeZone3Station, r=0).
   * No ghost stations required. Radio mode (crossings off) lifts the
   * crossing-positive filter so the zero-crossing rows stay visible — these
   * tests are about the skeleton guard, not the crossing filter.
   */
  beforeEach(() => {
    localStorage.setItem("lore:radioMode", "true");
  });

  function setupZone3(crossingsLoading: boolean, stations: DialStation[] = [makeZone3Station("kcrw")]) {
    mockDialData(crossingsLoading, stations);
    (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({ data: [] });
  }

  it("renders Zone 3 rows with no skeleton rows once crossings resolve", () => {
    setupZone3(false);
    render(<DialView />);

    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
  });

  it("keeps Zone 3 rows visible while crossings reload (progressive render)", () => {
    // This test needs the Zone 1 skeleton, which radio mode suppresses — so
    // instead pin the scope to lifetime and give the fixture a lifetime
    // crossing to survive the crossing-positive filter once scores settle.
    localStorage.removeItem("lore:radioMode");
    localStorage.setItem("lore:crossingScope", "lifetime");
    const station = { ...makeZone3Station("kcrw"), lifetimeArtistCrossings: 1 };
    setupZone3(false, [station]);
    const { rerender } = render(<DialView />);
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);

    // Background refresh starts — Zone 3 rows stay put; only Zone 1 swaps
    // for its skeleton.
    setupZone3(true, [station]);
    act(() => { rerender(<DialView />); });
    act(() => { vi.advanceTimersByTime(150); });

    expect(document.querySelectorAll(".fdrow-skeleton").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-feed-band="reason"] .fdrow').length).toBe(0);

    // Refresh completes — rows remain, skeletons gone.
    setupZone3(false, [station]);
    act(() => { rerender(<DialView />); });

    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
  });

  it("skeletons and Zone 1 rows are mutually exclusive across the full refresh cycle", () => {
    setupZone3(false);
    const { rerender } = render(<DialView />);

    // Real rows visible.
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);

    // Background refresh — skeleton phase; Zone 3 rows persist but Zone 1
    // rows must never coexist with the skeleton.
    setupZone3(true);
    act(() => { rerender(<DialView />); });
    act(() => { vi.advanceTimersByTime(150); });

    const skeletonsDuringRefresh = document.querySelectorAll(".fdrow-skeleton").length;
    const zone1RowsDuringRefresh = document.querySelectorAll('[data-feed-band="reason"] .fdrow').length;
    expect(skeletonsDuringRefresh === 0 || zone1RowsDuringRefresh === 0).toBe(true);

    // Refresh resolves — real rows present, no skeletons.
    setupZone3(false);
    act(() => { rerender(<DialView />); });

    expect(document.querySelectorAll(".fdrow-skeleton").length).toBe(0);
    expect(document.querySelectorAll(".fdrow").length).toBeGreaterThan(0);
  });
});
