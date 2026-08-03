// @vitest-environment jsdom
/**
 * Regression guard for the Library seed-input type-to-add flow.
 *
 * After Task #1189 extracted SeedInput/SeedBar into a shared component and
 * Task #1204 wired that component into the Library's empty-state onboarding
 * section, this test confirms the Library's path works end-to-end:
 *
 *   type artist name → submit → chip appears → remove chip → chip disappears
 *
 * Any missed context dependency (hook wiring, provider, prop threading) in the
 * shared component's new consumer would break one of these steps.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// Stub heavy sub-components not relevant to the seed-input path.
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

describe("Library SeedInput — type-to-add full cycle", () => {
  it("adds a typed artist name as a chip and removes it on the × button", async () => {
    renderLibrary();

    // The seed input renders in the onboarding section (empty library, no seeds).
    const input = screen.getByRole("textbox", { name: "Artist name" });
    fireEvent.change(input, { target: { value: "Radiohead" } });

    // Click Add — triggers optimistic update synchronously.
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // The mutation is called with the new seed list.
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(["Radiohead"]);
    });

    // The chip appears inside SeedBar once visibleSeeds.length > 0.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove Radiohead" })).toBeTruthy();
    });

    // Click the × remove button on the chip.
    fireEvent.click(screen.getByRole("button", { name: "Remove Radiohead" }));

    // The mutation is called with the empty list.
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith([]);
    });

    // The chip is gone.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove Radiohead" })).toBeNull();
    });
  });

  it("submits via Enter keypress as well as the Add button", async () => {
    renderLibrary();

    const input = screen.getByRole("textbox", { name: "Artist name" });
    fireEvent.change(input, { target: { value: "Arcade Fire" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(["Arcade Fire"]);
    });

    // Chip appears after Enter submission.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove Arcade Fire" })).toBeTruthy();
    });
  });

  it("clears the text field immediately after submission", async () => {
    renderLibrary();

    const input = screen.getByRole("textbox", { name: "Artist name" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "LCD Soundsystem" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // SeedInput calls setValue("") synchronously on submit.
    expect(input.value).toBe("");
  });

  it("rolls back the optimistic chip when the mutation fails", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("network error"));
    renderLibrary();

    const input = screen.getByRole("textbox", { name: "Artist name" });
    fireEvent.change(input, { target: { value: "Portishead" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // After the rejection, optimisticSeeds resets to null → falls back to
    // seedArtists (empty []) → the chip must disappear.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove Portishead" })).toBeNull();
    });
  });
});
