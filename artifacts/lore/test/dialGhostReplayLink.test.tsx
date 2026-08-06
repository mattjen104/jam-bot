// @vitest-environment jsdom
/**
 * Zone 2 ghost row replay navigation tests.
 *
 * Covers:
 *  a. Ghost row with runId present → click navigates to /replay/{runId}, not goStation
 *  b. Ghost row with runId null → click calls goStation(slug), copy contains no replay affordance
 *  c. djName suppressed by attribution guard (djName: null) does not appear in rendered copy
 *  d. Existing Zone 2 ZONE2_VISIBLE=3 truncation still passes
 *  e. zone2Expanded behaviour still passes (See all N / See less)
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/", mockNavigate],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal);
});

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
import { useMyGhostMissed } from "../src/lib/meHooks";
import { DialView } from "../src/components/DialView";
import type { GhostStation } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeGhostWithReplay(slug: string, runId: number, showName = "Morning Sounds"): GhostStation {
  return {
    stationId: 1001,
    slug,
    name: `Station ${slug}`,
    streamUrl: "http://example.invalid/stream",
    streamFormat: "aac",
    mode: "live",
    attribution: true,
    artistName: "Library Artist",
    playedAt: new Date(Date.now() - 45 * 60_000).toISOString(), // 45 min ago
    day: "2026-08-06",
    showName,
    djName: null,
    runId,
  };
}

function makeGhostNoRun(slug: string): GhostStation {
  return {
    stationId: 1002,
    slug,
    name: `Station ${slug}`,
    streamUrl: "http://example.invalid/stream",
    streamFormat: "aac",
    mode: "live",
    attribution: true,
    artistName: "Other Artist",
    playedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    day: "2026-08-06",
    showName: null,
    djName: null,
    runId: null,
  };
}

function mockEmptyDialData() {
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

function mockGhosts(ghosts: GhostStation[]) {
  (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({ data: ghosts });
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  mockNavigate.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GhostRow — runId present: navigate to /replay/{runId}", () => {
  it("clicking a ghost row with runId navigates to /replay/{runId}, not goStation", () => {
    mockEmptyDialData();
    const runId = 42_000;
    mockGhosts([makeGhostWithReplay("wfmu", runId)]);

    render(<DialView />);

    // Find the ghost row and click it.
    const ghostRows = document.querySelectorAll(".ghost-row");
    expect(ghostRows.length).toBeGreaterThanOrEqual(1);
    act(() => { fireEvent.click(ghostRows[0]!); });

    // Should navigate to the replay route, not call setLevel/goStation (which
    // stays within DialView). mockNavigate is wouter's setLocation.
    expect(mockNavigate).toHaveBeenCalledWith(`/replay/${runId}`);
  });

  it("copy contains '{showName} played {artistName}' and relative time when runId is present", () => {
    mockEmptyDialData();
    mockGhosts([makeGhostWithReplay("wfmu", 99, "Morning Sounds")]);

    render(<DialView />);

    const ghostRow = document.querySelector(".ghost-row");
    expect(ghostRow).not.toBeNull();
    const text = ghostRow!.textContent ?? "";
    // Copy must include showName + "played" + artistName.
    expect(text).toContain("Morning Sounds");
    expect(text).toContain("played");
    expect(text).toContain("Library Artist");
    // Relative time — "ago" or "now" somewhere in the copy.
    expect(text).toMatch(/ago|now/);
  });

  it("copy does NOT contain 'N missed' or streak framing when runId is present", () => {
    mockEmptyDialData();
    mockGhosts([makeGhostWithReplay("wfmu", 77)]);

    render(<DialView />);

    const ghostRow = document.querySelector(".ghost-row");
    const text = ghostRow?.textContent ?? "";
    expect(text).not.toMatch(/missed/i);
    expect(text).not.toMatch(/\d+ in a row/i);
  });

  it("falls back to station name when showName is null but runId is present", () => {
    const ghost: GhostStation = {
      stationId: 1003,
      slug: "kexp",
      name: "KEXP 90.3",
      streamUrl: "",
      streamFormat: "aac",
      mode: "live",
      attribution: true,
      artistName: "Some Band",
      playedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      day: "2026-08-06",
      showName: null,
      djName: null,
      runId: 555,
    };
    mockEmptyDialData();
    mockGhosts([ghost]);

    render(<DialView />);

    const ghostRow = document.querySelector(".ghost-row");
    const text = ghostRow?.textContent ?? "";
    // Falls back to station name.
    expect(text).toContain("KEXP 90.3");
    expect(text).toContain("played");
    expect(text).toContain("Some Band");
  });
});

describe("GhostRow — runId null: call goStation, no replay affordance", () => {
  it("clicking a ghost row with runId null calls goStation (stays in DialView), not navigate", () => {
    mockEmptyDialData();
    mockGhosts([makeGhostNoRun("kcrw")]);

    render(<DialView />);

    const ghostRows = document.querySelectorAll(".ghost-row");
    expect(ghostRows.length).toBeGreaterThanOrEqual(1);
    act(() => { fireEvent.click(ghostRows[0]!); });

    // mockNavigate (wouter setLocation) should NOT have been called with a
    // /replay path. DialView's internal goStation updates React state without
    // calling setLocation, so mockNavigate stays uncalled.
    const replayCalls = mockNavigate.mock.calls.filter(([path]: [string]) =>
      typeof path === "string" && path.startsWith("/replay/"),
    );
    expect(replayCalls).toHaveLength(0);
  });

  it("copy for runId null does not contain 'played' or relative time", () => {
    mockEmptyDialData();
    mockGhosts([makeGhostNoRun("kcrw")]);

    render(<DialView />);

    const ghostRow = document.querySelector(".ghost-row");
    const text = ghostRow?.textContent ?? "";
    // The simple copy is just the artist name, no "played" keyword.
    expect(text).toContain("Other Artist");
    // No 'played' copy when runId is absent.
    expect(text).not.toContain("played");
  });
});

describe("GhostRow — djName suppressed by attribution guard", () => {
  it("djName: null does not appear in ghost row copy even when showName is present", () => {
    // The attribution guard set djName: null server-side; the client should
    // never render any DJ-name content in the row copy.
    const ghost: GhostStation = {
      stationId: 1004,
      slug: "kpfk",
      name: "KPFK",
      streamUrl: "",
      streamFormat: "aac",
      mode: "live",
      attribution: true,
      artistName: "Jazz Artist",
      playedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      day: "2026-08-06",
      showName: "Morning Jazz",
      djName: null, // suppressed by eligibleDjName
      runId: 123,
    };
    mockEmptyDialData();
    mockGhosts([ghost]);

    render(<DialView />);

    const ghostRow = document.querySelector(".ghost-row");
    const text = ghostRow?.textContent ?? "";
    // showName appears; station name and artist appear; but no raw dj_name.
    expect(text).toContain("Morning Jazz");
    expect(text).toContain("Jazz Artist");
    // djName was null → nothing DJ-specific in copy.
    // The copy template is "{showName ?? name} played {artistName} · {time}"
    // so there's no place for djName anyway, but this pins the contract.
    expect(text).not.toContain("with ");
  });
});

describe("Zone 2 ZONE2_VISIBLE truncation — unchanged behaviour", () => {
  it("Zone 2 with 7 ghosts (all runId null) renders 3 ghost rows; See all 7 present", () => {
    mockEmptyDialData();
    const ghosts = Array.from({ length: 7 }, (_, i) => makeGhostNoRun(`g${i}`));
    mockGhosts(ghosts);

    render(<DialView />);

    expect(document.querySelectorAll(".ghost-row").length).toBe(3);
    expect(screen.getByRole("button", { name: "See all 7" })).toBeTruthy();
  });

  it("clicking 'See all 7' expands all ghost rows and shows See less", () => {
    mockEmptyDialData();
    const ghosts = Array.from({ length: 7 }, (_, i) => makeGhostNoRun(`g${i}`));
    mockGhosts(ghosts);

    render(<DialView />);

    act(() => { fireEvent.click(screen.getByRole("button", { name: "See all 7" })); });

    expect(document.querySelectorAll(".ghost-row").length).toBe(7);
    const lessBtns = screen.getAllByRole("button", { name: "See less" });
    expect(lessBtns.length).toBeGreaterThanOrEqual(1);
  });
});
