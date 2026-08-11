// @vitest-environment jsdom
/**
 * Simplified Dial — time-travel controls are retired from the front door.
 *
 * The set/queue panel that hosted the run-navigation arrows ("Back in time —
 * previous run" / "Forward in time — next run"), the Tune control, and the
 * pinned station overlay were all removed. Station rows are the only
 * interaction: clicking one starts playback.
 *
 * This suite pins that removal:
 *  (a) no run-navigation arrows or set-panel chrome render on the front door
 *  (b) the coarse-scan data hook still fetches with the default 2-day window
 *      (the read-model is unchanged; only the front-door controls are gone)
 *  (c) the live front door keeps its station rows — no past-scan UI leaks in
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyOverlapRunsRecent: vi.fn(() => ({ data: mockRecentRuns, isLoading: false })),
    useMyRunCrossings: vi.fn(() => ({ data: [], isLoading: false })),
    useMyOverlapRunsFor: vi.fn(() => ({ data: [], isLoading: false })),
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
      ride: { active: false, startReplay: vi.fn(), stop: vi.fn() },
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
import { useMyOverlapRunsRecent } from "../src/lib/meHooks";
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
    stationsError: false,
    refetchStations: vi.fn(),
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

describe("(a) run-navigation controls are retired from the front door", () => {
  it("keeps the front door focused on the dial without section navigation buttons", () => {
    mockDialDataSettled();
    renderDial();

    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lore" })).toBeNull();
    expect(screen.queryByRole("button", { name: "My Library" })).toBeNull();
  });

  it("renders no time-travel arrows, Tune control, or set-panel chrome", () => {
    mockDialDataSettled();
    renderDial();

    expect(screen.queryByRole("button", { name: "Back in time — previous run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Forward in time — next run" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Tune$/ })).toBeNull();
    expect(document.querySelector(".dial-hero__setpanel")).toBeNull();
    expect(document.querySelector(".dial-hero__setpanel-title")).toBeNull();
    expect(document.querySelector(".dial-pinned-row")).toBeNull();
  });

  it("shows no past-scan UI (crossing rows, density spine) on the live front door", () => {
    mockDialDataSettled();
    renderDial();

    expect(document.querySelector(".dial-past-crossings")).toBeNull();
    expect(document.querySelector('[data-spine="true"]')).toBeNull();
    expect(document.querySelector("[data-crossing-index]")).toBeNull();
  });
});

describe("(b) coarse scan window defaults to 2 days", () => {
  it("fetches the recent runs with the default 2-day window", () => {
    // The range pills (2d/1w/1m) and the arrow controls were removed from the
    // dial flow. The read-model still fetches the default 2-day coarse-scan
    // window, driven by useMyOverlapRunsRecent({ days: 2 }).
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
