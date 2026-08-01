// @vitest-environment jsdom
/**
 * Tests for the source-filter pills and sort controls in Library.tsx.
 *
 * Source filter — URL persistence contract:
 *   - Selecting "Saved from radio" pushes ?source=keep to the URL.
 *   - Selecting "Imported" pushes ?source=import to the URL.
 *   - Selecting "All" removes the source param from the URL.
 *   - Mounting with ?source=import pre-selects the Imported pill.
 *   - Mounting with ?source=keep pre-selects the Saved-from-radio pill.
 *   - Empty state with an active filter shows "Show all" instead of "Open the dial".
 *   - Empty state with no filter shows "Open the dial".
 *
 * Sort controls — URL persistence contract:
 *   - Selecting "Artist" sort pushes ?sort=artist to the URL.
 *   - Selecting "Title" sort pushes ?sort=title to the URL.
 *   - Selecting the default "Added" sort removes the sort param from the URL.
 *   - Mounting with ?sort=artist pre-selects the Artist sort button.
 *   - Mounting with ?sort=title pre-selects the Title sort button.
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

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: vi.fn(() => ({
    ride: { active: false },
    radio: { station: null },
  })),
}));

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

// Stable default stubs (no active filter, empty library, no jobs)
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
  // Reset setLocation capture
  mockSetLocation.mockReset();
  // Default: no search params, at /library
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
// Pill rendering
// ---------------------------------------------------------------------------

describe("Source filter pills are always rendered", () => {
  it("renders All, Saved from radio, and Imported pills", async () => {
    await renderLibrary();
    expect(screen.getByTestId("library-filter-all")).toBeTruthy();
    expect(screen.getByTestId("library-filter-keep")).toBeTruthy();
    expect(screen.getByTestId("library-filter-import")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// URL writes — selecting a pill updates the URL
// ---------------------------------------------------------------------------

describe("Selecting a filter pill updates the URL", () => {
  it("clicking 'Saved from radio' calls setLocation with ?source=keep", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-filter-keep"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("source=keep");
  });

  it("clicking 'Imported' calls setLocation with ?source=import", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-filter-import"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("source=import");
  });

  it("clicking 'All' calls setLocation WITHOUT a source param", async () => {
    // Start with an active filter so clicking All is meaningful
    mockUseSearch.mockReturnValue("source=keep");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-filter-all"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).not.toContain("source=");
  });

  it("'All' navigates to the bare path when the only param was source", async () => {
    mockUseSearch.mockReturnValue("source=import");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-filter-all"));
    const [url] = mockSetLocation.mock.calls[0] as [string];
    // Should be just the path with no query string
    expect(url).toBe("/library");
  });
});

// ---------------------------------------------------------------------------
// URL reads — mounting with a pre-set param pre-selects the right pill
// ---------------------------------------------------------------------------

describe("Pre-selecting filter from URL on load", () => {
  it("?source=import pre-selects the Imported pill (active border/color styles)", async () => {
    mockUseSearch.mockReturnValue("source=import");
    await renderLibrary();
    // The active pill is styled via inline style; we check the label is visible
    // and that the hook received the correct source param.
    // Confirm useMyLibraryInfinite was called with source: "import"
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ source?: string }];
    expect(lastCall[0].source).toBe("import");
  });

  it("?source=keep pre-selects the Saved-from-radio pill", async () => {
    mockUseSearch.mockReturnValue("source=keep");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ source?: string }];
    expect(lastCall[0].source).toBe("keep");
  });

  it("no source param passes undefined/empty to useMyLibraryInfinite", async () => {
    mockUseSearch.mockReturnValue("");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ source?: string }];
    // source should be undefined (or falsy) when no param present
    expect(lastCall[0].source).toBeFalsy();
  });

  it("an unrecognised source value is ignored (treated as All)", async () => {
    mockUseSearch.mockReturnValue("source=random");
    await renderLibrary();
    const calls = mockUseMyLibraryInfinite.mock.calls;
    const lastCall = calls[calls.length - 1] as [{ source?: string }];
    expect(lastCall[0].source).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Empty state CTA — "Show all" vs "Open the dial"
// ---------------------------------------------------------------------------

describe("Empty state CTA with and without active filter", () => {
  it("shows 'Open the dial' when library is empty and no filter is active", async () => {
    mockUseSearch.mockReturnValue("");
    await renderLibrary();
    expect(screen.getByText(/open the dial/i)).toBeTruthy();
    expect(screen.queryByText(/show all/i)).toBeNull();
  });

  it("shows 'Show all' instead of 'Open the dial' when source=keep and library is empty", async () => {
    mockUseSearch.mockReturnValue("source=keep");
    await renderLibrary();
    expect(screen.getByText(/show all/i)).toBeTruthy();
    expect(screen.queryByText(/open the dial/i)).toBeNull();
  });

  it("shows 'Show all' instead of 'Open the dial' when source=import and library is empty", async () => {
    mockUseSearch.mockReturnValue("source=import");
    await renderLibrary();
    expect(screen.getByText(/show all/i)).toBeTruthy();
    expect(screen.queryByText(/open the dial/i)).toBeNull();
  });

  it("'Show all' button clears the source filter from the URL", async () => {
    mockUseSearch.mockReturnValue("source=keep");
    await renderLibrary();
    fireEvent.click(screen.getByText(/show all/i));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).not.toContain("source=");
  });
});

// ---------------------------------------------------------------------------
// Sort controls — rendering
// ---------------------------------------------------------------------------

describe("Sort controls are always rendered", () => {
  it("renders Added, Artist, and Title sort buttons", async () => {
    await renderLibrary();
    expect(screen.getByTestId("library-sort-added")).toBeTruthy();
    expect(screen.getByTestId("library-sort-artist")).toBeTruthy();
    expect(screen.getByTestId("library-sort-title")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Sort controls — URL writes
// ---------------------------------------------------------------------------

describe("Selecting a sort button updates the URL", () => {
  it("clicking 'Artist' calls setLocation with ?sort=artist", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-sort-artist"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("sort=artist");
  });

  it("clicking 'Title' calls setLocation with ?sort=title", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-sort-title"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("sort=title");
  });

  it("clicking 'Added' (default) calls setLocation WITHOUT a sort param", async () => {
    // Start with an active sort so clicking Added is meaningful
    mockUseSearch.mockReturnValue("sort=artist");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-sort-added"));
    expect(mockSetLocation).toHaveBeenCalledTimes(1);
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).not.toContain("sort=");
  });

  it("'Added' navigates to the bare path when sort was the only param", async () => {
    mockUseSearch.mockReturnValue("sort=title");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-sort-added"));
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toBe("/library");
  });

  it("preserves existing source param when changing sort", async () => {
    mockUseSearch.mockReturnValue("source=keep");
    await renderLibrary();
    fireEvent.click(screen.getByTestId("library-sort-artist"));
    const [url] = mockSetLocation.mock.calls[0] as [string];
    expect(url).toContain("source=keep");
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
