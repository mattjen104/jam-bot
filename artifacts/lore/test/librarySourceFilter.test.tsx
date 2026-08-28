// @vitest-environment jsdom
/**
 * Tests for the lens navigation and sort controls in Library.tsx (the Stack).
 *
 * Lens model — URL persistence contract:
 *   - The Stack header renders the five lenses (Stack default + four named).
 *   - The default "Stack" lens shows the album-first view (no lens param).
 *   - Selecting "Recent keeps" pushes ?lens=recent to the URL.
 *   - Selecting "Needs matching" pushes ?lens=matching to the URL.
 *   - Selecting "Stack" (the default) removes the lens param from the URL.
 *   - Mounting with ?lens=recent scopes the query to source=keep.
 *   - Mounting with ?lens=lore scopes the query to source=lore (server-side
 *     radio-provenance filter, so pagination/totals match the visible feed).
 *   - Mounting with ?lens=matching scopes the query to source=soft.
 *   - Mounting with ?lens=albums / ?lens=artists keeps the full mixed feed.
 *   - An unrecognised lens value is ignored (treated as Stack/default).
 *   - Empty state with an active lens shows "Show all" instead of "Open the dial".
 *
 * Sort controls — URL persistence contract:
 *   - Sort controls only appear in track-view lenses (recent, lore, matching,
 *     critic), NOT in the default album-first Stack view.
 *   - Selecting "Artist" sort pushes ?sort=artist to the URL.
 *   - Selecting "Title" sort pushes ?sort=title to the URL.
 *   - Selecting the default "Added" sort removes the sort param from the URL.
 *   - Mounting with ?sort=artist/?sort=title pre-selects that sort.
 *   - An unrecognised sort value is ignored (treated as "Added").
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockSetLocation,
  mockUseSearch,
  mockUseLocation,
  mockUseMyPreferences,
  mockUseMyConnections,
  mockUseMyLibraryInfinite,
  mockUseLatestImportJob,
  mockUseLatestSyncJob,
  mockUseMyAlbumsCompleted,
} = vi.hoisted(() => {
  const mockSetLocation = vi.fn();
  return {
    mockSetLocation,
    mockUseSearch: vi.fn(() => ""),
    mockUseLocation: vi.fn(() => ["/library", mockSetLocation] as [string, typeof mockSetLocation]),
    mockUseMyPreferences: vi.fn(() => ({ data: { ledgerEnabled: true } })),
    mockUseMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
    mockUseMyLibraryInfinite: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
    })),
    mockUseLatestImportJob: vi.fn(() => ({ data: null })),
    mockUseLatestSyncJob: vi.fn(() => ({ data: null })),
    mockUseMyAlbumsCompleted: vi.fn(() => ({ data: undefined })),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: mockUseLocation,
  useSearch: mockUseSearch,
}));

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      ride: { active: false },
      radio: { station: null },
    })),
  });
});

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyConnections: mockUseMyConnections,
    useMyLibraryInfinite: mockUseMyLibraryInfinite,
    useLatestImportJob: mockUseLatestImportJob,
    useLatestSyncJob: mockUseLatestSyncJob,
    useMyPreferences: mockUseMyPreferences,
    useMyAlbumsCompleted: mockUseMyAlbumsCompleted,
    useMyImportStats: vi.fn(() => ({ data: null })),
    useMyLibraryCoverage: vi.fn(() => ({ data: null })),
    patchPreferences: vi.fn(),
    startSpotifyLibraryConnect: vi.fn(),
    startSpotifyLibraryReconnect: vi.fn(),
    postStartImport: vi.fn(),
    postStartSync: vi.fn(),
    postImportLibraryFile: vi.fn(),
  });
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    useGetPickersDial: vi.fn(() => ({ data: null })),
  });
});

vi.mock("../src/lib/local", () => ({
  useFollows: vi.fn(() => []),
}));

vi.mock("../src/components/SearchOverlay", () => ({
  SearchOverlay: () => null,
}));

vi.mock("../src/components/LibraryRow", () => ({
  LibraryRow: ({ item }: { item: { mbid: string } }) => <li data-testid="library-row">{item.mbid}</li>,
}));

vi.mock("../src/components/KeepButton", () => ({
  KeepButton: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderLibrary() {
  const { default: Library } = await import("../src/pages/Library");
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <Library />
    </QueryClientProvider>,
  );
}

// Stable default stubs (no active lens, empty library, no jobs)
const PREFS_LEDGER_ON = { data: { ledgerEnabled: true } };
const NO_CONNECTIONS = { data: null, isLoading: false };
const LIBRARY_EMPTY = {
  data: undefined,
  isLoading: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
};
const NO_JOB = { data: null };
const NO_ALBUMS = { data: undefined };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockSetLocation.mockReset();
  mockUseSearch.mockReturnValue("");
  mockUseLocation.mockReturnValue(["/library", mockSetLocation]);
  mockUseMyPreferences.mockReturnValue(PREFS_LEDGER_ON);
  mockUseMyConnections.mockReturnValue(NO_CONNECTIONS);
  mockUseMyLibraryInfinite.mockReturnValue(LIBRARY_EMPTY);
  mockUseLatestImportJob.mockReturnValue(NO_JOB);
  mockUseLatestSyncJob.mockReturnValue(NO_JOB);
  mockUseMyAlbumsCompleted.mockReturnValue(NO_ALBUMS);
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Lens rendering
// ---------------------------------------------------------------------------

describe("Lens tabs are only rendered in non-default views", () => {
  it("does NOT render lens pills in the default Stack view (album-first full-screen list)", async () => {
    // The default Stack surface strips all dashboard chrome including lens controls.
    mockUseSearch.mockReturnValue("");
    await renderLibrary();
    expect(screen.queryByTestId("library-lens-timeline")).toBeNull();
    expect(screen.queryByTestId("library-lens-recent")).toBeNull();
    expect(screen.queryByTestId("library-lens-artists")).toBeNull();
    expect(screen.queryByTestId("library-lens-lore")).toBeNull();
    expect(screen.queryByTestId("library-lens-matching")).toBeNull();
  });

  it("strips all dashboard chrome in the default Stack view (full-screen list)", async () => {
    mockUseSearch.mockReturnValue("");
    const { container } = await renderLibrary();
    // Hero / stat cards
    expect(container.querySelector(".lib-hero")).toBeNull();
    // Week card and avatar picker
    expect(screen.queryByTestId("your-week-card")).toBeNull();
    expect(container.querySelector(".album-avatar-picker")).toBeNull();
    // Sort + group-filter bars
    expect(screen.queryByTestId("library-sort-controls")).toBeNull();
    expect(screen.queryByTestId("library-group-filter-bar")).toBeNull();
    // Grouped partial-load notice
    expect(screen.queryByTestId("library-grouped-partial-notice")).toBeNull();
  });

  it("removes the top-bar controls from the default Stack view", async () => {
    mockUseSearch.mockReturnValue("");
    await renderLibrary();
    expect(screen.queryByTestId("library-import-open")).toBeNull();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    // Empty libraries retain one contextual way to add music inside the crate.
    expect(screen.getByTestId("library-import-cta")).toBeTruthy();
  });

  it("shows every saved song with its album name and its own cover", async () => {
    const makeItem = (mbid: string, title: string, artworkUrl: string) => ({
      mbid,
      spotifyId: null,
      addedAt: `2026-08-${mbid === "track-1" ? "27" : "26"}T00:00:00.000Z`,
      removed: false,
      fuzzyMatch: false,
      provenance: {
        kind: "keep",
        stationName: "WFMU",
        sourceKeepDate: true,
      },
      recording: {
        title,
        artist: "The Artist",
        artistMbid: null,
        artworkUrl,
        albumTitle: "Shared Album",
        releaseGroupMbid: "release-group-1",
        releaseYear: 2026,
        spotifyUrl: null,
      },
    });
    mockUseMyLibraryInfinite.mockReturnValue({
      data: {
        pages: [{
          items: [
            makeItem("track-1", "First song", "https://images.example/first.jpg"),
            makeItem("track-2", "Second song", "https://images.example/second.jpg"),
          ],
          total: 2,
        }],
      },
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
    });

    const { container } = await renderLibrary();
    expect(screen.getAllByTestId("library-crate-track")).toHaveLength(2);
    expect(screen.getByText("First song")).toBeTruthy();
    expect(screen.getByText("Second song")).toBeTruthy();
    expect(screen.getAllByText("Shared Album")).toHaveLength(2);
    expect(container.querySelectorAll(".library-crate__track-swatch img")).toHaveLength(2);
  });

  it("does not revive lens controls from a legacy deep link", async () => {
    mockUseSearch.mockReturnValue("lens=recent");
    await renderLibrary();
    expect(screen.queryByTestId("library-lens-timeline")).toBeNull();
    expect(screen.queryByTestId("library-lens-recent")).toBeNull();
    expect(screen.queryByTestId("library-lens-artists")).toBeNull();
    expect(screen.queryByTestId("library-lens-lore")).toBeNull();
    expect(screen.queryByTestId("library-lens-matching")).toBeNull();
    expect(screen.queryByTestId("library-lens-albums")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// URL reads — mounting with a pre-set lens scopes the query correctly
// ---------------------------------------------------------------------------

describe("Pre-selecting lens from URL on load", () => {
  it("?lens=recent scopes the library query to source=keep", async () => {
    mockUseSearch.mockReturnValue("lens=recent");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ source?: string }];
    expect(lastCall[0].source).toBe("keep");
  });

  it("?lens=lore scopes the library query to source=lore", async () => {
    mockUseSearch.mockReturnValue("lens=lore");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ source?: string }];
    expect(lastCall[0].source).toBe("lore");
  });

  it("?lens=matching scopes the library query to source=soft", async () => {
    mockUseSearch.mockReturnValue("lens=matching");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ source?: string }];
    expect(lastCall[0].source).toBe("soft");
  });

  it("?lens=albums keeps the full mixed feed (no source scope)", async () => {
    mockUseSearch.mockReturnValue("lens=albums");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ source?: string }];
    expect(lastCall[0].source).toBeFalsy();
  });

  it("no lens param keeps the full mixed feed", async () => {
    mockUseSearch.mockReturnValue("");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ source?: string }];
    expect(lastCall[0].source).toBeFalsy();
  });

  it("an unrecognised lens value is ignored (treated as Timeline)", async () => {
    mockUseSearch.mockReturnValue("lens=random");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ source?: string }];
    expect(lastCall[0].source).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Sort controls — rendering
// ---------------------------------------------------------------------------

describe("Sort controls rendering", () => {
  it("does not render sort buttons from a legacy track-view lens", async () => {
    mockUseSearch.mockReturnValue("lens=recent");
    await renderLibrary();
    expect(screen.queryByTestId("library-sort-added")).toBeNull();
    expect(screen.queryByTestId("library-sort-artist")).toBeNull();
    expect(screen.queryByTestId("library-sort-title")).toBeNull();
  });

  it("hides sort buttons in the default Stack (album-first) view", async () => {
    mockUseSearch.mockReturnValue("");
    await renderLibrary();
    expect(screen.queryByTestId("library-sort-added")).toBeNull();
  });

  it("hides sort buttons in the grouped Albums lens", async () => {
    mockUseSearch.mockReturnValue("lens=albums");
    await renderLibrary();
    expect(screen.queryByTestId("library-sort-added")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sort controls — URL reads (pre-selection on mount)
// ---------------------------------------------------------------------------

describe("Pre-selecting sort from URL on load", () => {
  it("?sort=artist passes sort:'artist' to useMyLibraryInfinite", async () => {
    mockUseSearch.mockReturnValue("sort=artist");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ sort?: string }];
    expect(lastCall[0].sort).toBe("artist");
  });

  it("?sort=title passes sort:'title' to useMyLibraryInfinite", async () => {
    mockUseSearch.mockReturnValue("sort=title");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ sort?: string }];
    expect(lastCall[0].sort).toBe("title");
  });

  it("no sort param passes sort:'added' to useMyLibraryInfinite", async () => {
    mockUseSearch.mockReturnValue("");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ sort?: string }];
    expect(lastCall[0].sort).toBe("added");
  });

  it("an unrecognised sort value is ignored (treated as Added)", async () => {
    mockUseSearch.mockReturnValue("sort=random");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ sort?: string }];
    expect(lastCall[0].sort).toBe("added");
  });
});
