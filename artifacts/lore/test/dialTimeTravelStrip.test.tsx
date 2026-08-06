// @vitest-environment jsdom
/**
 * Tests for the DialTimeTravelStrip component and the time-travel modes it
 * drives within DialView:
 *
 *  (a) Strip renders with → disabled in live mode.
 *  (b) Stepping ← from today renders day-mode rows fetched with the correct
 *      ?day= param.
 *  (c) Stepping → from yesterday returns to live mode (→ re-disabled).
 *  (d) "Top sets" toggle renders all-time run rows and hides Zones 2 & 3.
 *  (e) Clicking a run row navigates to /replay/{runId}.
 *  (f) Empty day response shows the "No sets that day" empty state.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
// meHooks mock — overrides for the tt hooks
// ---------------------------------------------------------------------------
const mockDayRuns: import("../src/lib/meHooks").OverlapRun[] = [
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

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyOverlapRunsFor: vi.fn((day: string | null, opts: { enabled?: boolean } = {}) => {
      const enabled = opts.enabled !== false;
      if (!enabled) return { data: [], isLoading: false };
      if (day !== null) return { data: mockDayRuns, isLoading: false };
      return { data: mockTopRuns, isLoading: false };
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

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { useDialData } from "../src/hooks/useDialData";
import { useMyOverlapRunsFor } from "../src/lib/meHooks";
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

function getNextBtn() {
  return screen.getByRole("button", { name: "Next day" });
}

function getPrevBtn() {
  return screen.getByRole("button", { name: "Previous day" });
}

function getTopSetsBtn() {
  return screen.getByRole("button", { name: "⭐ Top sets" });
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

// Freeze time to a UTC/local-boundary timestamp:
// 2026-08-06T01:30:00Z  →  UTC date = "2026-08-06"
//                          Local date in UTC-8  = "2026-08-05"  (different!)
const BOUNDARY_UTC = "2026-08-06T01:30:00Z";
const BOUNDARY_UTC_TODAY = "2026-08-06";         // what the API expects
const BOUNDARY_UTC_YESTERDAY = "2026-08-05";      // expected Prev from today
const BOUNDARY_UTC_TWO_DAYS_AGO = "2026-08-04";  // still in the past (not "today")

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("(a) strip renders with → disabled in live mode", () => {
  it("the Next day arrow button is disabled and aria-disabled when mode=live", () => {
    mockDialDataSettled();
    renderDial();

    const nextBtn = getNextBtn();
    expect(nextBtn).toBeTruthy();
    expect(nextBtn.hasAttribute("disabled")).toBe(true);
    expect(nextBtn.getAttribute("aria-disabled")).toBe("true");

    // Prev is always enabled
    expect(getPrevBtn().hasAttribute("disabled")).toBe(false);
  });

  it("the strip label reads 'Today' in live mode", () => {
    mockDialDataSettled();
    renderDial();

    expect(screen.getByText("Today")).toBeTruthy();
  });
});

describe("(b) stepping ← from today renders day-mode rows with correct day param", () => {
  it("fetches day-mode runs with the day before today", () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    // The hook should have been called with day !== null
    const calls = (useMyOverlapRunsFor as ReturnType<typeof vi.fn>).mock.calls;
    const dayModeCall = calls.find(
      ([day, opts]: [string | null, { enabled?: boolean }]) =>
        day !== null && opts.enabled === true,
    );
    expect(dayModeCall).toBeTruthy();
    const [calledDay] = dayModeCall!;
    // Should be a valid YYYY-MM-DD in the past
    expect(/^\d{4}-\d{2}-\d{2}$/.test(calledDay as string)).toBe(true);

    // RunRow for the mock day run should be visible
    expect(screen.getByText("KEXP")).toBeTruthy();
    expect(screen.getByText(/DJ Alex/)).toBeTruthy();
  });

  it("→ is enabled after stepping back one day", () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    const nextBtn = getNextBtn();
    expect(nextBtn.hasAttribute("disabled")).toBe(false);
  });
});

describe("(c) stepping → from yesterday returns to live mode", () => {
  it("re-disables → and shows 'Today' after stepping back then forward", () => {
    mockDialDataSettled();
    renderDial();

    // Go back one day
    act(() => { fireEvent.click(getPrevBtn()); });
    // Now go forward — should return to today
    act(() => { fireEvent.click(getNextBtn()); });

    // Back to live mode
    expect(screen.getByText("Today")).toBeTruthy();
    const nextBtn = getNextBtn();
    expect(nextBtn.hasAttribute("disabled")).toBe(true);
  });
});

describe("(d) 'Top sets' toggle renders all-time run rows and hides Zones 2 & 3", () => {
  it("shows WFMU top run and no ghost row when top sets active", () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getTopSetsBtn()); });

    // Top run row visible
    expect(screen.getByText("WFMU")).toBeTruthy();
    expect(screen.getByText(/DJ Best/)).toBeTruthy();

    // Zone 2 ghost row NOT visible (top mode hides it)
    expect(screen.queryByText("Ghost Radio")).toBeNull();
  });

  it("strip label reads 'Top sets · all time' in top mode", () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getTopSetsBtn()); });

    expect(screen.getByText("Top sets · all time")).toBeTruthy();
  });

  it("pressing 'Top sets' again returns to live mode", () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getTopSetsBtn()); });
    act(() => { fireEvent.click(getTopSetsBtn()); });

    expect(screen.getByText("Today")).toBeTruthy();
  });
});

describe("(e) clicking a run row navigates to /archive/station-runs/{runId}", () => {
  it("click on day run row triggers navigation to /archive/station-runs/101", () => {
    mockDialDataSettled();
    renderDial();

    // Step to day mode
    act(() => { fireEvent.click(getPrevBtn()); });

    // Find the run row by data-run-id
    const runRow = document.querySelector('[data-run-id="101"]') as HTMLElement | null;
    expect(runRow).toBeTruthy();

    act(() => { fireEvent.click(runRow!); });

    // RunRow must route to the station-run archive page, not /replay/{runId}.
    // runId here is min(spin.id) — a run anchor, not a replay manifest ID.
    // Routing to /replay/ would silently produce "not in archive" errors for
    // runs that have no replay manifest.
    expect(mockNavigate).toHaveBeenCalledWith("/archive/station-runs/101");
  });
});

describe("(g) UTC boundary — ← and → use UTC date, not local date", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(BOUNDARY_UTC));
  });

  it("← from live at UTC boundary steps to UTC yesterday, not local yesterday", () => {
    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    // The hook must be called with the UTC date minus one day.
    const calls = (useMyOverlapRunsFor as ReturnType<typeof vi.fn>).mock.calls;
    const dayModeCall = calls.find(
      ([day, opts]: [string | null, { enabled?: boolean }]) =>
        day !== null && opts.enabled === true,
    );
    expect(dayModeCall).toBeTruthy();
    expect(dayModeCall![0]).toBe(BOUNDARY_UTC_YESTERDAY);
    // NOT BOUNDARY_UTC_TWO_DAYS_AGO ("2026-08-04") which local-date logic would produce.
    expect(dayModeCall![0]).not.toBe(BOUNDARY_UTC_TWO_DAYS_AGO);
  });

  it("→ from two-days-ago stays in day mode (doesn't mistakenly return to live)", () => {
    // At the UTC boundary, UTC today = "2026-08-06".
    // stepDay("2026-08-04", +1) = "2026-08-05" which is < UTC today → day mode.
    // Broken local logic: local today = "2026-08-05" → "2026-08-05" >= "2026-08-05" → live (wrong).
    mockDialDataSettled();
    renderDial();

    // Navigate to two-days-ago: press ← twice.
    act(() => { fireEvent.click(getPrevBtn()); }); // → BOUNDARY_UTC_YESTERDAY
    act(() => { fireEvent.click(getPrevBtn()); }); // → BOUNDARY_UTC_TWO_DAYS_AGO

    // Verify we are in day mode showing the two-days-ago label.
    expect(screen.queryByText("Today")).toBeNull();

    // Now press → — should step forward to yesterday, still in day mode.
    act(() => { fireEvent.click(getNextBtn()); });

    // Must still be in day mode (label ≠ "Today") because UTC yesterday < UTC today.
    expect(screen.queryByText("Today")).toBeNull();
    // The → button should still be enabled (not yet back to today).
    expect(getNextBtn().hasAttribute("disabled")).toBe(false);
  });
});

describe("(f) empty day response shows 'No sets that day' empty state", () => {
  it("renders the empty state when the day hook returns an empty array", () => {
    // Override the hook to return empty for day mode
    (useMyOverlapRunsFor as ReturnType<typeof vi.fn>).mockImplementation(
      (day: string | null, opts: { enabled?: boolean } = {}) => {
        const enabled = opts.enabled !== false;
        if (!enabled) return { data: [], isLoading: false };
        return { data: [], isLoading: false }; // empty for all modes
      },
    );

    mockDialDataSettled();
    renderDial();

    act(() => { fireEvent.click(getPrevBtn()); });

    expect(screen.getByText("No sets that day.")).toBeTruthy();
  });
});
