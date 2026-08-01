// @vitest-environment jsdom
/**
 * Regression tests for:
 *   1. Zone 3 FrontDoorRow bare-fact track line — title only, no artist suffix,
 *      no em-dash.
 *   2. "Unknown" text suppression — the string "Unknown" must never appear when
 *      show.djName is null and show.showName is a variant of "unknown show".
 *   3. OfflineRow show-name / track-title rendering — showName suppressed for
 *      null / "Unknown show" variants; track title rendered without artist.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/lore/", vi.fn()],
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
  });
});

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: vi.fn(() => ({
    radio: {
      preview: vi.fn(),
      tuneIn: vi.fn(),
      stop: vi.fn(),
      active: null,
    },
    ride: { active: false },
    spotify: { configured: false, connected: false },
    scan: {},
  })),
}));

// Stub out heavy sub-components that are not under test.
vi.mock("../src/components/StationLane", () => ({
  StationLane: () => <div data-testid="station-lane" />,
}));
vi.mock("../src/components/ContextRail", () => ({
  ContextRail: () => <div data-testid="context-rail" />,
}));
vi.mock("../src/components/SearchOverlay", () => ({
  SearchOverlay: () => null,
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { useDialData } from "../src/hooks/useDialData";
import { DialView } from "../src/components/DialView";
import type { DialStation, DialShow, DialSpin } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: null,
    artistMbid: null,
    title: "Some Track Title",
    artist: "Some Artist Name",
    playedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    ...overrides,
  };
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Morning Show",
    djName: "DJ Tester",
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

function makeStation(overrides: Partial<DialStation> = {}): DialStation {
  return {
    station: {
      slug: "test-station",
      name: "Test Radio",
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
    ...overrides,
  };
}

function mockDialData(stations: DialStation[]) {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations,
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Zone 3 FrontDoorRow — bare-fact track line
// ---------------------------------------------------------------------------

describe("FrontDoorRow Zone 3 — bare-fact track line", () => {
  it("renders the track title without an em-dash or artist suffix (r=5: djName set, no crossings)", () => {
    // r=5: show has djName but no crossings → Zone 3 bare-fact row
    const track = makeSpin({ title: "Gravity Falls", artist: "Pixies" });
    const show = makeShow({
      djName: "DJ Tester",
      crossings: 0,
      artistCrossings: 0,
      currentTrack: track,
    });
    const station = makeStation({ isLive: true, shows: [show] });

    mockDialData([station]);
    renderDial();

    // The bare-fact div should contain the title
    const bareTrackEls = document.querySelectorAll(".fdrow__bare-track");
    expect(bareTrackEls.length).toBeGreaterThan(0);
    const bareText = bareTrackEls[0].textContent ?? "";
    expect(bareText).toContain("Gravity Falls");

    // Must NOT contain artist name with an em-dash or plain concatenation
    expect(bareText).not.toMatch(/Pixies\s*[—–-]/);
    expect(bareText).not.toMatch(/[—–-]\s*Pixies/);
    expect(bareText).not.toContain("Pixies");
  });

  it("renders the track title without artist when r=0 (no show data, no crossings)", () => {
    // r=0: station has no live show at all
    const station = makeStation({ isLive: true, shows: [] });
    // Manually inject a now-playing track via station data that forces r=0 path:
    // FrontDoorRow is called with show=null in r=0 — currentTrack comes from show.
    // In this case show is null so showBareTrack will be false; simulate r=0 by
    // giving station a show with no djName and no crossings.
    const track = makeSpin({ title: "Dark Star", artist: "Grateful Dead" });
    const show0 = makeShow({
      djName: null,
      crossings: 0,
      artistCrossings: 0,
      currentTrack: track,
    });
    const stationR0 = makeStation({ isLive: true, shows: [show0] });

    mockDialData([stationR0]);
    renderDial();

    const bareTrackEls = document.querySelectorAll(".fdrow__bare-track");
    expect(bareTrackEls.length).toBeGreaterThan(0);
    const bareText = bareTrackEls[0].textContent ?? "";
    expect(bareText).toContain("Dark Star");
    // No artist name, no dash
    expect(bareText).not.toMatch(/Grateful Dead/);
    expect(bareText).not.toMatch(/[—–]/);
  });

  it("does NOT render bare-fact track for Zone 1 rows (r=1: isLibraryHit)", () => {
    // r=1: exact library hit — reason already mentions the title; bare track
    // must not be rendered (showBareTrack is false for r=1..4).
    const track = makeSpin({ title: "Library Hit Song", artist: "Library Artist", isLibraryHit: true });
    const show = makeShow({ currentTrack: track, crossings: 1, topArtists: ["Library Artist"] });
    const station = makeStation({ isLive: true, shows: [show], crossings: 1 });

    mockDialData([station]);
    renderDial();

    const bareTrackEls = document.querySelectorAll(".fdrow__bare-track");
    expect(bareTrackEls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. "Unknown" text suppression
// ---------------------------------------------------------------------------

describe("FrontDoorRow — 'Unknown' text suppression", () => {
  const unknownVariants = ["unknown show", "Unknown Show", "UNKNOWN SHOW", "Unknown show"];

  unknownVariants.forEach((variant) => {
    it(`suppresses showName '${variant}' — no 'Unknown' in rendered output`, () => {
      const show = makeShow({
        djName: null,
        showName: variant,
        crossings: 0,
        artistCrossings: 0,
        currentTrack: null,
      });
      const station = makeStation({ isLive: true, shows: [show] });
      mockDialData([station]);

      const { container } = renderDial();

      // The entire dial page must not contain the word "Unknown" anywhere
      // (case-sensitive check matching the suppression spec).
      expect(container.textContent).not.toMatch(/\bUnknown\b/);
    });
  });

  it("suppresses 'Unknown' when djName is null even with a valid showName", () => {
    const show = makeShow({
      djName: null,
      showName: "Jazz Hour",
      crossings: 0,
      artistCrossings: 0,
      currentTrack: null,
    });
    const station = makeStation({ isLive: true, shows: [show] });
    mockDialData([station]);

    const { container } = renderDial();
    expect(container.textContent).not.toMatch(/\bUnknown\b/);
  });

  it("never renders 'Unknown' even when all nullable show fields are null", () => {
    const show = makeShow({
      djName: null,
      showName: "unknown show",
      crossings: 0,
      artistCrossings: 0,
      currentTrack: null,
    });
    const station = makeStation({ isLive: true, shows: [show] });
    mockDialData([station]);

    const { container } = renderDial();
    expect(container.textContent).not.toMatch(/\bUnknown\b/);
    expect(container.textContent).not.toMatch(/unknown show/i);
  });
});

// ---------------------------------------------------------------------------
// 3. OfflineRow — showName and track-title rendering
// ---------------------------------------------------------------------------

describe("OfflineRow — show-name and track-title rendering", () => {
  // OfflineRow appears in the "Recently aired" section, which requires
  // isLive=false on the station.

  it("shows the showName label when showName is a real value", () => {
    const spin = makeSpin({ title: "Blue in Green", artist: "Miles Davis" });
    const show = makeShow({
      showName: "Late Night Jazz",
      djName: null,
      state: "past",
      spins: [spin],
      currentTrack: null,
    });
    const station = makeStation({ isLive: false, shows: [show], crossings: 0 });
    mockDialData([station]);

    const { container } = renderDial();

    // Show name appears inside the tier-3 destination label (e.g. "Late Night Jazz · Test Radio")
    const t3El = container.querySelector(".fdrow__t3");
    expect(t3El).not.toBeNull();
    expect(t3El!.textContent).toContain("Late Night Jazz");
  });

  it("does NOT show the showName label when showName is 'Unknown show'", () => {
    const spin = makeSpin({ title: "Blue in Green", artist: "Miles Davis" });
    const show = makeShow({
      showName: "Unknown show",
      djName: null,
      state: "past",
      spins: [spin],
      currentTrack: null,
    });
    const station = makeStation({ isLive: false, shows: [show], crossings: 0 });
    mockDialData([station]);

    const { container } = renderDial();

    // "Unknown show" must not appear at all
    expect(container.textContent).not.toMatch(/Unknown show/i);
  });

  it("does NOT show the showName label when showName is null", () => {
    const spin = makeSpin({ title: "Autumn Leaves", artist: "Bill Evans" });
    const show = makeShow({
      showName: "Unnamed Session",  // We'll override to null via cast
      djName: null,
      state: "past",
      spins: [spin],
      currentTrack: null,
    });
    // Force showName to null
    (show as unknown as Record<string, unknown>).showName = null as unknown as string;
    const station = makeStation({ isLive: false, shows: [show], crossings: 0 });
    mockDialData([station]);

    const { container } = renderDial();

    // No showName label rendered — only station name + track title
    const offlineInfo = container.querySelector(".dial-stn-now");
    expect(offlineInfo).toBeNull();
  });

  it("renders track title WITHOUT artist in the offline track line", () => {
    const spin = makeSpin({ title: "So What", artist: "Miles Davis" });
    const show = makeShow({
      showName: "Jazz at Midnight",
      djName: null,
      state: "past",
      spins: [spin],
      currentTrack: null,
    });
    const station = makeStation({ isLive: false, shows: [show], crossings: 0 });
    mockDialData([station]);

    const { container } = renderDial();

    // Tier-1 reason element holds the bare track title when there are no crossings
    const trackEl = container.querySelector(".fdrow__t1");
    expect(trackEl).not.toBeNull();
    const trackText = trackEl!.textContent ?? "";
    expect(trackText).toContain("So What");
    // No artist name or em-dash in the reason element
    expect(trackText).not.toContain("Miles Davis");
    expect(trackText).not.toMatch(/[—–]/);
  });

  it("renders track title WITHOUT em-dash artist for 'Unknown show' variant", () => {
    const spin = makeSpin({ title: "Kind of Blue", artist: "Miles Davis" });
    const show = makeShow({
      showName: "unknown show",
      djName: null,
      state: "past",
      spins: [spin],
      currentTrack: null,
    });
    const station = makeStation({ isLive: false, shows: [show], crossings: 0 });
    mockDialData([station]);

    const { container } = renderDial();

    // Tier-1 reason element holds the bare track title when there are no crossings
    const trackEl = container.querySelector(".fdrow__t1");
    expect(trackEl).not.toBeNull();
    const trackText = trackEl!.textContent ?? "";
    expect(trackText).toContain("Kind of Blue");
    expect(trackText).not.toContain("Miles Davis");
    expect(trackText).not.toMatch(/[—–]/);
  });
});
