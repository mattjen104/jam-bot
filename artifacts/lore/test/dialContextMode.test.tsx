// @vitest-environment jsdom
/**
 * DialView two-mode surface tests.
 *
 * Covers the context state machine wiring:
 *  - first click on a station row tunes AND plays, entering context mode
 *  - in context mode Zone 2/3 discovery bands are hidden and the former
 *    list area becomes the context region (breadcrumb + summary)
 *  - a scan landing on the sampled row is the same committing click
 *  - Back pops to dial mode; Dial returns to the list WITHOUT stopping audio
 *  - navigation (Back/Dial) never calls stop/toggle on the player
 *  - loading "/" with a ctx param restores context mode without starting
 *    playback; picking a different station resets the context
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

// Controllable player mock so tests can assert stop/toggle are (not) called.
const radioMock = {
  status: "idle" as string,
  station: null as { slug: string; name: string } | null,
  scanning: false,
  preview: vi.fn(),
  toggle: vi.fn(),
  stop: vi.fn(),
};

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      radio: radioMock,
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
import type { DialStation, DialShow } from "../src/hooks/useDialData";
import type { GhostStation } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Factories & helpers
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

/** Live Zone-1 station (r=2: artistCrossings > 0). */
function makeZone1Station(slug: string): DialStation {
  return {
    station: { slug, name: `Station ${slug}`, automationClass: null, streamUrl: "https://example.com/stream", websiteUrl: null, hidden: false, favorite: false } as DialStation["station"],
    isLive: true,
    shows: [makeShow({ artistCrossings: 1 })],
    crossings: 0,
    artistCrossings: 1,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
  };
}

/** Zone-2 ghost station with no qualifying replay run (runId null → tune path). */
function makeGhost(slug: string): GhostStation {
  return {
    stationId: 777,
    slug,
    name: `Ghost ${slug}`,
    streamUrl: "https://example.com/stream",
    streamFormat: "mp3",
    mode: "spinitron",
    attribution: true,
    artistName: "Ghost Artist",
    playedAt: null,
    day: "2026-08-06",
    showName: null,
    djName: null,
    runId: null,
  };
}

function mockGhosts(ghosts: GhostStation[]) {
  (useMyGhostMissed as ReturnType<typeof vi.fn>).mockReturnValue({ data: ghosts });
}

function mockDialData(stations: DialStation[], overrides: Record<string, unknown> = {}) {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations,
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: true,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
    ...overrides,
  });
}

function renderDial() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialView />
    </QueryClientProvider>,
  );
}

/**
 * Click a Zone-1 row to tune in.
 * Compact Feed rows use expand-then-keep: first click expands (reveals byline),
 * second click commits to tune-in. Both clicks are fired here so callers don't
 * need to know about the expand step.
 */
function clickRow(slug: string) {
  const row = Array.from(document.querySelectorAll(".fdrow")).find((el) =>
    el.textContent?.includes(slug));
  expect(row, `row for ${slug}`).toBeTruthy();
  fireEvent.click(row!); // expand
  fireEvent.click(row!); // tune in
}

function ctxParam(): string | null {
  return new URLSearchParams(window.location.search).get("ctx");
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  radioMock.status = "idle";
  radioMock.station = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

// Retired UI: front-door station and ghost row interaction specs were removed
// because Explore now tunes through cover rails and Scan.

describe("URL restore", () => {
  it("loading '/' with a ctx param restores context mode without starting playback", () => {
    window.history.replaceState(null, "", "/?ctx=station:kexp");
    mockDialData([makeZone1Station("kexp"), makeZone1Station("wfmu")]);
    renderDial();

    expect(document.querySelector(".dial-context-region")).toBeTruthy();
    // Breadcrumb shows the resolved station name.
    expect(screen.getByRole("navigation", { name: /breadcrumb/i }).textContent)
      .toContain("Station kexp");
    // Playback did NOT auto-resume.
    expect(radioMock.toggle).not.toHaveBeenCalled();
    expect(radioMock.preview).not.toHaveBeenCalled();
    // ctx param survives (kept in sync via replace).
    expect(ctxParam()).toBe("station:kexp");
  });

  it("renders the context region (and rail) while the crossings query is still loading", () => {
    // The tuned context must never wait on crossing scores: with the
    // crossings query in flight (zone1Settled false), a ctx-param restore
    // still mounts the region and the summary rail.
    window.history.replaceState(null, "", "/?ctx=station:kexp");
    mockDialData([makeZone1Station("kexp")], { crossingsLoading: true });
    renderDial();

    expect(document.querySelector(".dial-context-region")).toBeTruthy();
    expect(screen.getByTestId("context-rail")).toBeTruthy();
    // The loading placeholder never sits above the tuned context.
    expect(document.querySelector(".z1-placeholder")).toBeNull();
  });

  it("restores a station that is not currently on air (offline label fallback)", () => {
    window.history.replaceState(null, "", "/?ctx=station:gone");
    mockDialData([makeZone1Station("kexp")]);
    renderDial();
    // Context mode still renders, with the raw id as fallback label.
    expect(document.querySelector(".dial-context-region")).toBeTruthy();
    expect(radioMock.toggle).not.toHaveBeenCalled();
  });
});
