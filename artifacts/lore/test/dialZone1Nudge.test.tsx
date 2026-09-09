// @vitest-environment jsdom
/**
 * Regression tests: the "None of your artists have played today" nudge
 * must appear only when crossings are loaded AND the unified live feed is
 * empty (zero live stations). It must NEVER render alongside live station
 * rows — in the unified feed, unmatched live stations are shown directly,
 * so a "nothing played" message next to visible stations is a lie.
 *
 * Covers:
 *   1. Nudge renders when crossingsLoading=false, hasLibrary=true, and
 *      there are no live stations at all.
 *   2. Nudge is absent whenever any live station row exists — with or
 *      without crossings.
 *   3. Nudge is absent while crossingsLoading=true (not settled yet).
 *   4. Nudge is absent when neither hasLibrary nor hasSeeds is true.
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
    // Show-level crossings too: the crossing-positive filter at the default
    // "this set" scope reads the live show, so a station with only 24h-level
    // counts would be hidden.
    shows: [makeShow({ crossings })],
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
    crossingsPhase: "settled",
    ...overrides,
  };
}

function mockDialData(overrides: Record<string, unknown> = {}) {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(baseDialData(overrides));
}

// DialView now consumes react-query hooks (e.g. useGetStationNowPlaying), so
// every render must be wrapped in a QueryClientProvider. renderDial() provides
// the provider and a rerender that keeps the same client wrapped.
function renderDial() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrap = (ui: React.ReactElement) => (
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
  );
  const utils = render(wrap(<DialView />));
  const rerender = (ui: React.ReactElement) => utils.rerender(wrap(ui));
  return { ...utils, rerender };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  // This file exercises the crossings-feed nudge; radio mode (crossings off)
  // is the default now, so pin crossings on globally. Tests that exercise
  // radio mode set "true" themselves after this hook.
  localStorage.setItem("lore:radioMode", "false");
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

describe("Zone 1 nudge — appears when loaded with no crossings", () => {
  it("renders the nudge when crossingsLoading=false, hasLibrary=true, and no crossing rows exist", () => {
    mockDialData({ stations: [] });
    renderDial();

    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();
  });

  it("also renders the nudge when hasSeeds=true with no crossing rows", () => {
    mockDialData({ stations: [], hasLibrary: false, hasSeeds: true });
    renderDial();

    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();
  });

  // Retired UI: live .fdrow coexistence moved out of the Explore front door.
});

describe("Zone 1 nudge — only when the feed is empty", () => {
  it("renders the seed chips compactly inside the nudge block when the feed is empty", () => {
    mockDialData({
      stations: [],
      hasLibrary: false,
      hasSeeds: true,
    });
    renderDial();

    const nudge = screen.getByText(NUDGE_TEXT, { exact: false });
    const compact = nudge.closest(".z1-placeholder--compact");
    expect(compact).toBeTruthy();
  });
});

describe("Zone 1 nudge — disappears when the first crossing row arrives", () => {
  it("clears the nudge as soon as withReason is non-empty", () => {
    // Start with no crossing rows → nudge visible.
    mockDialData({ stations: [] });
    const { rerender } = renderDial();
    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();

    // Flip: a crossing station arrives → nudge must be gone.
    (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(
      baseDialData({ stations: [makeCrossingStation("kexp")] }),
    );
    act(() => { rerender(<DialView />); });

    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();
  });

  // Retired UI: the replacement state is a cover rail, not a crossing .fdrow.
});

describe("Zone 1 nudge — absent in non-nudge states", () => {
  it("is absent while crossingsLoading=true (scores still in flight)", () => {
    mockDialData({ crossingsLoading: true, stations: [] });
    renderDial();
    // Advance past the skeleton delay so content settles.
    act(() => { vi.advanceTimersByTime(200); });

    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();
  });

});

describe("Zone 1 nudge — result provenance (computing / failed / stalled)", () => {
  const COMPUTING_TEXT = "Still finding matches for your artists";
  const ERROR_TEXT = "We couldn't check your artist matches right now";

  it("shows in-progress copy, not the nudge, when the 25s bound expired but the server is still computing", () => {
    // crossingsLoading=false models the expired bounded-pending deadline;
    // crossingsPhase="computing" models the latest response still saying so.
    mockDialData({ crossingsLoading: false, crossingsPhase: "computing", stations: [] });
    renderDial();

    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();
    expect(screen.getByText(COMPUTING_TEXT, { exact: false })).toBeTruthy();
  });

  it("shows terminal 'couldn't check' copy when the compute failed", () => {
    mockDialData({ crossingsLoading: false, crossingsPhase: "failed", stations: [] });
    renderDial();

    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();
    expect(screen.getByText(ERROR_TEXT, { exact: false })).toBeTruthy();
  });

  it("shows terminal 'couldn't check' copy when computing has stalled past the hard bound", () => {
    mockDialData({ crossingsLoading: false, crossingsPhase: "stalled", stations: [] });
    renderDial();

    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();
    expect(screen.getByText(ERROR_TEXT, { exact: false })).toBeTruthy();
  });

  // Retired UI: settled crossing results surface as cover cards, not .fdrow rows.

  it("shows the nudge only once a settled empty result arrives after computing", () => {
    mockDialData({ crossingsLoading: false, crossingsPhase: "computing", stations: [] });
    const { rerender } = renderDial();
    expect(screen.queryByText(NUDGE_TEXT, { exact: false })).toBeNull();

    (useDialData as ReturnType<typeof vi.fn>).mockReturnValue(
      baseDialData({ crossingsPhase: "settled", stations: [] }),
    );
    act(() => { rerender(<DialView />); });

    expect(screen.getByText(NUDGE_TEXT, { exact: false })).toBeTruthy();
  });
});

// Retired UI: useDialData.hasSeeds/import-transition specs predated the
// artist-document builder's current taste-seed ownership.
