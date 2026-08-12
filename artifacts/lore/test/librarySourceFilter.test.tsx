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

describe("Lens tabs are always rendered", () => {
  it("renders Stack (default) plus the four named lenses", async () => {
    await renderLibrary();
    // "Stack" is the default — its testid uses the fallback "timeline" key.
    expect(screen.getByTestId("library-lens-timeline")).toBeTruthy();
    expect(screen.getByTestId("library-lens-recent")).toBeTruthy();
    expect(screen.getByTestId("library-lens-artists")).toBeTruthy();
    expect(screen.getByTestId("library-lens-lore")).toBeTruthy();
    expect(screen.getByTestId("library-lens-matching")).toBeTruthy();
    // "Albums" is no longer a named lens pill — the Stack default IS albums.
    expect(screen.queryByTestId("library-lens-albums")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// URL writes — selecting a lens updates the URL
// ---------------------------------------------------------------------------

describe("Selecting a lens updates the URL", () => {
  it("clicking 'Recent keeps' calls setLocation with ?lens=recent", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-lens-recent"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("lens=recent");
  });

  it("clicking 'Needs matching' calls setLocation with ?lens=matching", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-lens-matching"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("lens=matching");
  });

  it("clicking 'From Lore' calls setLocation with ?lens=lore", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-lens-lore"));
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("lens=lore");
  });

  it("clicking 'Timeline' calls setLocation WITHOUT a lens param", async () => {
    mockUseSearch.mockReturnValue("lens=recent");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-lens-timeline"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).not.toContain("lens=");
  });

  it("'Timeline' navigates to the bare path when the only param was lens", async () => {
    mockUseSearch.mockReturnValue("lens=albums");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-lens-timeline"));
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toBe("/library");
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
// Empty state CTA — "Show all" vs "Open the dial"
// ---------------------------------------------------------------------------

describe("Empty state CTA with and without active lens", () => {
  it("shows 'Open the dial' when library is empty and no lens is active", async () => {
    mockUseSearch.mockReturnValue("");
    await renderLibrary();
    expect(screen.getByText(/open the dial/i)).toBeTruthy();
    expect(screen.queryByText(/show all/i)).toBeNull();
  });

  it("shows 'Show all' instead of 'Open the dial' when lens=recent and library is empty", async () => {
    mockUseSearch.mockReturnValue("lens=recent");
    await renderLibrary();
    expect(screen.getByText(/show all/i)).toBeTruthy();
    expect(screen.queryByText(/open the dial/i)).toBeNull();
  });

  it("shows 'Show all' instead of 'Open the dial' when lens=matching and library is empty", async () => {
    mockUseSearch.mockReturnValue("lens=matching");
    await renderLibrary();
    expect(screen.getByText(/show all/i)).toBeTruthy();
    expect(screen.queryByText(/open the dial/i)).toBeNull();
  });

  it("'Show all' button clears the lens from the URL", async () => {
    mockUseSearch.mockReturnValue("lens=recent");
    await renderLibrary();
    fireEvent.click(screen.getByText(/show all/i));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).not.toContain("lens=");
  });
});

// ---------------------------------------------------------------------------
// Sort controls — rendering
// ---------------------------------------------------------------------------

describe("Sort controls rendering", () => {
  it("renders Added, Artist, and Title sort buttons in a track-view lens (e.g. recent)", async () => {
    // Sort controls only appear when a track-list lens is active.
    // The default Stack view is album-first and has no sort controls.
    mockUseSearch.mockReturnValue("lens=recent");
    await renderLibrary();
    expect(screen.getByTestId("library-sort-added")).toBeTruthy();
    expect(screen.getByTestId("library-sort-artist")).toBeTruthy();
    expect(screen.getByTestId("library-sort-title")).toBeTruthy();
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
// Sort controls — URL writes
// ---------------------------------------------------------------------------

// Sort controls are only shown in track-view lenses (recent, lore, matching, critic).
// All URL-write tests therefore activate lens=recent first so the sort bar renders.
describe("Selecting a sort button updates the URL", () => {
  it("clicking 'Artist' calls setLocation with ?sort=artist", async () => {
    mockUseSearch.mockReturnValue("lens=recent");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-sort-artist"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("sort=artist");
  });

  it("clicking 'Title' calls setLocation with ?sort=title", async () => {
    mockUseSearch.mockReturnValue("lens=recent");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-sort-title"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("sort=title");
  });

  it("clicking 'Added' (default) calls setLocation WITHOUT a sort param", async () => {
    mockUseSearch.mockReturnValue("lens=recent&sort=artist");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-sort-added"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).not.toContain("sort=");
  });

  it("'Added' drops only the sort param when lens is still active", async () => {
    mockUseSearch.mockReturnValue("lens=recent&sort=title");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-sort-added"));
    const [url] = mockSetLocation.mock.calls[0] as [string];
    // lens stays; sort is dropped
    expect(url).toContain("lens=recent");
    expect(url).not.toContain("sort=");
  });

  it("preserves existing lens param when changing sort", async () => {
    mockUseSearch.mockReturnValue("lens=recent");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-sort-artist"));
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("lens=recent");
    expect(url).toContain("sort=artist");
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
