// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSetLocation,
  mockUseSearch,
  mockUseLocation,
  mockUseAppConfig,
  mockUseMyLibraryInfinite,
  mockUseMyLibraryAlbums,
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
    mockUseMyLibraryAlbums: vi.fn(),
    mockUseDialData: vi.fn(() => ({ stations: [], hasLibrary: true, hasSeeds: false })),
    mockUseSearchArtistStations: vi.fn(() => ({ data: { query: "", stations: [] } })),
    mockAddSeed,
  };
});

vi.mock("wouter", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => <a href={href} {...props}>{children}</a>,
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
    useMyLibraryAlbums: mockUseMyLibraryAlbums,
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
    focusedMembershipFailed,
    onRetryFocusedMembership,
  }: {
    stations: Array<{ station: { slug: string }; albumCrossings?: unknown[] }>;
    onOpenStationCrossings?: (stationSlug: string) => void;
    focusedMembershipFailed?: boolean;
    onRetryFocusedMembership?: () => void;
  }) => (
    <div>
      {stations.map((station) => (
        <span key={station.station.slug} data-crossings={station.albumCrossings?.length ?? 0}>
          {station.station.slug}
        </span>
      ))}
      {focusedMembershipFailed ? (
        <p role="alert">
          We couldn't check the full station archive. Showing locally matched stations only.
          <button type="button" onClick={onRetryFocusedMembership}>Retry archive lookup</button>
        </p>
      ) : null}
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
  mockUseMyLibraryAlbums.mockReturnValue({
    data: {
      items: [],
      counts: { inbox: 0, rotation: 0, shelf: 0, passed: 0, unresolved: 0 },
      total: 0,
    },
  });
  mockUseDialData.mockClear();
  mockUseSearchArtistStations.mockReturnValue({ data: { query: "", stations: [] } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("focused Library URL navigation", () => {
  it("shows one permanent Radio and Library workflow menu", async () => {
    mockUseSearch.mockReturnValue("");
    mockUseLocation.mockReturnValue(["/library", mockSetLocation]);
    await renderLibrary();

    expect(screen.queryByRole("navigation", { name: "Library views" })).toBeNull();
    const sections = screen.getByRole("navigation", { name: "Library sections" });
    expect(within(sections).getByRole("link", { name: "Library" }).getAttribute("href"))
      .toBe("/library?section=library");
    expect(within(sections).getAllByRole("link").slice(1).map((link) => link.textContent)).toEqual([
      "Radio",
      "Inbox",
      "Rotation",
      "Shelf",
      "Passed",
      "Unresolved",
    ]);
    expect(within(sections).queryByRole("link", { name: "Press" })).toBeNull();
    expect(within(sections).queryByRole("link", { name: "Merch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Find artists" })).toBeNull();
  });

  it("opens the moon Library with Albums, Songs, Artists, and artist search", async () => {
    mockUseSearch.mockReturnValue("?section=library");
    mockUseLocation.mockReturnValue(["/library?section=library", mockSetLocation]);
    await renderLibrary();

    expect(screen.getByRole("link", { name: "Library" }).getAttribute("aria-current")).toBe("page");
    const grouping = screen.getByRole("group", { name: "Group Library by" });
    expect(within(grouping).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Albums",
      "Songs",
      "Artists",
    ]);
    expect(within(grouping).getByRole("link", { name: "Albums" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Find artists" })).toBeTruthy();
    expect(mockUseMyLibraryAlbums).toHaveBeenCalledWith("shelf", "", true);
  });

  it("ignores removed legacy Radio scope filters", async () => {
    const workflowItem = (releaseGroupMbid: string, state: "rotation" | "shelf") => ({
      unresolved: false as const,
      releaseGroupMbid,
      title: releaseGroupMbid,
      artist: "Artist",
      artistMbid: null,
      artworkUrl: null,
      releaseYear: null,
      state,
      note: null,
      picks: null,
      trackCount: 1,
      activeTrackMbids: [`track-${releaseGroupMbid}`],
      sourceCount: 1,
    });
    mockUseMyLibraryAlbums.mockImplementation((state: string) => ({
      data: {
        items: state === "rotation" ? [workflowItem("rg-rotation", "rotation")] : [workflowItem("rg-shelf", "shelf")],
        counts: { inbox: 0, rotation: 1, shelf: 1, passed: 0, unresolved: 0 },
        total: 1,
      },
    }));
    const station = (slug: string, releaseGroupMbid: string) => ({
      station: { slug, name: slug, tags: [] },
      liveTrack: null,
      shows: [],
      topArtistNames: [],
      topArtistNames24h: [],
      topArtistNames7d: [],
      topArtistNames30d: [],
      topArtistNamesLifetime: [],
      albumCrossings: [{
        releaseGroupMbid,
        recordingMbid: `track-${releaseGroupMbid}`,
        title: "Song",
        artist: "Artist",
        artworkUrl: null,
      }],
    });
    mockUseDialData.mockReturnValue({
      stations: [station("rotation-station", "rg-rotation"), station("shelf-station", "rg-shelf")],
      hasLibrary: true,
      hasSeeds: false,
    });
    mockUseSearch.mockReturnValue("?view=radio&radioScope=rotation");
    mockUseLocation.mockReturnValue(["/library?view=radio&radioScope=rotation", mockSetLocation]);

    await renderLibrary();

    expect(screen.getByText("rotation-station")).toBeTruthy();
    expect(screen.getByText("shelf-station")).toBeTruthy();
    expect(screen.getByLabelText("Refine Radio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Entire library" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Rotation ·/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Shelf ·/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear Radio focus: rotation" })).toBeNull();
  });

  it("keeps Radio refinement visible without track-age filtering", async () => {
    mockUseSearch.mockReturnValue("?view=radio");
    mockUseLocation.mockReturnValue(["/library?view=radio", mockSetLocation]);

    await renderLibrary();

    expect(screen.getByLabelText("Refine Radio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear Radio focus: library" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Entire library" })).toBeNull();
    expect(screen.getByRole("button", { name: "Find artists" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Filter Radio by age" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Only my stations" })).toBeNull();
  });

  it("keeps album workflows free of search and grouping controls", async () => {
    mockUseSearch.mockReturnValue("");
    mockUseLocation.mockReturnValue(["/library", mockSetLocation]);
    await renderLibrary();

    expect(screen.queryByRole("searchbox", { name: "Search library" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Group Library by" })).toBeNull();
  });

  it("cleans obsolete song and artist state from album workflow links", async () => {
    mockUseSearch.mockReturnValue("?workflow=rotation&grouping=artists&songQuery=Broadcast&focus=Broadcast");
    mockUseLocation.mockReturnValue([
      "/library?workflow=rotation&grouping=artists&songQuery=Broadcast&focus=Broadcast",
      mockSetLocation,
    ]);
    await renderLibrary();

    expect(mockSetLocation).toHaveBeenCalledWith("/library?workflow=rotation", { replace: true });
    expect(screen.queryByRole("searchbox", { name: "Search library" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Group Library by" })).toBeNull();
  });

  it("treats an old contradictory artist-plus-genre link as the Artist lens", async () => {
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
    const station = (slug: string, tags: string[]) => ({
      station: { slug, name: slug, tags },
      liveTrack: null,
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
    expect(screen.getByText("wrong-genre")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Lens" })).toBeNull();
    const migrated = new URL(mockSetLocation.mock.calls[0]![0], "https://lore.test");
    expect(migrated.searchParams.get("libraryLens")).toBe("artist");
    expect(migrated.searchParams.has("genre")).toBe(false);
    expect(migrated.searchParams.has("age")).toBe(false);
    expect(migrated.searchParams.get("categories")).toBe("specialist");
    expect(migrated.searchParams.get("specialistCategories")).toBe("electronic,era");
  });

  it("adds several autocomplete matches without closing or clearing the search", async () => {
    mockUseSearch.mockReturnValue("?view=radio");
    mockUseLocation.mockReturnValue(["/library?view=radio", mockSetLocation]);
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Find artists" }));
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
    mockUseSearch.mockReturnValue("?view=radio");
    mockUseLocation.mockReturnValue(["/library?view=radio", mockSetLocation]);
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Find artists" }));
    const input = screen.getByPlaceholderText("Search or add artist...");
    fireEvent.change(input, { target: { value: "king gizzard" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.searchParams.get("focus")).toBe("King Gizzard & The Lizard Wizard");
  });

  it("shows a Library-backed focused artist as already added", async () => {
    mockUseSearch.mockReturnValue("?view=radio&focus=Broadcast");
    mockUseLocation.mockReturnValue(["/library?view=radio&focus=Broadcast", mockSetLocation]);
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Find artists" }));

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
    expect(url.searchParams.get("stationCrossings")).toBeNull();
    expect(url.searchParams.get("lens")).toBeNull();
    expect(url.searchParams.get("station")).toBeNull();
    expect(url.searchParams.get("stationSort")).toBe("live");
  });

  it("restores additive station categories from the URL and preserves other filters", async () => {
    mockUseSearch.mockReturnValue("?view=radio&categories=campus,anchor&focus=Broadcast&stationSort=live");
    mockUseLocation.mockReturnValue([
      "/library?view=radio&categories=campus,anchor&focus=Broadcast&stationSort=live",
      mockSetLocation,
    ]);
    await renderLibrary();

    expect(mockUseDialData).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({
        categories: undefined,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Public & Community/ }));

    let url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.searchParams.get("categories")).toBe("campus,anchor,public");
    expect(url.searchParams.get("focus")).toBe("Broadcast");
    expect(url.searchParams.get("stationSort")).toBe("live");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.searchParams.has("categories")).toBe(false);
    expect(url.searchParams.get("focus")).toBe("Broadcast");
    expect(url.searchParams.get("stationSort")).toBe("live");
  });

  it("shows every settled artist station despite Highlight and category-local evidence", async () => {
    mockUseSearch.mockReturnValue("?view=radio&stationMode=highlights&categories=campus&focus=Broadcast");
    mockUseLocation.mockReturnValue([
      "/library?view=radio&stationMode=highlights&categories=campus&focus=Broadcast",
      mockSetLocation,
    ]);
    const station = (slug: string, tags: string[]) => ({
      station: { slug, name: slug, tags },
      liveTrack: null,
      shows: [],
      topArtistNames: [],
      topArtistNames24h: [],
      topArtistNames7d: [],
      topArtistNamesLifetime: [],
      albumCrossings: [],
    });
    mockUseDialData.mockReturnValue({
      stations: [
        station("origin-highlight", ["campus"]),
        station("other-match", ["public"]),
        station("not-a-match", ["campus"]),
      ],
      hasLibrary: true,
      hasSeeds: false,
    });
    mockUseSearchArtistStations.mockReturnValue({
      data: {
        query: "Broadcast",
        stations: [
          { slug: "origin-highlight", name: "Origin Highlight", playCount: 2 },
          { slug: "other-match", name: "Other Match", playCount: 1 },
        ],
      },
    });

    await renderLibrary();

    expect(screen.getByText("origin-highlight")).toBeTruthy();
    expect(screen.getByText("other-match")).toBeTruthy();
    expect(screen.queryByText("not-a-match")).toBeNull();
    expect(mockUseDialData).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({ categories: undefined }),
    );
  });

  it("keeps local artist matches usable and retries a failed archive lookup", async () => {
    mockUseSearch.mockReturnValue("?view=stations&focus=Broadcast");
    mockUseLocation.mockReturnValue([
      "/library?view=stations&focus=Broadcast",
      mockSetLocation,
    ]);
    const refetch = vi.fn();
    mockUseDialData.mockReturnValue({
      stations: [
        {
          station: { slug: "local-match", name: "Local Match", tags: [] },
          liveTrack: { artist: "Broadcast" },
          shows: [],
          topArtistNames: [],
          topArtistNames24h: [],
          topArtistNames7d: [],
          topArtistNamesLifetime: [],
          albumCrossings: [],
        },
        {
          station: { slug: "not-a-match", name: "Not a Match", tags: [] },
          liveTrack: null,
          shows: [],
          topArtistNames: [],
          topArtistNames24h: [],
          topArtistNames7d: [],
          topArtistNamesLifetime: [],
          albumCrossings: [],
        },
      ],
      hasLibrary: true,
      hasSeeds: false,
    });
    mockUseSearchArtistStations.mockReturnValue({
      data: undefined,
      isError: true,
      refetch,
    });

    await renderLibrary();

    expect(screen.getByText("local-match")).toBeTruthy();
    expect(screen.queryByText("not-a-match")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("locally matched stations only");

    fireEvent.click(screen.getByRole("button", { name: "Retry archive lookup" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("does not describe a successful empty archive result as an outage", async () => {
    mockUseSearch.mockReturnValue("?view=stations&focus=Broadcast");
    mockUseLocation.mockReturnValue([
      "/library?view=stations&focus=Broadcast",
      mockSetLocation,
    ]);
    mockUseSearchArtistStations.mockReturnValue({
      data: { query: "Broadcast", stations: [] },
      isError: false,
      refetch: vi.fn(),
    });

    await renderLibrary();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry archive lookup" })).toBeNull();
  });

  it("applies Specialist subcategories to stations by shared station classification", async () => {
    mockUseSearch.mockReturnValue("?view=radio&categories=specialist&specialistCategories=ambient");
    mockUseLocation.mockReturnValue([
      "/library?view=radio&categories=specialist&specialistCategories=ambient",
      mockSetLocation,
    ]);
    const station = (slug: string, tags: string[]) => ({
      station: { slug, name: slug, tags },
      liveTrack: null,
      shows: [],
      topArtistNames: [],
      topArtistNames24h: [],
      topArtistNames7d: [],
      topArtistNamesLifetime: [],
      albumCrossings: [],
    });
    mockUseDialData.mockReturnValue({
      stations: [
        station("ambient-station", ["ambient"]),
        station("rock-station", ["punk"]),
      ],
      hasLibrary: true,
      hasSeeds: false,
    });

    await renderLibrary();

    expect(screen.getByText("ambient-station")).toBeTruthy();
    expect(screen.queryByText("rock-station")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Crossings in" })).toBeNull();
    const sort = screen.getByLabelText("Sort Radio by Crossings");
    fireEvent.click(sort);
    expect(screen.getByRole("button", { name: "Premieres" })).toBeTruthy();
  });

  it("keeps station categories when temporarily viewing Songs without showing the control", async () => {
    mockUseSearch.mockReturnValue("?view=songs&categories=campus,public");
    mockUseLocation.mockReturnValue([
      "/library?view=songs&categories=campus,public",
      mockSetLocation,
    ]);
    await renderLibrary();

    expect(screen.queryByRole("button", { name: /Filters/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Sort stations" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Newest music first" })).toBeNull();
    expect(screen.getByRole("link", { name: /Radio/ }).getAttribute("href"))
      .toBe("/library?view=radio&categories=campus%2Cpublic");
  });

  it("keeps one URL-backed visual layout across Stations and Songs", async () => {
    mockUseSearch.mockReturnValue("?view=radio&categories=campus&focus=Broadcast");
    mockUseLocation.mockReturnValue([
      "/library?view=radio&categories=campus&focus=Broadcast",
      mockSetLocation,
    ]);
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Presets" }));

    const url = new URL(mockSetLocation.mock.calls.at(-1)![0], "https://lore.test");
    expect(url.searchParams.get("layout")).toBe("grid");
    expect(url.searchParams.get("categories")).toBe("campus");
    expect(url.searchParams.get("focus")).toBe("Broadcast");

    mockUseSearch.mockReturnValue("?view=radio&layout=grid&categories=campus&focus=Broadcast");
    mockUseLocation.mockReturnValue([
      "/library?view=radio&layout=grid&categories=campus&focus=Broadcast",
      mockSetLocation,
    ]);
    cleanup();
    await renderLibrary();

    expect(screen.getByText("Station remote")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Inbox" }).getAttribute("href"))
      .toContain("layout=grid");
  });

  it("does not load the retired Songs grid for a direct legacy URL", async () => {
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

    expect(fetchNextPage).not.toHaveBeenCalled();
    expect(mockUseMyLibraryInfinite).toHaveBeenCalledWith({ sort: "title" }, 100);
    expect(mockSetLocation).toHaveBeenCalledWith("/library?layout=grid&sort=title", { replace: true });
    expect(screen.queryByRole("combobox", { name: "Sort songs" })).toBeNull();
  });

  it("uses the unified Library even when the old demo flag is off", async () => {
    mockUseAppConfig.mockReturnValue({ data: { demoSurface: false }, isLoading: false });
    mockUseSearch.mockReturnValue("?sort=artist&focus=Broadcast&openAlbum=Tender+Buttons%1FBroadcast");
    mockUseLocation.mockReturnValue([
      "/library?sort=artist&focus=Broadcast&openAlbum=Tender+Buttons%1FBroadcast",
      mockSetLocation,
    ]);
    await renderLibrary();

    expect(screen.getByRole("link", { name: "Inbox" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Group Library by" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add music" })).toBeTruthy();
    expect(mockSetLocation).toHaveBeenCalledWith("/library?sort=artist", { replace: true });
  });

});
