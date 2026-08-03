// @vitest-environment jsdom
/**
 * Integration tests for the Spotify auto-reopen logic in Library.tsx.
 *
 * Confirms that when useMyConnections data transitions from no-Spotify to
 * has-Spotify (the false→true transition that happens after a successful OAuth
 * redirect), the Library page opens the ManualImportModal directly at the
 * Spotify service-guide screen — not the service-picker.
 *
 * Observable signals:
 *   - data-testid="service-picker" is NOT rendered (not the picker screen)
 *   - "Connect Spotify" heading IS rendered (Spotify service-guide screen)
 */

import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Hoisted mock fns — created before vi.mock() factories run
// ---------------------------------------------------------------------------

const {
  mockUseMyConnections,
  mockUseMyPreferences,
  mockUseMyLibraryInfinite,
  mockUseLatestImportJob,
  mockUseLatestSyncJob,
  mockUseMyAlbumsCompleted,
  mockUseMyImportStats,
  mockUseMyLibraryCoverage,
} = vi.hoisted(() => ({
  mockUseMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
  mockUseMyPreferences: vi.fn(() => ({ data: { ledgerEnabled: true } })),
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
  mockUseMyImportStats: vi.fn(() => ({ data: null })),
  mockUseMyLibraryCoverage: vi.fn(() => ({ data: null })),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: vi.fn(() => ["/library", vi.fn()]),
  useSearch: vi.fn(() => ""),
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
    useMyImportStats: mockUseMyImportStats,
    useMyLibraryCoverage: mockUseMyLibraryCoverage,
    patchPreferences: vi.fn(),
    startSpotifyLibraryConnect: vi.fn(),
    startSpotifyLibraryReconnect: vi.fn(),
    postStartImport: vi.fn(),
    postStartSync: vi.fn(),
    postImportLibraryFile: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Stable mock values
// ---------------------------------------------------------------------------

const NO_CONNECTIONS = { data: [] as { service: string; canWrite: boolean; connectedAt: string; lastImportAt: string | null }[], isLoading: false };
const HAS_SPOTIFY = {
  data: [{ service: "spotify", canWrite: false, connectedAt: "2026-08-01T00:00:00Z", lastImportAt: null }],
  isLoading: false,
};
const LIBRARY_INFINITE_EMPTY = {
  data: undefined,
  isLoading: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
};
const NO_JOB = { data: null };
const NO_ALBUMS = { data: undefined };
const PREFS_LEDGER_ENABLED = { data: { ledgerEnabled: true } };

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockUseMyPreferences.mockReturnValue(PREFS_LEDGER_ENABLED);
  mockUseMyLibraryInfinite.mockReturnValue(LIBRARY_INFINITE_EMPTY);
  mockUseLatestImportJob.mockReturnValue(NO_JOB);
  mockUseLatestSyncJob.mockReturnValue(NO_JOB);
  mockUseMyAlbumsCompleted.mockReturnValue(NO_ALBUMS);
  mockUseMyImportStats.mockReturnValue({ data: null });
  mockUseMyLibraryCoverage.mockReturnValue({ data: null });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderLibrary() {
  const { default: Library } = await import("../src/pages/Library");
  const qc = makeQueryClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <Library />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Library — Spotify auto-reopen after OAuth connect", () => {
  it("does NOT open the import modal on initial load when Spotify was never connected", async () => {
    mockUseMyConnections.mockReturnValue(NO_CONNECTIONS);

    await renderLibrary();

    // Modal should not be present at all
    expect(screen.queryByTestId("service-picker")).toBeNull();
    expect(screen.queryByText("Connect Spotify")).toBeNull();
  });

  it("opens the modal at the Spotify guide when connections transitions from no-Spotify to has-Spotify", async () => {
    // First render: no Spotify connection
    mockUseMyConnections.mockReturnValue(NO_CONNECTIONS);

    const { rerender, qc } = await renderLibrary();

    // Now simulate the OAuth callback: connections data gains the Spotify entry
    mockUseMyConnections.mockReturnValue(HAS_SPOTIFY);

    const { default: Library } = await import("../src/pages/Library");
    await act(async () => {
      rerender(
        <QueryClientProvider client={qc}>
          <Library />
        </QueryClientProvider>,
      );
    });

    // The modal must be open at the Spotify service-guide, not the picker
    await waitFor(() => {
      expect(screen.queryByTestId("service-picker")).toBeNull();
      expect(screen.getByText("Connect Spotify")).toBeTruthy();
    });
  });

  it("does NOT open the modal when Spotify was already connected on first load", async () => {
    // Spotify present from the very first render — no transition, no reopen
    mockUseMyConnections.mockReturnValue(HAS_SPOTIFY);

    await renderLibrary();

    // No modal should open (first resolution with Spotify is not a transition)
    expect(screen.queryByText("Connect Spotify")).toBeNull();
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });

  it("does NOT open the modal while connections are still loading", async () => {
    // Loading state — effect must be suppressed
    mockUseMyConnections.mockReturnValue({ data: undefined, isLoading: true });

    await renderLibrary();

    expect(screen.queryByText("Connect Spotify")).toBeNull();
  });
});
