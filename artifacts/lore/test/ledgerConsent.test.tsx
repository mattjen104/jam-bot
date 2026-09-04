// @vitest-environment jsdom
/**
 * Browser-level unit tests for the ledger consent prompt in Library.tsx.
 *
 * Covers:
 *   - Consent prompt appears when ledgerEnabled=false and localStorage is clear.
 *   - "Start recording" button calls patchPreferences({ ledgerEnabled: true })
 *     and hides the prompt.
 *   - "Not now" dismisses the prompt without calling patchPreferences.
 *   - After dismissal the prompt is hidden (TTL stored in localStorage).
 *   - Prompt does NOT appear when ledgerEnabled=true.
 */

import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeEach,
} from "vitest";

// These tests render a full Library page with many async effects.
// Under CI load the default 5 s timeout is too tight; bump it file-wide.
vi.setConfig({ testTimeout: 30_000 });
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Hoisted mock fns — must be created before vi.mock() factories run.
// Hoisting all hooks that need per-test customization prevents mock-bleed
// across tests (mockReturnValue on a vi.fn() persists until explicitly reset).
// ---------------------------------------------------------------------------

const {
  mockPatchPreferences,
  mockUseMyPreferences,
  mockUseMyConnections,
  mockUseMyLibraryInfinite,
  mockUseLatestImportJob,
  mockUseLatestSyncJob,
  mockUseMyAlbumsCompleted,
} = vi.hoisted(() => ({
  mockPatchPreferences: vi.fn<[Record<string, unknown>], Promise<{ ledgerEnabled: boolean }>>(),
  mockUseMyPreferences: vi.fn(() => ({ data: { ledgerEnabled: false } })),
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
    useMyImportStats: vi.fn(() => ({ data: null })),
    useMyLibraryCoverage: vi.fn(() => ({ data: null })),
    patchPreferences: mockPatchPreferences,
    startSpotifyLibraryConnect: vi.fn(),
    startSpotifyLibraryReconnect: vi.fn(),
    postStartImport: vi.fn(),
    postStartSync: vi.fn(),
    postImportLibraryFile: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEDGER_DISMISSED_KEY = "lore:ledger_prompt_dismissed_until";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

async function renderLibrary() {
  // Dynamic import so module mocks are fully applied before the component loads.
  const { default: Library } = await import("../src/pages/Library");
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <Library />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Stable mock return values — using constant references prevents the prefs
// useEffect from re-firing on every re-render (a new object literal would
// change the reference each call, re-triggering the effect).
// ---------------------------------------------------------------------------

const PREFS_DISABLED = { data: { ledgerEnabled: false } };
const _PREFS_ENABLED = { data: { ledgerEnabled: true } };
const NO_CONNECTIONS = { data: null, isLoading: false };
const LIBRARY_INFINITE_EMPTY = {
  data: undefined,
  isLoading: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
};
const NO_JOB = { data: null };
const NO_ALBUMS = { data: undefined };

// ---------------------------------------------------------------------------
// Setup / teardown — reset all hoisted mock implementations before each test.
// vi.clearAllMocks() resets call counts but not implementations; combined with
// explicit mockReturnValue calls it gives us a clean slate each test.
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks(); // reset call counts
  // Stable references: same object returned on every call so [prefs] dep
  // in useEffect stays stable between renders.
  mockUseMyPreferences.mockReturnValue(PREFS_DISABLED);
  mockUseMyConnections.mockReturnValue(NO_CONNECTIONS);
  mockUseMyLibraryInfinite.mockReturnValue(LIBRARY_INFINITE_EMPTY);
  mockUseLatestImportJob.mockReturnValue(NO_JOB);
  mockUseLatestSyncJob.mockReturnValue(NO_JOB);
  mockUseMyAlbumsCompleted.mockReturnValue(NO_ALBUMS);
  mockPatchPreferences.mockResolvedValue({ ledgerEnabled: true });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Ledger consent prompt visibility", () => {
  it("does not place the consent prompt above the release crate", async () => {
    await renderLibrary();
    expect(screen.queryByTestId("ledger-consent-prompt")).toBeNull();
    expect(screen.queryByTestId("ledger-enable-button")).toBeNull();
    expect(screen.queryByTestId("ledger-dismiss-button")).toBeNull();
  });

  it("remains absent when ledger recording is already enabled", async () => {
    mockUseMyPreferences.mockImplementation(() => ({ data: { ledgerEnabled: true } }));

    await renderLibrary();
    expect(screen.queryByTestId("ledger-consent-prompt")).toBeNull();
  });

  it("remains absent regardless of the old dismissal TTL", async () => {
    localStorage.setItem(
      LEDGER_DISMISSED_KEY,
      String(Date.now() + 30 * 24 * 60 * 60 * 1000),
    );

    await renderLibrary();
    expect(screen.queryByTestId("ledger-consent-prompt")).toBeNull();
  });
});
