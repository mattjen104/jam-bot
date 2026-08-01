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
import { act, cleanup, render } from "@testing-library/react";

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
