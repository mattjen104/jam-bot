// @vitest-environment jsdom
/**
 * Unit tests for LibraryImportBanner covering the fast-path scenario where all
 * tracks are already in the spine (total > 0, resolved === total, phase 3 skipped).
 *
 * Confirms:
 *  - "done" state renders "Library imported" + the matched count
 *  - "done" state does NOT render the stale "Connecting to Spotify…" label
 *  - "done" state does NOT show the in-progress spinner or progress bar
 *  - "running" state with phase="spine" renders "Checking spine…" (not "Connecting to Spotify…")
 *  - "running" state with phase="cache" also renders "Checking spine…"
 *  - "pending" state with no phase shows "Connecting to Spotify…" (correct default)
 *
 * Timer tests (Library page):
 *  - Banner is still visible when < 8 s have elapsed since "done"
 *  - Banner auto-dismisses after the 8 s setTimeout fires
 */
import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LibraryImportBanner } from "../src/pages/Library";
import LibraryPage from "../src/pages/Library";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
}

function renderLibraryPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <LibraryPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted) — only affect Library page render tests.
// LibraryImportBanner is a pure prop-driven component and is unaffected.
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
    useMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
    useMyLibrary: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
    useLatestImportJob: vi.fn(() => ({ data: null })),
    useMyPreferences: vi.fn(() => ({ data: { ledgerEnabled: false } })),
    useMyImportStats: vi.fn(() => ({ data: null })),
    useLatestSyncJob: vi.fn(() => ({ data: null })),
    useMyLibraryCoverage: vi.fn(() => ({ data: null })),
    useMyLibraryInfinite: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    })),
    startSpotifyLibraryConnect: vi.fn(),
    postStartImport: vi.fn(),
    useMyAlbumsCompleted: vi.fn(() => ({ data: undefined })),
  });
});

// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noop = () => {};

describe("LibraryImportBanner — done state (fast-path re-import)", () => {
  it("shows 'Library imported' heading", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/library imported/i)).toBeTruthy();
  });

  it("shows the resolved count", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/120 tracks matched/i)).toBeTruthy();
  });

  it("does NOT show the stale 'Connecting to Spotify…' label", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.queryByText(/connecting to spotify/i)).toBeNull();
  });

  it("does NOT show the in-progress spinner", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    const el = screen.getByTestId("library-import-banner");
    expect(el.innerHTML).not.toContain("animate-spin");
  });

  it("does NOT show the progress bar track", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    const el = screen.getByTestId("library-import-banner");
    expect(el.innerHTML).not.toMatch(/class="h-1 w-full/);
  });

  it("shows dismiss button", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeTruthy();
  });

  it("singular 'track' for resolved=1", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 1, resolved: 1, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/1 track matched/i)).toBeTruthy();
    expect(screen.queryByText(/1 tracks matched/i)).toBeNull();
  });
});

describe("LibraryImportBanner — running phase labels", () => {
  it("phase='spine' shows 'Checking spine…', not 'Connecting to Spotify…'", () => {
    render(
      <LibraryImportBanner
        job={{ status: "running", phase: "spine", total: 80, resolved: 40, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/checking spine/i)).toBeTruthy();
    expect(screen.queryByText(/connecting to spotify/i)).toBeNull();
  });

  it("phase='cache' also shows 'Checking spine…'", () => {
    render(
      <LibraryImportBanner
        job={{ status: "running", phase: "cache", total: 80, resolved: 40, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/checking spine/i)).toBeTruthy();
    expect(screen.queryByText(/connecting to spotify/i)).toBeNull();
  });

  it("phase='resolve' shows 'Resolving new tracks…'", () => {
    render(
      <LibraryImportBanner
        job={{ status: "running", phase: "resolve", total: 80, resolved: 40, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/resolving new tracks/i)).toBeTruthy();
  });

  it("phase='fetching' shows 'Reading your Spotify library…'", () => {
    render(
      <LibraryImportBanner
        job={{ status: "running", phase: "fetching", total: 0, resolved: 0, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/reading your spotify library/i)).toBeTruthy();
  });

  it("null phase (pending) shows 'Connecting to Spotify…'", () => {
    render(
      <LibraryImportBanner
        job={{ status: "pending", phase: null, total: 0, resolved: 0, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/connecting to spotify/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Timer tests — Library page component
//
// These render the full Library page with mocked hooks so we can exercise the
// two useEffect blocks that (a) clear bannerDismissed when a job starts and
// (b) set a 8 000 ms auto-dismiss timer when status reaches "done".
// ---------------------------------------------------------------------------

describe("Library page — import banner auto-dismiss timer", () => {
  const FIXED_NOW = new Date("2026-01-01T12:00:00.000Z");
  const FINISHED_AT = new Date(FIXED_NOW.getTime() - 30_000).toISOString();

  const doneJob = {
    status: "done" as const,
    phase: null,
    total: 120,
    resolved: 120,
    error: null,
    finishedAt: FINISHED_AT,
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    const { useLatestImportJob } = await import("../src/lib/meHooks");
    vi.mocked(useLatestImportJob).mockReturnValue({ data: doneJob } as ReturnType<typeof useLatestImportJob>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the banner before 8 s have elapsed", async () => {
    renderLibraryPage();

    await act(async () => {
      vi.advanceTimersByTime(7_999);
    });

    expect(screen.getByTestId("library-import-banner")).toBeTruthy();
  });

  it("auto-dismisses the banner once 8 s have elapsed", async () => {
    renderLibraryPage();

    expect(screen.getByTestId("library-import-banner")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(8_001);
    });

    expect(screen.queryByTestId("library-import-banner")).toBeNull();
  });
});
