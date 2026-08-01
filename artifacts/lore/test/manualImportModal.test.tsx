// @vitest-environment jsdom
/**
 * Unit tests for ManualImportModal — localStorage-based service memory.
 *
 * Confirms:
 *  - A valid stored service id skips the picker and shows the instruction pane.
 *  - An invalid / unknown stored value falls back to the service picker.
 *  - A successful import writes the selected service id to localStorage.
 */
import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ManualImportModal } from "../src/components/ManualImportModal";

// ---------------------------------------------------------------------------
// Hoisted mock fns — created before vi.mock() factory runs.
// ---------------------------------------------------------------------------

const { mockPostStartManualImport } = vi.hoisted(() => ({
  mockPostStartManualImport: vi.fn<[], Promise<void>>(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    postStartManualImport: mockPostStartManualImport,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LAST_SERVICE_KEY = "lore:lastImportService";
const noop = () => {};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
}

function renderModal(onClose: () => void = noop) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ManualImportModal onClose={onClose} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  mockPostStartManualImport.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests: service picker is skipped when a valid value is stored
// ---------------------------------------------------------------------------

describe("ManualImportModal — stored valid service → instruction pane", () => {
  it("shows the instruction pane heading when 'spotify' is stored", () => {
    localStorage.setItem(LAST_SERVICE_KEY, "spotify");
    renderModal();

    expect(screen.getByText(/import from spotify/i)).toBeTruthy();
  });

  it("does NOT show the service picker subtitle when 'spotify' is stored", () => {
    localStorage.setItem(LAST_SERVICE_KEY, "spotify");
    renderModal();

    expect(screen.queryByText(/choose a service/i)).toBeNull();
  });

  it("shows the instruction pane for every valid service id", () => {
    const validIds: Array<[string, RegExp]> = [
      ["spotify", /import from spotify/i],
      ["apple", /import from apple music/i],
      ["tidal", /import from tidal/i],
      ["youtube", /import from youtube music/i],
      ["other", /import from other/i],
    ];

    for (const [id, labelPattern] of validIds) {
      localStorage.setItem(LAST_SERVICE_KEY, id);
      const { unmount } = renderModal();
      expect(screen.getByText(labelPattern)).toBeTruthy();
      expect(screen.queryByText(/choose a service/i)).toBeNull();
      unmount();
      localStorage.clear();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: fallback to picker for invalid or absent stored value
// ---------------------------------------------------------------------------

describe("ManualImportModal — invalid / absent stored value → picker", () => {
  it("shows the service picker when an unknown service id is stored", () => {
    localStorage.setItem(LAST_SERVICE_KEY, "napster");
    renderModal();

    expect(screen.getByText(/choose a service/i)).toBeTruthy();
  });

  it("does NOT show an instruction pane heading when an unknown value is stored", () => {
    localStorage.setItem(LAST_SERVICE_KEY, "napster");
    renderModal();

    // "Import from X" heading should not appear
    expect(screen.queryByText(/import from/i)).toBeNull();
  });

  it("shows the service picker when localStorage is empty", () => {
    renderModal();

    expect(screen.getByText(/choose a service/i)).toBeTruthy();
  });

  it("shows all service buttons in the picker when nothing is stored", () => {
    renderModal();

    // Each service label should appear as a button in the grid
    expect(screen.getByRole("button", { name: /spotify/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /apple music/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Test: successful import writes the service id to localStorage
// ---------------------------------------------------------------------------

describe("ManualImportModal — successful import writes service to localStorage", () => {
  it("writes the service id after a successful import", async () => {
    mockPostStartManualImport.mockResolvedValue(undefined);

    // Pre-select Spotify via localStorage so the modal opens in instruction pane
    localStorage.setItem(LAST_SERVICE_KEY, "spotify");
    const closeSpy = vi.fn();
    renderModal(closeSpy);

    // Paste two valid tracks into the textarea
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: {
        value: "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude",
      },
    });

    // Submit button becomes "Import 2 tracks"
    const submitBtn = await screen.findByRole("button", { name: /import 2 tracks/i });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(closeSpy).toHaveBeenCalledOnce();
    });

    expect(localStorage.getItem(LAST_SERVICE_KEY)).toBe("spotify");
  });

  it("does NOT write to localStorage when the import fails", async () => {
    mockPostStartManualImport.mockRejectedValue(new Error("server error"));

    // Start with no stored service — pick one manually
    renderModal();

    // Click Spotify in the picker
    fireEvent.click(screen.getByRole("button", { name: /spotify/i }));

    // Paste valid tracks
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "Fleetwood Mac – Go Your Own Way" },
    });

    const submitBtn = await screen.findByRole("button", { name: /import 1 tracks/i });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeTruthy();
    });

    // localStorage should still be empty — a failed import must not persist the service
    expect(localStorage.getItem(LAST_SERVICE_KEY)).toBeNull();
  });
});
