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
    useSearchArtistStations: vi.fn(() => ({ data: { query: "", stations: [] } })),
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
  useDialData: () => ({ stations: [], hasLibrary: true, hasSeeds: false }),
}));
vi.mock("../src/lib/local", () => ({ useFollows: () => [] }));
vi.mock("../src/components/SearchOverlay", () => ({ SearchOverlay: () => null }));
vi.mock("../src/components/KeepButton", () => ({ KeepButton: () => null }));
vi.mock("../src/components/RadioSurface", () => ({
  RadioSurface: ({ onOpenStationCrossings }: { onOpenStationCrossings?: (stationSlug: string) => void }) => (
    <button onClick={() => onOpenStationCrossings?.("kexp")}>Has played your artists 12 times</button>
  ),
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("focused Library URL navigation", () => {
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