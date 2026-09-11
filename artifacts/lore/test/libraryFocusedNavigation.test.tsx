// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSetLocation,
  mockUseSearch,
  mockUseLocation,
  mockUseAppConfig,
  mockUseMyLibraryInfinite,
  mockUseDialData,
  mockUseSearchArtistStations,
  mockAddSeed,
} = vi.hoisted(() => {
  const mockSetLocation = vi.fn();
  const mockAddSeed = vi.fn();
  return {
    mockSetLocation,
    mockUseSearch: vi.fn(() => ""),
    mockUseLocation: vi.fn(() => ["/library", mockSetLocation] as const),
    mockUseAppConfig: vi.fn(() => ({ data: { demoSurface: true }, isLoading: false })),
    mockUseMyLibraryInfinite: vi.fn(),
    mockUseDialData: vi.fn(() => ({ stations: [], hasLibrary: true, hasSeeds: false })),
    mockUseSearchArtistStations: vi.fn(() => ({ data: { query: "", stations: [] } })),
    mockAddSeed,
  };
});

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useLocation: mockUseLocation,
  useSearch: mockUseSearch,
}));

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({ ride: { active: false }, radio: { station: null } })),
  });
});

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useAppConfig: mockUseAppConfig,
    useMyLibraryInfinite: mockUseMyLibraryInfinite,
    useMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
    useMyPreferences: vi.fn(() => ({ data: { ledgerEnabled: true } })),
    useMyImportStats: vi.fn(() => ({ data: null })),
    useMyLibraryCoverage: vi.fn(() => ({ data: null })),
    useMyTasteSeedCatalogue: vi.fn(() => ({ data: {} })),
    useMyInvestigationCoverage: vi.fn(() => new Set<string>()),
    useMyAlbumAvatar: vi.fn(() => ({ data: undefined })),
    useLatestImportJob: vi.fn(() => ({ data: null })),
    useLatestSyncJob: vi.fn(() => ({ data: null })),
  });
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    useGetPickersDial: vi.fn(() => ({ data: null })),
    useSearchArtistStations: mockUseSearchArtistStations,
    useSuggestArchiveArtists: vi.fn(() => ({
      data: {
        query: "king gizzard",
        suggestions: [
          { name: "King Gizzard & The Lizard Wizard", playCount: 584 },
          { name: "King Gizzard & The Lizard Wizard with Mild High Club", playCount: 11 },
        ],
      },
    })),
  });
});

vi.mock("../src/hooks/useSeedManager", () => ({
  useSeedManager: () => ({
    visibleSeeds: [],
    addSeed: mockAddSeed,
    removeSeed: vi.fn(),
    replaceSeeds: vi.fn(),
  }),
}));
vi.mock("../src/hooks/useDialData", () => ({
  useDialData: mockUseDialData,
}));
vi.mock("../src/lib/local", () => ({ useFollows: () => [] }));
vi.mock("../src/components/SearchOverlay", () => ({ SearchOverlay: () => null }));
vi.mock("../src/components/KeepButton", () => ({ KeepButton: () => null }));
vi.mock("../src/components/RadioSurface", () => ({
  RadioSurface: ({
    stations,
    onOpenStationCrossings,
  }: {
    stations: Array<{ station: { slug: string } }>;
    onOpenStationCrossings?: (stationSlug: string) => void;
  }) => (
    <div>
      {stations.map((station) => <span key={station.station.slug}>{station.station.slug}</span>)}
      <button onClick={() => onOpenStationCrossings?.("kexp")}>Has played your artists 12 times</button>
    </div>
  ),
}));
vi.mock("../src/components/DemoLibraryRemote", () => ({
  DemoStationRemote: () => <div>Station remote</div>,
  DemoSongRemote: () => <div>Song remote</div>,
}));
vi.mock("../src/components/AlbumAvatarPicker", () => ({ AlbumAvatarPicker: () => null }));
vi.mock("../src/components/YourWeekCard", () => ({ YourWeekCard: () => null }));
vi.mock("../src/components/ArtistDocument", () => ({ ArtistDocument: () => null }));

vi.mock("../src/components/StackRow", () => ({
  StackRow: ({
    group,
    isOpen,
    onToggle,
  }: {
    group: { albumTitle: string };
    isOpen: boolean;
    onToggle: () => void;
  }) => (
    <button aria-expanded={isOpen} onClick={onToggle}>
      {group.albumTitle}
    </button>
  ),
}));

const ITEMS = [
  {
    mbid: "broadcast-1",
    addedAt: "2026-09-09T00:00:00.000Z",
    recording: {
      title: "I Found the F",
      artist: "Broadcast",
      albumTitle: "Tender Buttons",
      artworkUrl: null,
      releaseYear: 2005,
    },
    provenance: { kind: "keep" },
  },
  {
    mbid: "stereolab-1",
    addedAt: "2026-09-08T00:00:00.000Z",
    recording: {
      title: "Brakhage",
      artist: "Stereolab",
      albumTitle: "Dots and Loops",
      artworkUrl: null,
      releaseYear: 1997,
    },
    provenance: { kind: "keep" },
  },
] as const;

function queryResult() {
  return {
    data: { pages: [{ items: ITEMS, total: ITEMS.length, keepCount: ITEMS.length }] },
    isLoading: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
  };
}

async function renderLibrary() {
  const { default: Library } = await import("../src/pages/Library");
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Library />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ releases: [] }),
  })));
  mockSetLocation.mockReset();
  mockAddSeed.mockReset();
  mockUseSearch.mockReturnValue("?view=songs&sort=artist");
  mockUseLocation.mockReturnValue(["/library?view=songs&sort=artist", mockSetLocation]);
  mockUseAppConfig.mockReturnValue({ data: { demoSurface: true }, isLoading: false });
  mockUseMyLibraryInfinite.mockReturnValue(queryResult());
  mockUseDialData.mockClear();
  mockUseSearchArtistStations.mockReturnValue({ data: { query: "", stations: [] } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("focused Library URL navigation", () => {
  it("intersects historical artist station membership with current-track music filters", async () => {
    mockUseSearch.mockReturnValue("?view=stations&focus=Broadcast&genre=electronic&age=deep");
    mockUseLocation.mockReturnValue([
      "/library?view=stations&focus=Broadcast&genre=electronic&age=deep",
      mockSetLocation,
    ]);
    mockUseSearchArtistStations.mockReturnValue({
      data: {
        query: "Broadcast",
        stations: [
          { slug: "historical-match", name: "Historical Match", playCount: 4 },
          { slug: "wrong-genre", name: "Wrong Genre", playCount: 2 },
        ],
      },
    });
    const station = (slug: string, genres: string[]) => ({
      station: { slug, name: slug },
      liveTrack: { artist: "Someone Else", title: "On Air", genres, releaseYear: 2005 },
      shows: [],
      topArtistNames: [],
      topArtistNames24h: [],
      topArtistNames7d: [],
      topArtistNamesLifetime: [],
      albumCrossings: [],
    });
    mockUseDialData.mockReturnValue({
      stations: [station("historical-match", ["electronic"]), station("wrong-genre", ["rock"])],
      hasLibrary: true,
      hasSeeds: false,
    });

    await renderLibrary();

    expect(screen.getByText("historical-match")).toBeTruthy();
    expect(screen.queryByText("wrong-genre")).toBeNull();
  });

  it("adds several autocomplete matches without closing or clearing the search", async () => {
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Find or focus artist" }));
    const input = screen.getByPlaceholderText("Search or add artist...");
    fireEvent.change(input, { target: { value: "king gizzard" } });

    fireEvent.click(screen.getByRole("button", {
      name: "Add King Gizzard & The Lizard Wizard to my artists",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "Add King Gizzard & The Lizard Wizard with Mild High Club to my artists",
    }));

    expect(mockAddSeed).toHaveBeenNthCalledWith(1, "King Gizzard & The Lizard Wizard");
    expect(mockAddSeed).toHaveBeenNthCalledWith(2, "King Gizzard & The Lizard Wizard with Mild High Club");
    expect((input as HTMLInputElement).value).toBe("king gizzard");
    expect(screen.getByRole("button", {
      name: "Add King Gizzard & The Lizard Wizard to my artists",
    })).toBeTruthy();
  });

  it("uses the best canonical artist completion when Enter is pressed", async () => {
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Find or focus artist" }));
    const input = screen.getByPlaceholderText("Search or add artist...");
    fireEvent.change(input, { target: { value: "king gizzard" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.searchParams.get("focus")).toBe("King Gizzard & The Lizard Wizard");
  });

  it("shows a Library-backed focused artist as already added", async () => {
    mockUseSearch.mockReturnValue("?focus=Broadcast");
    mockUseLocation.mockReturnValue(["/library?focus=Broadcast", mockSetLocation]);
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Find or focus artist" }));

    const added = screen.getByRole("button", { name: "Added to my artists" });
    expect(added.getAttribute("aria-pressed")).toBe("true");
    expect((added as HTMLButtonElement).disabled).toBe(true);
    expect(added.getAttribute("title")).toBe("Already in your Library");
  });

  it("clears artist focus directly from the Library heading", async () => {
    mockUseSearch.mockReturnValue("?focus=Broadcast&stationSort=live&openAlbum=Tender+Buttons%1FBroadcast");
    mockUseLocation.mockReturnValue([
      "/library?focus=Broadcast&stationSort=live&openAlbum=Tender+Buttons%1FBroadcast",
      mockSetLocation,
    ]);
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Clear artist focus: Broadcast" }));

    const url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.pathname).toBe("/library");
    expect(url.searchParams.has("focus")).toBe(false);
    expect(url.searchParams.has("openAlbum")).toBe(false);
    expect(url.searchParams.get("stationSort")).toBe("live");
  });

  it("opens station crossings from the Radio byline without losing station filters", async () => {
    mockUseSearch.mockReturnValue("?stationSort=live");
    mockUseLocation.mockReturnValue(["/library?stationSort=live", mockSetLocation]);
    await renderLibrary();

    fireEvent.click(screen.getByText("Has played your artists 12 times"));

    const url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.pathname).toBe("/library");
    expect(url.searchParams.get("stationCrossings")).toBe("kexp");
    expect(url.searchParams.get("lens")).toBeNull();
    expect(url.searchParams.get("station")).toBeNull();
    expect(url.searchParams.get("stationSort")).toBe("live");
  });

  it("restores additive station categories from the URL and preserves other filters", async () => {
    mockUseSearch.mockReturnValue("?categories=campus,anchor&focus=Broadcast&stationSort=live");
    mockUseLocation.mockReturnValue([
      "/library?categories=campus,anchor&focus=Broadcast&stationSort=live",
      mockSetLocation,
    ]);
    await renderLibrary();

    expect(mockUseDialData).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({
        categories: new Set(["campus", "anchor"]),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Categories/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Public & Community/ }));

    let url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.searchParams.get("categories")).toBe("campus,anchor,public");
    expect(url.searchParams.get("focus")).toBe("Broadcast");
    expect(url.searchParams.get("stationSort")).toBe("live");

    fireEvent.click(screen.getByRole("button", { name: "All stations" }));
    url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.searchParams.has("categories")).toBe(false);
    expect(url.searchParams.get("focus")).toBe("Broadcast");
    expect(url.searchParams.get("stationSort")).toBe("live");
  });

  it("keeps station categories when temporarily viewing Songs without showing the control", async () => {
    mockUseSearch.mockReturnValue("?view=songs&categories=campus,public");
    mockUseLocation.mockReturnValue([
      "/library?view=songs&categories=campus,public",
      mockSetLocation,
    ]);
    await renderLibrary();

    expect(screen.queryByRole("button", { name: /Categories/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Stations/ }).getAttribute("href"))
      .toBe("/library?categories=campus%2Cpublic");
  });

  it("keeps one URL-backed visual layout across Stations and Songs", async () => {
    mockUseSearch.mockReturnValue("?categories=campus&focus=Broadcast");
    mockUseLocation.mockReturnValue([
      "/library?categories=campus&focus=Broadcast",
      mockSetLocation,
    ]);
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Show visual grid" }));

    const url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.searchParams.get("layout")).toBe("grid");
    expect(url.searchParams.get("categories")).toBe("campus");
    expect(url.searchParams.get("focus")).toBe("Broadcast");

    mockUseSearch.mockReturnValue("?layout=grid&categories=campus&focus=Broadcast");
    mockUseLocation.mockReturnValue([
      "/library?layout=grid&categories=campus&focus=Broadcast",
      mockSetLocation,
    ]);
    cleanup();
    await renderLibrary();

    expect(screen.getByText("Station remote")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Songs/ }).getAttribute("href"))
      .toContain("layout=grid");
  });

  it("loads every Songs page for a direct visual-grid URL with the matching server sort", async () => {
    const fetchNextPage = vi.fn(async () => undefined);
    mockUseSearch.mockReturnValue("?view=songs&layout=grid&sort=title");
    mockUseLocation.mockReturnValue([
      "/library?view=songs&layout=grid&sort=title",
      mockSetLocation,
    ]);
    mockUseMyLibraryInfinite.mockReturnValue({
      ...queryResult(),
      hasNextPage: true,
      fetchNextPage,
    });

    await renderLibrary();

    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledOnce());
    expect(mockUseMyLibraryInfinite).toHaveBeenCalledWith({ sort: "title" }, 100);
  });

  it("focuses a grouped song artist and clears the previous album in demo mode", async () => {
    mockUseSearch.mockReturnValue("?view=songs&sort=artist&openAlbum=Dots+and+Loops%1FStereolab");
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Broadcast, 1 album · 1 song" }));

    const url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.pathname).toBe("/library");
    expect(url.searchParams.get("view")).toBe("songs");
    expect(url.searchParams.get("focus")).toBe("Broadcast");
    expect(url.searchParams.get("sort")).toBe("album");
    expect(url.searchParams.has("openAlbum")).toBe(false);
  });

  it("opens a saved album with focus and restores expansion from back/forward query changes", async () => {
    const view = await renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Browse album for I Found the F" }));

    const url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.searchParams.get("view")).toBe("songs");
    expect(url.searchParams.get("focus")).toBe("Broadcast");
    expect(url.searchParams.get("sort")).toBe("album");
    expect(url.searchParams.get("openAlbum")).toBe("Tender Buttons\x1fBroadcast");

    mockUseSearch.mockReturnValue("?view=songs&sort=album&focus=Broadcast&openAlbum=Tender+Buttons%1FBroadcast");
    mockUseLocation.mockReturnValue([
      "/library?view=songs&sort=album&focus=Broadcast&openAlbum=Tender+Buttons%1FBroadcast",
      mockSetLocation,
    ]);
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {React.createElement((await import("../src/pages/Library")).default)}
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tender Buttons" }).getAttribute("aria-expanded")).toBe("true");
    });

    mockUseSearch.mockReturnValue("?view=songs&sort=album&focus=Broadcast");
    mockUseLocation.mockReturnValue(["/library?view=songs&sort=album&focus=Broadcast", mockSetLocation]);
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {React.createElement((await import("../src/pages/Library")).default)}
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tender Buttons" }).getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("keeps focused routing disabled outside demo mode", async () => {
    mockUseAppConfig.mockReturnValue({ data: { demoSurface: false }, isLoading: false });
    mockUseSearch.mockReturnValue("?sort=artist&focus=Broadcast&openAlbum=Tender+Buttons%1FBroadcast");
    mockUseLocation.mockReturnValue([
      "/library?sort=artist&focus=Broadcast&openAlbum=Tender+Buttons%1FBroadcast",
      mockSetLocation,
    ]);
    await renderLibrary();

    expect(screen.queryByRole("button", { name: "Broadcast, 1 album · 1 song" })).toBeNull();
    expect(screen.queryByText("Library / Broadcast")).toBeNull();
    expect(screen.getByText("Broadcast")).toBeTruthy();
    expect(screen.getByText("Stereolab")).toBeTruthy();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });
});