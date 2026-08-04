// @vitest-environment jsdom
/**
 * Regression tests: the Zone 1 "None of your artists have played today" nudge
 * must appear when crossings are loaded and withReason is empty, and must
 * disappear the moment the first crossing row arrives.
 *
 * Covers:
 *   1. Nudge renders when crossingsLoading=false, hasLibrary=true, and
 *      withReason is empty (no station-level or show-level crossings).
 *   2. Nudge is absent once withReason becomes non-empty (a station with a
 *      crossing score arrives).
 *   3. Nudge is absent while crossingsLoading=true (not settled yet).
 *   4. Nudge is absent when neither hasLibrary nor hasSeeds is true.
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
    useSpotifyLibraryConnected: vi.fn(() => false),
    startSpotifyLibraryConnect: vi.fn(),
    useMyTasteSeeds: vi.fn(() => ({ data: [] })),
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

vi.mock("../src/hooks/useStationPresence", () => ({
  useStationPresence: vi.fn(() => new Map()),
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
import { DialView } from "../src/components/DialView";
import type { DialStation, DialShow } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NUDGE_TEXT = "None of your artists have played on a live station today";

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

/** A live station with no crossings — will not appear in withReason. */
function makeNoCrossStation(slug: string): DialStation {
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
    shows: [makeShow()],
    crossings: 0,
    artistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    topArtistNames: [],
  };
}

/**
 * A live station with station-level crossings (r=6) — qualifies for withReason
 * and therefore Zone 1.
 */
function makeCrossingStation(slug: string, crossings = 3): DialStation {
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
    shows: [makeShow()],
    crossings,
    artistCrossings: 0,
    lifetimeCrossings: crossings,
    lifetimeArtistCrossings: 0,
    topArtistNames: ["Artist A"],
  };
}

/** Base return value shared across cases — crossings settled, library present. */
function baseDialData(overrides: Record<string, unknown> = {}) {
  return {
    stations: [],
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: true,
    hasSeeds: false,
    liveArtistSuggestions: [],
    onboardingArtists: [],
    onboardingArtistsLoading: false,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
    crossingSourceMode: "personal",
    crossingError: null,
    ...overrides,
  };
}

function mockDialData(overrides: Record<string, unknown> = {}) {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(baseDialData(overrides));
}

// ---------------------------------------------------------------------------
// Setup / teardown
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

describe("Zone 1 nudge — appears when loaded with no crossings", () => {
  it("renders the nudge when crossingsLoading=false, hasLibrary=true, and no crossing rows exist", () => {
    mockDialData({ stations: [] });
    render(<DialView />);

    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();
  });

  it("also renders the nudge when hasSeeds=true with no crossing rows", () => {
    mockDialData({ stations: [], hasLibrary: false, hasSeeds: true });
    render(<DialView />);

    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();
  });

  it("renders the nudge even when live stations exist but none have crossings", () => {
    mockDialData({ stations: [makeNoCrossStation("kexp"), makeNoCrossStation("wfmu")] });
    render(<DialView />);

    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();
  });
});

describe("Zone 1 nudge — disappears when the first crossing row arrives", () => {
  it("clears the nudge as soon as withReason is non-empty", () => {
    // Start with no crossing rows → nudge visible.
    mockDialData({ stations: [] });
    const { rerender } = render(<DialView />);
    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();

    // Flip: a crossing station arrives → nudge must be gone.
    (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(
      baseDialData({ stations: [makeCrossingStation("kexp")] }),
    );
    act(() => { rerender(<DialView />); });

    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();
  });

  it("crossing rows are rendered after the nudge clears", () => {
    mockDialData({ stations: [] });
    const { rerender } = render(<DialView />);

    (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(
      baseDialData({ stations: [makeCrossingStation("kexp")] }),
    );
    act(() => { rerender(<DialView />); });

    // FrontDoorRow elements must now be present (base class .fdrow covers all
    // crossing rows regardless of their zone-class variant).
    const zone1Rows = document.querySelectorAll(".fdrow");
    expect(zone1Rows.length).toBeGreaterThan(0);
  });
});

describe("Zone 1 nudge — absent in non-nudge states", () => {
  it("is absent while crossingsLoading=true (scores still in flight)", () => {
    mockDialData({ crossingsLoading: true, stations: [] });
    render(<DialView />);
    // Advance past the skeleton delay so content settles.
    act(() => { vi.advanceTimersByTime(200); });

    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();
  });

  it("is absent when neither hasLibrary nor hasSeeds is true", () => {
    mockDialData({ hasLibrary: false, hasSeeds: false, stations: [] });
    render(<DialView />);

    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();
  });
});

describe("Zone 1 nudge — seed-change transitions mid-session (no page reload)", () => {
  it("appears when hasSeeds flips true mid-session with no crossings", () => {
    // Start: no library, no seeds → nudge must NOT be visible.
    mockDialData({ hasLibrary: false, hasSeeds: false, stations: [] });
    const { rerender } = render(<DialView />);
    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();

    // Mid-session: user adds a taste seed → hasSeeds becomes true, still no crossings.
    (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(
      baseDialData({ hasLibrary: false, hasSeeds: true, stations: [] }),
    );
    act(() => { rerender(<DialView />); });

    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();
  });

  it("hides when all seeds are removed even with no crossings", () => {
    // Start: seeds present, no crossings → nudge visible.
    mockDialData({ hasLibrary: false, hasSeeds: true, stations: [] });
    const { rerender } = render(<DialView />);
    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();

    // Mid-session: user removes all seeds → hasSeeds flips false, still no crossings.
    (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(
      baseDialData({ hasLibrary: false, hasSeeds: false, stations: [] }),
    );
    act(() => { rerender(<DialView />); });

    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();
  });
});

describe("Zone 1 nudge — library import completes mid-session (no page reload)", () => {
  it("stays hidden while crossings are still loading after hasLibrary flips true", () => {
    // Phase 1: no library, no seeds → nudge absent.
    mockDialData({ hasLibrary: false, hasSeeds: false, stations: [] });
    const { rerender } = render(<DialView />);
    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();

    // Phase 2: import finishes → hasLibrary flips true, but crossings are still
    // in flight (crossingsLoading=true).  The nudge must stay hidden — showing it
    // here would be a false "no artists played today" while data is loading.
    (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(
      baseDialData({ hasLibrary: true, crossingsLoading: true, stations: [] }),
    );
    act(() => { rerender(<DialView />); });
    // Advance past the skeleton delay to ensure any deferred show logic has run.
    act(() => { vi.advanceTimersByTime(200); });

    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();
  });

  it("shows the nudge once crossings settle with no results after a library import", () => {
    // Phase 1: no library, no seeds → nudge absent.
    mockDialData({ hasLibrary: false, hasSeeds: false, stations: [] });
    const { rerender } = render(<DialView />);
    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();

    // Phase 2: hasLibrary flips true, crossings still loading → still hidden.
    (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(
      baseDialData({ hasLibrary: true, crossingsLoading: true, stations: [] }),
    );
    act(() => { rerender(<DialView />); });
    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();

    // Phase 3: crossings finish loading, no crossing rows exist → nudge appears.
    (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(
      baseDialData({ hasLibrary: true, crossingsLoading: false, stations: [] }),
    );
    act(() => { rerender(<DialView />); });

    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();
  });
});
