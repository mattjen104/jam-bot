// @vitest-environment jsdom
/**
 * Integration tests for the Spotify auto-import logic in Library.tsx.
 *
 * Confirms that when useMyConnections data transitions from no-Spotify to
 * has-Spotify (the false→true transition that happens after a successful OAuth
 * redirect), the Library page calls postStartImport("spotify") automatically
 * without requiring a button click — and does NOT open a modal.
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
  mockPostStartImport,
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
  mockPostStartImport: vi.fn(() => Promise.resolve({ jobId: 42, status: "pending" })),
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
    postStartImport: mockPostStartImport,
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

describe("Library — Spotify auto-import after OAuth connect", () => {
  it("does NOT start an import on initial load when Spotify was never connected", async () => {
    mockUseMyConnections.mockReturnValue(NO_CONNECTIONS);

    await renderLibrary();

    expect(mockPostStartImport).not.toHaveBeenCalled();
    // No modal either
    expect(screen.queryByTestId("service-picker")).toBeNull();
    expect(screen.queryByText("Connect Spotify")).toBeNull();
  });

  it("calls postStartImport('spotify') automatically when connections transitions from no-Spotify to has-Spotify", async () => {
    // First render: no Spotify connection
    mockUseMyConnections.mockReturnValue(NO_CONNECTIONS);

    const { rerender, qc } = await renderLibrary();

    // Confirm no import started yet
    expect(mockPostStartImport).not.toHaveBeenCalled();

    // Simulate the OAuth callback: connections data gains the Spotify entry
    mockUseMyConnections.mockReturnValue(HAS_SPOTIFY);

    const { default: Library } = await import("../src/pages/Library");
    await act(async () => {
      rerender(
        <QueryClientProvider client={qc}>
          <Library />
        </QueryClientProvider>,
      );
    });

    // Import must start automatically — no button click needed
    await waitFor(() => {
      expect(mockPostStartImport).toHaveBeenCalledWith("spotify");
    });

    // The modal must NOT open (progress is shown via the ImportStrip banner)
    expect(screen.queryByTestId("service-picker")).toBeNull();
    expect(screen.queryByText("Connect Spotify")).toBeNull();
  });

  it("does NOT start an import when Spotify was already connected on first load", async () => {
    // Spotify present from the very first render — no transition, no auto-import
    mockUseMyConnections.mockReturnValue(HAS_SPOTIFY);

    await renderLibrary();

    // No auto-import (first resolution with Spotify is not a transition)
    expect(mockPostStartImport).not.toHaveBeenCalled();
    expect(screen.queryByText("Connect Spotify")).toBeNull();
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });

  it("does NOT start an import while connections are still loading", async () => {
    // Loading state — effect must be suppressed
    mockUseMyConnections.mockReturnValue({ data: undefined, isLoading: true });

    await renderLibrary();

    expect(mockPostStartImport).not.toHaveBeenCalled();
    expect(screen.queryByText("Connect Spotify")).toBeNull();
  });
});
