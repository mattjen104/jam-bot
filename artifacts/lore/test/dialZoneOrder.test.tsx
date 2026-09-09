// @vitest-environment jsdom
/**
 * Regression tests for the crossings-loading window.
 *
 * During crossingsLoading=true the dial suppresses all real station rows and
 * renders only the Zone 1 loading placeholder (Zone1Placeholder). No
 * FrontDoorRow (.fdrow) elements may appear until crossing scores resolve.
 *
 * Covers:
 *  1. The Zone 1 loading placeholder appears when crossingsLoading=true.
 *  2. No FrontDoorRow (.fdrow) elements exist while crossingsLoading=true.
 *  3. Once crossings resolve with an empty station list, no rows render.
 *
 * Note: the former Zone 3 DJ-band split specs were removed — the DialView
 * rework (Now/Explore/Library) retired the unified station row feed from the
 * front door, so there are no banded .fdrow rows left to assert on.
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
import { DialView } from "../src/components/DialView";

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
  try { localStorage.clear(); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dial front-door zone order — crossingsLoading=true", () => {
  beforeEach(() => {
    // The loading placeholder belongs to the crossings-on feed; radio mode
    // (crossings off) is the default now, so pin crossings on here.
    localStorage.setItem("lore:radioMode", "false");
  });

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
