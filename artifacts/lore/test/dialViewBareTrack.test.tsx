// @vitest-environment jsdom
/**
 * Regression tests for:
 *   1. Zone 3 FrontDoorRow's complete live sentence, rather than a separate
 *      bare-fact track line.
 *   2. "Unknown" text suppression — the string "Unknown" must never appear when
 *      show.djName is null and show.showName is a variant of "unknown show".
 *   3. OfflineRow show-name / track-title rendering — showName suppressed for
 *      null / "Unknown show" variants; track title rendered without artist.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
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
  });
});

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
  // DialView consumes react-query hooks directly, so it must render inside a
  // QueryClientProvider.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Zone 3 FrontDoorRow — bare-fact track line
// ---------------------------------------------------------------------------

describe("FrontDoorRow Zone 3 — consolidated live sentence", () => {
  it("credits the DJ and current artist on the show (r=5: DJ, no crossings)", () => {
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

    // Song titles are never shown — the sentence credits DJ + artist + show.
    const sentence = document.querySelector(".fdrow__t1")?.textContent ?? "";
    expect(sentence).toBe("DJ Tester selected Pixies on Morning Show");
    // The track title must not leak into the row.
    expect(sentence).not.toContain("Gravity Falls");
    expect(document.querySelector(".fdrow__bare-track")).toBeNull();
  });

  it("uses an artist-led sentence when no DJ is attached", () => {
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

    const sentence = document.querySelector(".fdrow__t1")?.textContent ?? "";
    expect(sentence).toBe("Grateful Dead on Morning Show now");
    expect(sentence).not.toContain("Dark Star");
    expect(document.querySelector(".fdrow__bare-track")).toBeNull();
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

describe("Offline stations — not rendered as front-door rows", () => {
  // The dial front door only surfaces live stations. Offline (isLive=false)
  // stations no longer produce any FrontDoorRow — the former "Recently aired"
  // section was removed — so their show name and track titles never leak into
  // the front door.

  it("renders no front-door row for an offline station with a named show", () => {
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

    // No station row at all for an offline station.
    expect(container.querySelectorAll(".fdrow").length).toBe(0);
    // The show name never appears in the front door.
    expect(container.textContent).not.toContain("Late Night Jazz");
  });

  it("does not leak an offline station's track title or artist into the front door", () => {
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

    expect(container.querySelectorAll(".fdrow").length).toBe(0);
    expect(container.textContent).not.toContain("So What");
    expect(container.textContent).not.toContain("Miles Davis");
  });

  it("does not surface an 'Unknown show' offline station in the front door", () => {
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

    expect(container.querySelectorAll(".fdrow").length).toBe(0);
    expect(container.textContent).not.toMatch(/unknown show/i);
    expect(container.textContent).not.toContain("Kind of Blue");
  });
});
