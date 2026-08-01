// @vitest-environment jsdom
/**
 * Tests for the "X of Y from Spotify matched" stat in the Library hero section.
 *
 * The stat reads live library counts from `useMyImportStats` instead of the
 * frozen `resolved` field on the import job, so a retry pass that resolves
 * more tracks is reflected immediately without a re-import.
 *
 * Confirms:
 *  - After a retry pass the displayed resolved count matches the live library
 *    count (importStats.total - importStats.softCount), NOT jobData.resolved.
 *  - The stat is hidden when importStats has not loaded yet (null).
 *  - The stat is hidden when importStats.total is 0.
 */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LibraryPage from "../src/pages/Library";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before imports)
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

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    useGetPickersDial: vi.fn(() => ({ data: null })),
  });
});

vi.mock("../src/lib/local", () => ({
  useFollows: vi.fn(() => []),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyConnections: vi.fn(() => ({
      data: [{ service: "spotify", canWrite: true, connectedAt: "2026-01-01T00:00:00Z", lastImportAt: null }],
      isLoading: false,
    })),
    useMyPreferences: vi.fn(() => ({ data: { ledgerEnabled: false } })),
    useMyLibraryInfinite: vi.fn(() => ({
      data: { pages: [{ items: [], nextCursor: null, total: 0, keepCount: 0, softCount: 0 }] },
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
    })),
    useMyImportStats: vi.fn(() => ({ data: null })),
    useLatestImportJob: vi.fn(() => ({ data: null })),
    useLatestSyncJob: vi.fn(() => ({ data: null })),
    useMyLibraryCoverage: vi.fn(() => ({ data: null })),
    useMyAlbumsCompleted: vi.fn(() => ({ data: undefined })),
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
}

function renderLibraryPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <LibraryPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Stat section — retry pass resolves more tracks
// ---------------------------------------------------------------------------

describe("Library hero — matched-count stat after retry pass", () => {
  it("displays the live library resolved count, not the frozen job resolved count", async () => {
    const { useLatestImportJob, useMyImportStats } = await import("../src/lib/meHooks");

    // The import job finished with 150 resolved (frozen at import time).
    vi.mocked(useLatestImportJob).mockReturnValue({
      data: {
        jobId: 1,
        service: "spotify",
        status: "done",
        phase: null,
        total: 200,
        resolved: 150, // frozen — stale after retry pass
        startedAt: "2026-01-01T10:00:00Z",
        finishedAt: "2026-01-01T10:05:00Z",
        error: null,
        resumedFrom: null,
      },
    } as ReturnType<typeof useLatestImportJob>);

    // After the retry pass the live library has 190 matched (only 10 still soft).
    vi.mocked(useMyImportStats).mockReturnValue({
      data: { total: 200, softCount: 10 },
    } as ReturnType<typeof useMyImportStats>);

    renderLibraryPage();

    // The stat should read "190 of 200 from Spotify matched" — live count.
    const stat = screen.getByText(/of 200 from spotify matched/i);
    expect(stat).toBeTruthy();

    // The live resolved count (190) must appear, not the frozen job value (150).
    expect(stat.textContent).toContain("190");
    expect(stat.textContent).not.toContain("150");
  });

  it("displays the correct count when the retry pass resolved all remaining tracks", async () => {
    const { useLatestImportJob, useMyImportStats } = await import("../src/lib/meHooks");

    vi.mocked(useLatestImportJob).mockReturnValue({
      data: {
        jobId: 2,
        service: "spotify",
        status: "done",
        phase: null,
        total: 100,
        resolved: 80, // frozen
        startedAt: "2026-01-01T08:00:00Z",
        finishedAt: "2026-01-01T08:03:00Z",
        error: null,
        resumedFrom: null,
      },
    } as ReturnType<typeof useLatestImportJob>);

    // Retry resolved everything: softCount = 0.
    vi.mocked(useMyImportStats).mockReturnValue({
      data: { total: 100, softCount: 0 },
    } as ReturnType<typeof useMyImportStats>);

    renderLibraryPage();

    const stat = screen.getByText(/of 100 from spotify matched/i);
    expect(stat).toBeTruthy();
    expect(stat.textContent).toContain("100");
    expect(stat.textContent).not.toContain("80");
  });
});

// ---------------------------------------------------------------------------
// Edge case — importStats not yet loaded
// ---------------------------------------------------------------------------

describe("Library hero — matched-count stat with missing importStats", () => {
  it("shows nothing when importStats has not loaded yet (null)", async () => {
    const { useLatestImportJob, useMyImportStats } = await import("../src/lib/meHooks");

    vi.mocked(useLatestImportJob).mockReturnValue({
      data: {
        jobId: 3,
        service: "spotify",
        status: "done",
        phase: null,
        total: 200,
        resolved: 150,
        startedAt: "2026-01-01T10:00:00Z",
        finishedAt: "2026-01-01T10:05:00Z",
        error: null,
        resumedFrom: null,
      },
    } as ReturnType<typeof useLatestImportJob>);

    // importStats not yet loaded.
    vi.mocked(useMyImportStats).mockReturnValue({
      data: null,
    } as ReturnType<typeof useMyImportStats>);

    renderLibraryPage();

    // No "from Spotify matched" stat should appear.
    expect(screen.queryByText(/from spotify matched/i)).toBeNull();
  });

  it("shows nothing when importStats.total is 0", async () => {
    const { useLatestImportJob, useMyImportStats } = await import("../src/lib/meHooks");

    vi.mocked(useLatestImportJob).mockReturnValue({
      data: {
        jobId: 4,
        service: "spotify",
        status: "done",
        phase: null,
        total: 0,
        resolved: 0,
        startedAt: "2026-01-01T10:00:00Z",
        finishedAt: "2026-01-01T10:05:00Z",
        error: null,
        resumedFrom: null,
      },
    } as ReturnType<typeof useLatestImportJob>);

    vi.mocked(useMyImportStats).mockReturnValue({
      data: { total: 0, softCount: 0 },
    } as ReturnType<typeof useMyImportStats>);

    renderLibraryPage();

    expect(screen.queryByText(/from spotify matched/i)).toBeNull();
  });
});
