// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("wouter", () => ({
  useLocation: () => ["/lore/", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("../src/hooks/useDialData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hooks/useDialData")>();
  return { ...actual, useDialData: vi.fn() };
});

const { tasteSeeds, mutateAsync, mattStarter, startMattLibrary } = vi.hoisted(() => ({
  tasteSeeds: vi.fn(() => ({ data: [] as string[] })),
  mutateAsync: vi.fn(async (artists: string[]) => ({ artists })),
  mattStarter: vi.fn(() => ({ data: { available: false, addedCount: 0, totalCount: 0 } })),
  startMattLibrary: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyTasteSeeds: tasteSeeds,
    useSetTasteSeeds: vi.fn(() => ({ mutateAsync })),
    useMyGhostMissed: vi.fn(() => ({ data: [] })),
    useSpotifyLibraryConnected: vi.fn(() => false),
    useMattStarterLibrary: mattStarter,
    useStartMattLibrary: startMattLibrary,
  });
});

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      radio: { station: null, status: "idle", toggle: vi.fn(), preview: vi.fn(), stop: vi.fn() },
      ride: { active: false },
      spotify: { connected: false, premium: false },
      scan: {
        active: false,
        samplingIdx: null,
        scanning: false,
        toggle: vi.fn(),
        back: vi.fn(),
        next: vi.fn(),
        land: vi.fn(),
        adjustDwell: vi.fn(),
        stop: vi.fn(),
      },
    })),
  });
});

vi.mock("../src/components/StationLane", () => ({ StationLane: () => null }));
vi.mock("../src/components/ContextRail", () => ({ ContextRail: () => null }));
vi.mock("../src/components/SearchOverlay", () => ({ SearchOverlay: () => null }));
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

import {
  useDialData,
  extractLiveArtistSuggestions,
  mergeOnboardingArtists,
  splitIcyCombinedField,
  type DialStation,
} from "../src/hooks/useDialData";
import { DialView, LiveArtistPicker } from "../src/components/DialView";
import { ME_DIAL_CROSSINGS_KEY, ME_PICKER_NAMES_KEY } from "../src/lib/meHooks";

function makeStation(overrides: Partial<DialStation> = {}): DialStation {
  return {
    station: {
      slug: "wfmu",
      name: "WFMU",
      automationClass: null,
      streamUrl: null,
      websiteUrl: null,
      hidden: false,
      favorite: false,
    } as DialStation["station"],
    isLive: true,
    shows: [],
    liveTrack: {
      mbid: null,
      artistMbid: null,
      title: "A Current Song",
      artist: "Current Artist",
      playedAt: new Date().toISOString(),
      isLibraryHit: false,
      isArtistHit: false,
      isFirstSpin: false,
    },
    crossings: 0,
    artistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    ...overrides,
  };
}

function mockDial(stations: DialStation[] = [], suggestions = []) {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations,
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: false,
    hasSeeds: false,
    liveArtistSuggestions: suggestions,
    onboardingArtists: [],
    onboardingArtistsLoading: false,
    overlapByPickerId: new Map(),
    pickerNameToId: new Map(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  tasteSeeds.mockReturnValue({ data: [] });
  mutateAsync.mockImplementation(async (artists: string[]) => ({ artists }));
  mattStarter.mockReturnValue({ data: { available: false, addedCount: 0, totalCount: 0 } });
  startMattLibrary.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
});

describe("extractLiveArtistSuggestions", () => {
  it("uses live now-playing tracks even when schedule data is unavailable", () => {
    const suggestions = extractLiveArtistSuggestions([
      makeStation({ liveTrack: { ...makeStation().liveTrack!, artist: "  Current   Artist " } }),
    ]);
    expect(suggestions).toEqual([
      expect.objectContaining({ artist: "Current Artist", stationName: "WFMU" }),
    ]);
  });

  it("deduplicates artists case-insensitively, filters placeholders, and keeps context", () => {
    const first = makeStation({
      liveTrack: { ...makeStation().liveTrack!, artist: "The Artist", title: "First Track" },
      shows: [{
        runId: 1, showName: "Morning Show", djName: null,
        startedAt: "", endedAt: "", state: "live", spins: [], crossings: 0,
        artistCrossings: 0, topArtists: [], topArtistNames: [], currentTrack: null,
        isPickerShow: false, pickerId: null,
      }],
    });
    const duplicate = makeStation({
      station: { ...first.station, slug: "kcrw", name: "KCRW" },
      liveTrack: { ...makeStation().liveTrack!, artist: "the artist" },
    });
    const placeholder = makeStation({
      station: { ...first.station, slug: "bad", name: "Bad Radio" },
      liveTrack: { ...makeStation().liveTrack!, artist: "Unknown Artist" },
    });

    expect(extractLiveArtistSuggestions([first, duplicate, placeholder])).toEqual([
      expect.objectContaining({
        artist: "The Artist",
        stationName: "WFMU",
        trackTitle: "First Track",
        showName: "Morning Show",
      }),
    ]);
  });

  // ── Real-world station metadata edge cases ──────────────────────────────

  describe("non-musical and malformed artist values are filtered out", () => {
    function stationWithArtist(artist: string, slug = "s1"): DialStation {
      return makeStation({
        station: { ...makeStation().station, slug, name: "Test FM" },
        liveTrack: { ...makeStation().liveTrack!, artist },
      });
    }

    const NON_MUSICAL_CASES: Array<[string, string]> = [
      // Programming labels
      ["Commercial", "commercial break segment"],
      ["commercial break", "commercial break long form"],
      ["Advertisement", "advertisement label"],
      ["Ads", "ads short form"],
      ["Break", "break label"],
      ["Station Break", "station break"],
      ["News", "news segment"],
      ["News Break", "news break"],
      ["Weather", "weather segment"],
      ["Traffic", "traffic report"],
      ["ID", "station id short"],
      ["Station ID", "station id full"],
      ["Legal ID", "legal id"],
      ["Liner", "liner note label"],
      ["Sweeper", "sweeper segment"],
      ["Jingle", "jingle label"],
      ["Bumper", "bumper label"],
      ["Promo", "promo short"],
      ["Promotion", "promotion full"],
      ["Spot", "spot label"],
      ["Intermission", "intermission"],
      ["Off Air", "off air"],
      ["off-air", "off-air hyphenated"],
      ["Sign Off", "sign off"],
      ["Automation", "automation label"],
      ["Music", "generic music filler"],
      ["Live", "live filler"],
      ["Now Playing", "now playing filler"],
      ["Loading", "loading state"],
      ["TBA", "tba abbreviation"],
      ["TBD", "tbd abbreviation"],
      // Generic unknowns (original set, case variations)
      ["UNKNOWN", "unknown upper"],
      ["Various Artists", "various artists"],
      ["N/A", "n/a upper"],
      ["None", "none title-case"],
      ["NULL", "null upper"],
      ["Undefined", "undefined title-case"],
      ["Continuous", "continuous"],
      // Pure-punctuation / no-letter strings
      ["---", "dashes only"],
      ["...", "dots only"],
      ["- -", "spaced dashes"],
      ["***", "asterisks only"],
      ["????", "question marks only"],
      // Pure digits
      ["12345", "numeric only"],
      ["001", "padded number"],
      // Audio filenames
      ["jingle_01.mp3", "mp3 filename"],
      ["track 01.wav", "wav filename"],
      ["news_break.ogg", "ogg filename"],
      ["id.flac", "flac filename"],
    ];

    it.each(NON_MUSICAL_CASES)("filters %s (%s)", (artist) => {
      const result = extractLiveArtistSuggestions([stationWithArtist(artist)]);
      expect(result).toHaveLength(0);
    });
  });

  describe("valid artist names remain selectable", () => {
    function stationWithArtist(artist: string, slug = "s1"): DialStation {
      return makeStation({
        station: { ...makeStation().station, slug, name: "Test FM" },
        liveTrack: { ...makeStation().liveTrack!, artist },
      });
    }

    const VALID_CASES: Array<[string, string]> = [
      ["Radiohead", "normal band name"],
      ["The National", "band with article"],
      ["U2", "two-character band name"],
      ["DJ Shadow", "DJ prefix"],
      ["Fleetwood Mac", "multi-word"],
      ["Sigur Rós", "non-ASCII letter"],
      ["Beyoncé", "accented character"],
      ["deadmau5", "alphanumeric mix"],
      ["LCD Soundsystem", "acronym + word"],
      ["AC/DC", "slash in name"],
      ["Guns N' Roses", "apostrophe in name"],
      ["Nick Cave & The Bad Seeds", "ampersand in name"],
      ["Neutral Milk Hotel", "three words"],
      ["The xx", "lowercase"],
    ];

    it.each(VALID_CASES)("keeps '%s' (%s)", (artist) => {
      const result = extractLiveArtistSuggestions([stationWithArtist(artist)]);
      expect(result).toHaveLength(1);
      expect(result[0].artist).toBe(artist);
    });
  });

  describe("combined 'Artist - Title' ICY metadata splitting", () => {
    function stationWithArtistAndTitle(artist: string, title = "", slug = "s1"): DialStation {
      return makeStation({
        station: { ...makeStation().station, slug, name: "Test FM" },
        liveTrack: { ...makeStation().liveTrack!, artist, title },
      });
    }

    it("splits 'Radiohead - Creep' and uses only the artist half", () => {
      const result = extractLiveArtistSuggestions([stationWithArtistAndTitle("Radiohead - Creep")]);
      expect(result).toHaveLength(1);
      expect(result[0].artist).toBe("Radiohead");
    });

    it("backfills the track title from the split when the title field is empty", () => {
      const result = extractLiveArtistSuggestions([stationWithArtistAndTitle("Radiohead - Creep", "")]);
      expect(result).toHaveLength(1);
      expect(result[0].artist).toBe("Radiohead");
      expect(result[0].trackTitle).toBe("Creep");
    });

    it("does not overwrite a real title with the split title", () => {
      const result = extractLiveArtistSuggestions([stationWithArtistAndTitle("Radiohead - Creep", "Karma Police")]);
      expect(result).toHaveLength(1);
      expect(result[0].trackTitle).toBe("Karma Police");
    });

    it("does not split a legit hyphenated name with no spaces around the dash", () => {
      const result = extractLiveArtistSuggestions([stationWithArtistAndTitle("Jean-Michel Jarre", "")]);
      expect(result).toHaveLength(1);
      expect(result[0].artist).toBe("Jean-Michel Jarre");
    });

    it("handles multi-dash titles correctly — only splits on the first ' - '", () => {
      const result = extractLiveArtistSuggestions([stationWithArtistAndTitle("LCD Soundsystem - All My Friends - Live", "")]);
      expect(result).toHaveLength(1);
      expect(result[0].artist).toBe("LCD Soundsystem");
      expect(result[0].trackTitle).toBe("All My Friends - Live");
    });
  });

  it("skips non-live stations regardless of artist quality", () => {
    const offAir = makeStation({
      isLive: false,
      liveTrack: { ...makeStation().liveTrack!, artist: "Great Artist" },
    });
    expect(extractLiveArtistSuggestions([offAir])).toHaveLength(0);
  });

  it("caps output at the requested max", () => {
    const stations = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta"].map(
      (artist, i) =>
        makeStation({
          station: { ...makeStation().station, slug: `s${i}` },
          liveTrack: { ...makeStation().liveTrack!, artist },
        }),
    );
    expect(extractLiveArtistSuggestions(stations, 4)).toHaveLength(4);
  });

  it("ranks flagship/proven human shows with usable hosts before automated fallback stations", () => {
    const fallback = makeStation({
      station: {
        ...makeStation().station,
        slug: "fallback",
        name: "Fallback Radio",
        tier: "longtail",
        qualityTier: "raw",
        automationClass: "automated",
      },
      liveTrack: { ...makeStation().liveTrack!, artist: "Fallback Artist" },
    });
    const preferred = makeStation({
      station: {
        ...makeStation().station,
        slug: "flagship",
        name: "Flagship Radio",
        tier: "flagship",
        qualityTier: "proven",
        automationClass: "human",
      },
      liveTrack: { ...makeStation().liveTrack!, artist: "Preferred Artist" },
      shows: [{
        runId: 1, showName: "Morning Selects", djName: "Alex Host",
        startedAt: "", endedAt: "", state: "live", spins: [], crossings: 0,
        artistCrossings: 0, topArtists: [], topArtistNames: [], currentTrack: null,
        isPickerShow: false, pickerId: null,
      }],
    });

    expect(extractLiveArtistSuggestions([fallback, preferred], 2).map((s) => s.artist))
      .toEqual(["Preferred Artist", "Fallback Artist"]);
    expect(extractLiveArtistSuggestions([fallback, preferred], 2)[0])
      .toEqual(expect.objectContaining({ djName: "Alex Host", showName: "Morning Selects" }));
  });

  it("evaluates all live stations before capping and keeps stable source order for ties", () => {
    const stations = ["First", "Second", "Third", "Fourth"].map((artist, i) =>
      makeStation({
        station: { ...makeStation().station, slug: `tie-${i}`, name: `Tie ${i}` },
        liveTrack: { ...makeStation().liveTrack!, artist: `${artist} Artist` },
      }),
    );

    expect(extractLiveArtistSuggestions(stations, 3).map((s) => s.artist))
      .toEqual(["First Artist", "Second Artist", "Third Artist"]);
    expect(extractLiveArtistSuggestions(stations, 24).map((s) => s.artist))
      .toEqual(["First Artist", "Second Artist", "Third Artist", "Fourth Artist"]);
  });
});

describe("no-library onboarding live picker", () => {
  it("merges historical artists with live context and orders by Lore play count", () => {
    const rows = mergeOnboardingArtists(
      [
        { artist: "Zed", artistMbid: null, playCount: 80 },
        { artist: "Alpha", artistMbid: "a", playCount: 120 },
        { artist: "Bravo", artistMbid: "b", playCount: 120 },
      ],
      [{
        artist: "zed",
        stationSlug: "wfmu",
        stationName: "WFMU",
        trackTitle: "A Song",
        showName: "Morning",
        djName: "Alex",
      }],
    );
    expect(rows.map((row) => row.artist)).toEqual(["Alpha", "Bravo", "zed"]);
    expect(rows[2]).toEqual(expect.objectContaining({
      live: true,
      playCount: 80,
      djName: "Alex",
    }));
  });

  it("places live-only artists after historical artists with stable alphabetical ties", () => {
    const rows = mergeOnboardingArtists(
      [{ artist: "History", artistMbid: null, playCount: 1 }],
      [
        { artist: "Zulu", stationSlug: "z", stationName: "Z", trackTitle: null, showName: null, djName: null },
        { artist: "Alpha", stationSlug: "a", stationName: "A", trackTitle: null, showName: null, djName: null },
      ],
    );
    expect(rows.map((row) => row.artist)).toEqual(["History", "Alpha", "Zulu"]);
  });

  it("renders live choices with a normal manual/import fallback", () => {
    mockDial([], [{
      artist: "Live Artist",
      stationSlug: "wfmu",
      stationName: "WFMU",
      trackTitle: "Live Track",
      showName: "Morning Show",
    }]);

    render(<DialView />);

    expect(screen.getByRole("heading", { name: "Artists to start with" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose Live Artist" })).toBeTruthy();
    expect(screen.getByText("Morning Show · WFMU · live now")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. Radiohead")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Spotify library" })).toBeTruthy();
  });

  it("offers Matt’s starter library only when the server reports it is available", () => {
    mattStarter.mockReturnValue({ data: { available: true, addedCount: 0, totalCount: 24 } });
    const mutate = vi.fn();
    startMattLibrary.mockReturnValue({ mutate, isPending: false, error: null });
    mockDial([], [{ artist: "Still Available", stationSlug: "wfmu", stationName: "WFMU", trackTitle: null, showName: null }]);

    render(<DialView />);
    fireEvent.click(screen.getByRole("button", { name: "Start with Matt’s library" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("A resolved starter library, ready for Lore crossings")).toBeTruthy();
  });

  it("keeps artist controls usable while Matt’s library is copying or errors", () => {
    mattStarter.mockReturnValue({ data: { available: true, addedCount: 0, totalCount: 24 } });
    startMattLibrary.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      error: new Error("starter unavailable"),
    });
    mockDial([], [{ artist: "Still Available", stationSlug: "wfmu", stationName: "WFMU", trackTitle: null, showName: null }]);

    render(<DialView />);

    expect(screen.getByRole("button", { name: "Start with Matt’s library" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Choose Still Available" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("We couldn’t add Matt’s library. Try again or choose an artist below.");
  });

  it("persists a selected live artist through the taste-seed mutation", async () => {
    mockDial([], [{
      artist: "Selected Artist",
      stationSlug: "wfmu",
      stationName: "WFMU",
      trackTitle: null,
      showName: null,
    }]);

    render(<DialView />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Selected Artist" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(["Selected Artist"]);
    });
  });

  it("restores server-truth selection when a taste-seed write fails", async () => {
    mockDial([], [{
      artist: "Unpersisted Artist",
      stationSlug: "wfmu",
      stationName: "WFMU",
      trackTitle: null,
      showName: null,
    }]);
    mutateAsync.mockRejectedValueOnce(new Error("write failed"));

    render(<DialView />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Unpersisted Artist" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Choose Unpersisted Artist" })).toBeTruthy();
    });
  });

  it("keeps multiple quick live choices when each write resolves in order", async () => {
    mockDial([], [
      { artist: "First Artist", stationSlug: "one", stationName: "One FM", trackTitle: null, showName: null },
      { artist: "Second Artist", stationSlug: "two", stationName: "Two FM", trackTitle: null, showName: null },
    ]);
    mutateAsync
      .mockImplementationOnce(async (artists: string[]) => ({ artists }))
      .mockImplementationOnce(async (artists: string[]) => ({ artists }));

    render(<DialView />);
    fireEvent.click(screen.getByRole("button", { name: "Choose First Artist" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose Second Artist" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenNthCalledWith(1, ["First Artist"]);
      expect(mutateAsync).toHaveBeenNthCalledWith(2, ["First Artist", "Second Artist"]);
    });
  });

  it("preserves loaded seeds when adding an artist from the live picker", async () => {
    mockDial([], [{
      artist: "New Artist",
      stationSlug: "wfmu",
      stationName: "WFMU",
      trackTitle: null,
      showName: null,
    }]);
    tasteSeeds.mockReturnValue({ data: ["Existing Artist"] });
    render(<DialView />);

    fireEvent.change(screen.getByRole("textbox", { name: "Artist name" }), {
      target: { value: "New Artist" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(["Existing Artist", "New Artist"]);
    });
  });

  it("shows the fallback state when live data has no usable artist", () => {
    mockDial([], []);
    render(<DialView />);

    expect(screen.getByText("No artist names are available right now. You can add one below.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Choose/ })).toBeNull();
  });

  it("renders one full-width row per artist and shows the selection limit", () => {
    const suggestions = Array.from({ length: 12 }, (_, i) => ({
      artist: `Artist ${i + 1}`,
      stationSlug: `station-${i}`,
      stationName: `Station ${i + 1}`,
      trackTitle: null,
      showName: null,
      djName: null,
    }));
    render(
      <LiveArtistPicker
        suggestions={suggestions}
        loading={false}
        seeds={Array.from({ length: 10 }, (_, i) => `Seed ${i + 1}`)}
        onAddSeed={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: /Choose Artist/ })).toHaveLength(12);
    expect(screen.getByRole("status").textContent).toContain("Ten artists selected");
    expect((screen.getByRole("button", { name: "Choose Artist 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps every row at the same visual size", () => {
    const suggestions = Array.from({ length: 13 }, (_, i) => ({
      artist: `Ranked Artist ${i + 1}`,
      stationSlug: `station-${i}`,
      stationName: `Station ${i + 1}`,
      trackTitle: null,
      showName: null,
      djName: null,
    }));
    render(
      <LiveArtistPicker
        suggestions={suggestions}
        loading={false}
        seeds={[]}
        onAddSeed={vi.fn()}
      />,
    );

    const rows = screen.getAllByRole("button", { name: /Choose Ranked Artist/ });
    expect(new Set(rows.map((row) => row.className))).toEqual(
      new Set(["live-artist-picker__option live-artist-picker__option--live"]),
    );
  });

  it("keeps selected live artists visibly selected in the cloud", () => {
    const onAddSeed = vi.fn();
    render(
      <LiveArtistPicker
        suggestions={[{
          artist: "Selected Artist",
          stationSlug: "station",
          stationName: "Station FM",
          trackTitle: "A Song",
          showName: "A Show",
          djName: "A Host",
        }]}
        loading={false}
        seeds={["Selected Artist"]}
        onAddSeed={onAddSeed}
      />,
    );

    const button = screen.getByRole("button", { name: "Selected Selected Artist" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("live-artist-picker__option--selected")).toBe(true);
  });
});
