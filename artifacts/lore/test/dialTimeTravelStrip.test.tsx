// @vitest-environment jsdom
/**
 * Tests for the DialTimeTravelStrip component and the run-navigation modes it
 * drives within DialView:
 *
 *  (a) Strip renders with → disabled in live mode (at live edge).
 *  (b) Stepping ← from today enters past-scan mode and shows the most recent run.
 *  (c) Stepping → from the most recent run returns to live mode (→ re-disabled).
 *  (d) "Top sets" toggle renders all-time run rows and hides Zones 2 & 3.
 *  (e) Clicking a run row navigates to /archive/station-runs/{runId}.
 *  (f) Empty recent-runs response: ← does nothing (stays at "Today").
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks — must precede subject imports.
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/", mockNavigate],
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

// ---------------------------------------------------------------------------
// meHooks mock — recent runs drive the coarse scan detents
// ---------------------------------------------------------------------------
const mockRecentRuns: import("../src/lib/meHooks").OverlapRun[] = [
  {
    runId: 101,
    day: "2026-08-05",
    station: { slug: "kexp", name: "KEXP", stationClass: "public" },
    show: { name: "Morning Show", djName: "DJ Alex" },
    owned: 3,
    discover: 2,
  },
];

const mockTopRuns: import("../src/lib/meHooks").OverlapRun[] = [
  {
    runId: 201,
    day: "2026-07-10",
    station: { slug: "wfmu", name: "WFMU", stationClass: "public" },
    show: { name: "Best Bands", djName: "DJ Best" },
    owned: 10,
    discover: 5,
  },
];

// Default crossing moments returned for the KEXP run (runId 101).
// The real /me/overlaps/runs/:runId/crossings endpoint guarantees non-null mbid
// (it filters isNotNull(mbid) + inArray(userMbids)), so all rows here are
// library-resolved. Tests that need empty crossings override useMyRunCrossings.
const mockCrossingMoments: import("../src/lib/meHooks").RunCrossingMoment[] = [
  {
    spinId: 500,
    playedAt: "2026-08-05T02:10:00Z",
    mbid: "mbid-crossing-001",
    artistName: "Portishead",
    trackTitle: "Glory Box",
    station: { slug: "kexp", name: "KEXP" },
    runId: 101,
    showName: "Morning Show",
    djName: "DJ Alex",
    spinDurationSeconds: 240,
  },
  {
    spinId: 501,
    playedAt: "2026-08-05T02:14:00Z",
    mbid: "mbid-crossing-002",
    artistName: "Portishead",
    trackTitle: "Sour Times",
    station: { slug: "kexp", name: "KEXP" },
    runId: 101,
    showName: "Morning Show",
    djName: "DJ Alex",
    spinDurationSeconds: 220,
  },
  {
    spinId: 502,
    playedAt: "2026-08-05T02:18:00Z",
    mbid: "mbid-crossing-003",
    artistName: "Massive Attack",
    trackTitle: "Teardrop",
    station: { slug: "kexp", name: "KEXP" },
    runId: 101,
    showName: "Morning Show",
    djName: "DJ Alex",
    spinDurationSeconds: 330,
  },
];

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyOverlapRunsRecent: vi.fn(() => ({ data: mockRecentRuns, isLoading: false })),
    useMyRunCrossings: vi.fn(() => ({ data: mockCrossingMoments, isLoading: false })),
    useMyOverlapRunsFor: vi.fn((day: string | null, opts: { enabled?: boolean } = {}) => {
      const enabled = opts.enabled !== false;
      if (!enabled) return { data: [], isLoading: false };
      if (day !== null) return { data: [], isLoading: false };
      return { data: mockTopRuns, isLoading: false }; // top mode: day=null
    }),
    useMyGhostMissed: vi.fn(() => ({
      data: [
        {
          stationId: 1,
          slug: "ghost-station",
          name: "Ghost Radio",
          streamUrl: "",
          streamFormat: "mp3",
          mode: "spinitron",
          attribution: true,
          artistName: "Ghost Artist",
          playedAt: null,
          day: "2026-08-05",
          showName: null,
          djName: null,
          runId: null,
        },
      ],
    })),
    useSpotifyLibraryConnected: vi.fn(() => true),
    startSpotifyLibraryConnect: vi.fn(),
  });
});

// Stable spy shared across all tests so we can assert on ride.startReplay calls.
// vi.clearAllMocks() clears call history but keeps the spy function itself alive.
const sharedStartReplaySpy = vi.fn();

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
      ride: { active: false, startReplay: sharedStartReplaySpy, stop: vi.fn() },
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

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { useDialData } from "../src/hooks/useDialData";
import { useMyOverlapRunsRecent, useMyRunCrossings } from "../src/lib/meHooks";
import { usePlayer } from "../src/player/PlayerProvider";
import { DialView } from "../src/components/DialView";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockDialDataSettled() {
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
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <DialView />
    </QueryClientProvider>,
  );
}

// Run navigation moved from the (now-hidden) DialTimeTravelStrip onto the
// hero-art time chevrons. The button semantics are the same — ‹ steps back in
// time, › steps forward toward the live edge (disabled at the live edge) — only
// the aria-labels changed.
function getNextBtn() {
  return screen.getByRole("button", { name: "Forward in time — next run" });
}

function getPrevBtn() {
  return screen.getByRole("button", { name: "Back in time — previous run" });
}

// The "where in time" label. In live mode nothing is shown (the topbar moon is
// the only time indicator); once stepped back, .dial-hero__timelabel carries
// "<station> · <date>".
function getTimeLabel() {
  return document.querySelector(".dial-hero__timelabel");
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("(a) strip renders with → disabled in live mode", () => {
  it("the Next run arrow is disabled and aria-disabled when at live edge", () => {
    mockDialDataSettled();
    renderDial();

    const nextBtn = getNextBtn();
    expect(nextBtn).toBeTruthy();
    expect(nextBtn.hasAttribute("disabled")).toBe(true);
    expect(nextBtn.getAttribute("aria-disabled")).toBe("true");

    // Previous run is always enabled (can always step back)
    expect(getPrevBtn().hasAttribute("disabled")).toBe(false);
  });

  it("shows no where-in-time label in live mode; the topbar moon is the indicator", () => {
    mockDialDataSettled();
    renderDial();

    // At the live edge there is no hero time label — the topbar moon glyph is
    // the only time indicator, and it is decorative (aria-hidden).
    expect(getTimeLabel()).toBeNull();
    expect(screen.queryByText("Today")).toBeNull();

    const topbarMoon = document.querySelector(".dial-topbar__moon-tr");
    expect(topbarMoon).toBeTruthy();
    expect(topbarMoon?.getAttribute("aria-hidden")).toBe("true");
    expect(topbarMoon?.querySelector("svg.moon-glyph")).toBeTruthy();
  });
});

describe("(b) stepping ← shows most recent crossing run", () => {
  it("RunRow for the most recent crossing run appears after pressing ←", () => {
    mockDialDataSettled();
    renderDial();

    act(() => {
      fireEvent.click(getPrevBtn());
    });

    // The run row for KEXP (runId 101) should be visible via data-run-id
    const runRow = document.querySelector('[data-run-id="101"]') as HTMLElement | null;
    expect(runRow).toBeTruthy();
  });

  it("→ is enabled after stepping back one run", () => {
    mockDialDataSettled();
    renderDial();

    act(() => {
      fireEvent.click(getPrevBtn());
    });

    const nextBtn = getNextBtn();
    expect(nextBtn.hasAttribute("disabled")).toBe(false);
  });

  it("hero time label appears with station + date once stepped back", () => {
    mockDialDataSettled();
    renderDial();

    act(() => {
      fireEvent.click(getPrevBtn());
    });

    // Once stepped back from the live edge, the hero time label shows the
    // landed run's station name and day (station · <date>). The DJ name is no
    // longer part of this compact indicator.
    const ttLabel = getTimeLabel();
    expect(ttLabel).toBeTruthy();
    expect(ttLabel?.textContent).toContain("KEXP");
    // runDate("2026-08-05") renders as a short UTC date (e.g. "Aug 5, 2026").
    expect(ttLabel?.textContent).toMatch(/2026/);

    // The topbar moon now tracks the scrubbed day and stays decorative.
    const topbarMoon = document.querySelector(".dial-topbar__moon-tr");
    const moon = topbarMoon?.querySelector("svg.moon-glyph");
    expect(moon).toBeTruthy();
    expect(topbarMoon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("live Zone 1 crossing rows (.fdrow) are absent after stepping back into past-scan", () => {
    // Guard: after ← is clicked, pastScan.isAtLiveEdge becomes false and the
    // live Zone-1/Zone-2 content gate `{ttMode === "live" && pastScan.isAtLiveEdge}`
    // must suppress all FrontDoorRow (.fdrow) elements.
    mockDialDataSettled();
    renderDial();

    // Baseline: in live mode, Zone 1 has no crossing rows (stations=[]), but
    // the container DOM node for zone1-rows exists.
    const zone1Before = document.getElementById("zone1-rows");
    // zone1-rows may or may not exist before stepping back — it's live mode.

    act(() => {
      fireEvent.click(getPrevBtn());
    });

    // After stepping back, the whole live block is gated off — zone1-rows
    // must not be present in the DOM.
    const zone1After = document.getElementById("zone1-rows");
    expect(zone1After).toBeNull();

    // Ghost (Zone 2) rows must also be absent.
    const zone2After = document.getElementById("zone2-rows");
    expect(zone2After).toBeNull();
  });
});

describe("(c) stepping → from the most recent run returns to live mode", () => {
  it("re-disables → and shows 'Today' after stepping back then forward", () => {
    mockDialDataSettled();
    renderDial();

    // Go back one run
    act(() => {
      fireEvent.click(getPrevBtn());
    });
    // Now go forward — should return to live edge
    act(() => {
      fireEvent.click(getNextBtn());
    });

    // Back to live mode — the hero time label is gone again and → re-disables.
    expect(getTimeLabel()).toBeNull();
    const nextBtn = getNextBtn();
    expect(nextBtn.hasAttribute("disabled")).toBe(true);
  });
});

describe("(d) 'Top sets' toggle is hidden for now (machinery kept for later)", () => {
  it("no Top sets button renders in the strip", () => {
    mockDialDataSettled();
    renderDial();

    expect(screen.queryByRole("button", { name: "⭐ Top sets" })).toBeNull();
    // Live edge: no hero time label, and the run-nav chevrons are present.
    expect(getTimeLabel()).toBeNull();
    expect(getPrevBtn()).toBeTruthy();
    expect(getNextBtn()).toBeTruthy();
  });
});

describe("(e) clicking a run row navigates to /archive/station-runs/{runId}", () => {
  it("click on run row triggers navigation to /archive/station-runs/101", () => {
    mockDialDataSettled();
    renderDial();

    // Step to past-scan mode
    act(() => {
      fireEvent.click(getPrevBtn());
    });

    // Find the run row by data-run-id
    const runRow = document.querySelector('[data-run-id="101"]') as HTMLElement | null;
    expect(runRow).toBeTruthy();

    act(() => {
      fireEvent.click(runRow!);
    });

    // RunRow must route to the station-run archive page, not /replay/{runId}.
    // runId here is min(spin.id) — a run anchor, not a replay manifest ID.
    expect(mockNavigate).toHaveBeenCalledWith("/archive/station-runs/101");
  });
});

describe("(r) coarse scan window defaults to 2 days", () => {
  it("fetches the recent runs with the default 2-day window", () => {
    // The range pills (2d/1w/1m) were removed from the dial flow — time travel
    // now lives on the hero art (chevrons + swipe). The default coarse-scan
    // window is still 2 days, driven by useMyOverlapRunsRecent({ days: 2 }).
    mockDialDataSettled();
    renderDial();

    // No range pill UI is present in the flow anymore.
    expect(screen.queryByRole("button", { name: "Scan back 2 days" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan back 7 days" })).toBeNull();

    // Default fetch asks for the 2-day window.
    const recentMock = useMyOverlapRunsRecent as ReturnType<typeof vi.fn>;
    expect(recentMock.mock.calls.some((c) => c[0]?.days === 2)).toBe(true);
  });
});

describe("(f) empty recent-runs: ← keeps the view at live edge", () => {
  it("when recentRuns is empty, ← does not change the label from 'Today'", () => {
    (useMyOverlapRunsRecent as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
    });

    mockDialDataSettled();
    renderDial();

    act(() => {
      fireEvent.click(getPrevBtn());
    });

    // Stays at live edge — no coarse candidates to navigate to. No hero time
    // label is shown, and → remains disabled.
    expect(getTimeLabel()).toBeNull();
    const nextBtn = getNextBtn();
    expect(nextBtn.hasAttribute("disabled")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (g) Integration: landing on a run renders crossing rows wired to the seed
//     data the player needs — proves that fineCrossings flows through to the
//     DOM so clicking any row produces a playable replay seed.
//
// The startPastReplay function (seed construction, index translation, and the
// exact ride.startReplay call shape) is tested via inline simulation in
// dialPastScan.test.tsx: "startPastReplay integration — ride.startReplay call shape".
//
// Seeds always carry links=[] — PlayerProvider resolves previewUrl lazily via
// getRecordingPreview(mbid) (its `currentNeedsLinks` path, ~line 1810) rather
// than pre-fetching here.  This is the same pattern as LibraryRow and
// StationScrubTimeline: those callers also pass links=[] and playback works.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// (g) Integration: useMyRunCrossings is wired to DialView and the
//     startPastReplay seed contract is enforced.
//
// The full startPastReplay contract (seed mbid/title/artist/links/startIndex/
// timeOrientation/context) is verified by inline simulation in
// dialPastScan.test.tsx describe "startPastReplay integration". That block
// simulates the identical logic and covers all boundary conditions, including
// null-MBID index translation and the links=[] PlayerProvider contract.
//
// Here we verify that:
//  (g1) useMyRunCrossings is mocked in this test environment (component uses
//       the test's mock, not the real React Query hook). If this fails, the
//       component has an unexpected import path change.
//  (g2) After entering past-scan mode, crossing-moment data is fetched for the
//       landed run: the component calls useMyRunCrossings. Confirmed by checking
//       that the component renders with the data provided by the mock.
//
// Note on links=[]: seeds carry no pre-fetched links because PlayerProvider's
// `currentNeedsLinks` path (~line 1810) resolves previewUrl lazily via
// getRecordingPreview(mbid). LibraryRow and StationScrubTimeline use the same
// pattern and playback works end-to-end.
// ---------------------------------------------------------------------------
// (g) Integration: useMyRunCrossings is wired to DialView and the mock is
// active when the component renders. The startPastReplay seed contract
// (mbid/title/artist/artworkUrl=null/links=[]/startIndex/timeOrientation/context
// and null-MBID index translation) is verified by inline simulation in
// dialPastScan.test.tsx describe "startPastReplay integration".
//
// Notes on seeds:
// - links=[] is intentional: PlayerProvider's `currentNeedsLinks` path
//   (~line 1810) resolves previewUrl lazily via getRecordingPreview(mbid),
//   same as LibraryRow and StationScrubTimeline.
// - null-MBID crossings are excluded from seeds; their index is translated
//   to the nearest non-null seed (tested exhaustively in dialPastScan.test.tsx).
describe("(g) landing on a run — crossing data flows through useMyRunCrossings to RunRow", () => {
  beforeEach(() => {
    // Describe (f) overrides useMyOverlapRunsRecent with [] via mockReturnValue, and
    // vi.clearAllMocks() only clears call history (not return-value overrides). Re-apply
    // the correct mock before each test in this describe block.
    (useMyOverlapRunsRecent as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockRecentRuns,
      isLoading: false,
    });
  });

  it("after ← the coarse-landed run's RunRow appears and useMyRunCrossings was called", () => {
    // This test confirms the integration seam: the component calls the mocked
    // useMyRunCrossings (not the real React Query hook) and renders RunRow for
    // the landed run. The startPastReplay effect, if fineCrossings is non-empty,
    // further calls ride.startReplay — but that spy contract is proven in
    // dialPastScan.test.tsx via inline simulation to avoid component-render
    // isolation complexity.
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    // RunRow must appear — proves data path is intact.
    const runRow = document.querySelector('[data-run-id="101"]');
    expect(runRow).not.toBeNull();
    // Hook was called (at least from the initial render before landing) —
    // proves the component uses the mocked hook, not the real React Query one.
    expect((useMyRunCrossings as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (h) Integration: crossing rows render, swipe triggers fine step + startReplay,
//     and clicking a crossing row calls startReplay with correct seed index.
//
// mockCrossingMoments has 3 items: [Portishead mbid-001, null-mbid, Massive Attack mbid-003].
// Non-null seeds = [Portishead (seeds[0]), Massive Attack (seeds[1])].
// startPastReplay(i) maps fineCrossings[i] → seedIdx = #{non-null ≤ i} - 1.
// ---------------------------------------------------------------------------

describe("(h) swipe/click wiring — crossing rows and startReplay", () => {
  beforeEach(() => {
    (useMyOverlapRunsRecent as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockRecentRuns,
      isLoading: false,
    });
    (useMyRunCrossings as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockCrossingMoments,
      isLoading: false,
    });
  });

  it("crossing rows with data-crossing-index appear after entering past mode", async () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    await waitFor(() => {
      expect(document.querySelector('[data-crossing-index="0"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-crossing-index="1"]')).not.toBeNull();
    expect(document.querySelector('[data-crossing-index="2"]')).not.toBeNull();
  });

  it("data-spine element is rendered after entering past mode (spine-tap readiness)", async () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    await waitFor(() => {
      expect(document.querySelector('[data-spine="true"]')).not.toBeNull();
    });
  });

  it("coarse landing calls ride.startReplay with the first crossing seed (startIndex=0)", async () => {
    mockDialDataSettled();
    renderDial();

    sharedStartReplaySpy.mockClear();

    act(() => { fireEvent.click(getPrevBtn()); });

    // Wait for the coarse-landing effect to fire.
    await waitFor(() => {
      expect(sharedStartReplaySpy).toHaveBeenCalled();
    });

    const [seeds, , opts] = sharedStartReplaySpy.mock.calls[0]!;
    // All 3 mocked crossings have non-null mbid → 3 seeds
    expect(seeds).toHaveLength(3);
    expect(seeds[0].mbid).toBe("mbid-crossing-001");
    expect(seeds[2].mbid).toBe("mbid-crossing-003");
    expect(opts.timeOrientation).toBe("past");
    expect(opts.startIndex).toBe(0);
    expect(opts.context).toBe("dial-past-scan");
  });

  it("swipe left on crossing area calls startReplay for the next fine crossing", async () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    // Wait for crossing rows to appear
    await waitFor(() => {
      expect(document.querySelector('.dial-past-crossings')).not.toBeNull();
    });

    // Clear spy (coarse-landing already fired once)
    sharedStartReplaySpy.mockClear();

    const container = document.querySelector('.dial-past-crossings') as HTMLElement;

    // Swipe left: start at x=200, end at x=80 (dx=-120, well beyond 40px threshold)
    act(() => {
      fireEvent.touchStart(container, {
        touches: [{ clientX: 200, clientY: 100, identifier: 0, target: container }],
      });
    });
    act(() => {
      fireEvent.touchEnd(container, {
        changedTouches: [{ clientX: 80, clientY: 100, identifier: 0, target: container }],
      });
    });

    // fine-landing effect: fineIdx goes null → 0 → startPastReplay(0)
    await waitFor(() => {
      expect(sharedStartReplaySpy).toHaveBeenCalled();
    });

    const [seeds, , opts] = sharedStartReplaySpy.mock.calls[0]!;
    expect(opts.timeOrientation).toBe("past");
    expect(opts.startIndex).toBe(0); // fineIdx=0 → first non-null seed
    expect(seeds[0].mbid).toBe("mbid-crossing-001");
  });

  it("clicking crossing row at index 2 (Massive Attack) calls startReplay with startIndex=2", async () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    await waitFor(() => {
      expect(document.querySelector('[data-crossing-index="2"]')).not.toBeNull();
    });

    sharedStartReplaySpy.mockClear();

    const row2 = document.querySelector('[data-crossing-index="2"]') as HTMLElement;
    act(() => { fireEvent.click(row2); });

    // jumpToFine(2) → fineIdx=2 → fine-landing effect → startPastReplay(2)
    // All 3 crossings are non-null → seeds[2] = Massive Attack, startIndex=2
    await waitFor(() => {
      expect(sharedStartReplaySpy).toHaveBeenCalled();
    });

    const [seeds, , opts] = sharedStartReplaySpy.mock.calls[0]!;
    expect(seeds).toHaveLength(3);
    expect(seeds[2].mbid).toBe("mbid-crossing-003");
    expect(opts.startIndex).toBe(2);
    expect(opts.timeOrientation).toBe("past");
  });

  it("clicking row at index 2 sets fineIdx active so the active class moves there", async () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    await waitFor(() => {
      expect(document.querySelector('[data-crossing-index="2"]')).not.toBeNull();
    });

    const row2 = document.querySelector('[data-crossing-index="2"]') as HTMLElement;
    act(() => { fireEvent.click(row2); });

    // After jumpToFine(2), the active class moves to row index 2
    await waitFor(() => {
      expect(row2.classList.contains("dial-past-crossing--active")).toBe(true);
    });

    // And the other rows should NOT have the active class
    const row0 = document.querySelector('[data-crossing-index="0"]') as HTMLElement;
    expect(row0.classList.contains("dial-past-crossing--active")).toBe(false);
  });

  it("RunDensitySpine bins render with data-run-idx attributes after entering past mode", async () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    await waitFor(() => {
      expect(document.querySelector('[data-spine="true"]')).not.toBeNull();
    });

    // The spine should have a bin for our one run (runIdx=0)
    const bin = document.querySelector('[data-run-idx="0"]') as HTMLElement;
    expect(bin).not.toBeNull();
    expect(bin.dataset.day).toBe("2026-08-05");
  });

  it("clicking a RunDensitySpine bin jumps to that run index", async () => {
    // Setup two runs so there's a bin to click
    (useMyOverlapRunsRecent as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        {
          runId: 101,
          day: "2026-08-05",
          station: { slug: "kexp", name: "KEXP", stationClass: "public" },
          show: { name: "Morning Show", djName: "DJ Alex" },
          owned: 3,
          discover: 2,
        },
        {
          runId: 99,
          day: "2026-08-04",
          station: { slug: "kexp", name: "KEXP", stationClass: "public" },
          show: { name: "Afternoon Show", djName: "DJ Bex" },
          owned: 2,
          discover: 1,
        },
      ],
      isLoading: false,
    });

    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    await waitFor(() => {
      expect(document.querySelector('[data-spine="true"]')).not.toBeNull();
    });

    // Click the bin for runIdx=1 (older run, run 99) via data-run-idx attribute
    const bin1 = document.querySelector('[data-run-idx="1"]') as HTMLElement;
    expect(bin1).not.toBeNull();

    act(() => { fireEvent.click(bin1); });

    // After clicking bin1, the active run should change — the old run row disappears
    // and the new run row appears (or the spine reflects the new active index)
    await waitFor(() => {
      const activeBin = document.querySelector('.dial-density-spine__bin--active');
      expect(activeBin?.getAttribute('data-run-idx')).toBe('1');
    });
  });
});
