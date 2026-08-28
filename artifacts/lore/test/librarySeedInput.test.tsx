// @vitest-environment jsdom
/**
 * Regression guard for the Library artist-seed experience.
 *
 * After the top add-artist banner was removed from the Library page, this
 * test confirms:
 *   - The top `library-seed-section` banner is NOT rendered.
 *   - The "Add music" button (library-import-open) remains as the primary
 *     entry point for the artist-seed / import flow via the modal.
 *
 * The underlying seed hooks, mutation logic, and ManualImportModal behavior
 * are exercised by their own suites; this test focuses only on what the
 * Library page itself renders.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module-level mocks — must precede all imports of the subjects.
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

const { tasteSeeds, mutateAsync } = vi.hoisted(() => ({
  tasteSeeds: vi.fn(() => ({ data: [] as string[] })),
  mutateAsync: vi.fn(async (artists: string[]) => ({ artists })),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
    useMyLibraryInfinite: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    })),
    useMyImportStats: vi.fn(() => ({ data: null })),
    useLatestImportJob: vi.fn(() => ({ data: null })),
    useLatestSyncJob: vi.fn(() => ({ data: null })),
    useMyPreferences: vi.fn(() => ({ data: { ledgerEnabled: true } })),
    useMyLibraryCoverage: vi.fn(() => ({ data: [] })),
    useMyTasteSeeds: tasteSeeds,
    useSetTasteSeeds: vi.fn(() => ({ mutateAsync })),
  });
});

// Stub heavy sub-components not relevant to this test.
vi.mock("../src/components/SearchOverlay", () => ({ SearchOverlay: () => null }));
vi.mock("../src/components/ManualImportModal", () => ({ ManualImportModal: () => null }));
vi.mock("../src/components/YourWeekCard", () => ({ YourWeekCard: () => null }));
vi.mock("../src/components/LibraryRow", () => ({ LibraryRow: () => null }));
vi.mock("../src/components/KeepButton", () => ({ KeepButton: () => null }));

// ---------------------------------------------------------------------------
// Subject imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import LibraryPage from "../src/pages/Library";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
}

function renderLibrary() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <LibraryPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  tasteSeeds.mockReturnValue({ data: [] });
  mutateAsync.mockImplementation(async (artists: string[]) => ({ artists }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Library top add-artist banner", () => {
  it("does not render the top seed section banner", () => {
    renderLibrary();

    // The top seed section must be absent — it was the topmost add-artist CTA.
    expect(
      document.querySelector("[data-testid='library-seed-section']"),
    ).toBeNull();

    // Neither the seed prompt nor any artist-name textbox should appear at the
    // top level of the Library page.
    expect(
      document.querySelector("[data-testid='library-seed-prompt']"),
    ).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Artist name" }),
    ).toBeNull();
  });

  it("keeps Add music inside the empty crate instead of above it", () => {
    renderLibrary();

    expect(screen.queryByTestId("library-import-open")).toBeNull();
    expect(screen.getByTestId("library-import-cta")).toBeTruthy();
  });
});
