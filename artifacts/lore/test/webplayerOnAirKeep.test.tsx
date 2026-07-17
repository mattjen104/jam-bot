// @vitest-environment jsdom
/**
 * Component tests for the On the Air keep flow and LibraryTab paging.
 *
 * OnAirRow / OnAirKeep:
 *  - keep control renders only when authenticated AND the now-playing spin is
 *    resolved with an mbid
 *  - clicking keep flips the control to the kept check and invalidates the
 *    batched ["wp", "lore-counts"] queries
 *  - a now-playing mbid change on the same station row remounts OnAirKeep
 *    (key={mbid}) so the optimistic justKept flag resets to not-kept — unless
 *    the server-derived keptSince says the new track is in the library
 *
 * LibraryTab:
 *  - Load more appends the next page's rows
 *  - when there is no next page the footer shows "that's everything"
 */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WebPlayer from "../src/webplayer/WebPlayer";
import { LibraryTab } from "../src/webplayer/LibraryTab";
import { useWpOnAir, useWpLoreCounts, type WpOnAirItem } from "../src/webplayer/hooks";
import {
  useIsAuthenticated,
  useMyLibraryInfinite,
  useMutationKeep,
  type LibraryItem,
} from "../src/lib/meHooks";

vi.mock("../src/webplayer/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/webplayer/hooks")>();
  return {
    ...actual,
    useWpOnAir: vi.fn(() => ({ data: undefined, isLoading: true, dataUpdatedAt: 0 })),
    useWpLoreCounts: vi.fn(() => ({ data: undefined })),
    useWpRecordingSpins: vi.fn(() => ({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    })),
  };
});

vi.mock("../src/lib/meHooks", () => ({
  useMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
  useIsAuthenticated: vi.fn(() => true),
  useMyKeepStatus: vi.fn(() => ({ data: new Set() })),
  useMutationKeep: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useMutationUnkeep: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useMyLibraryInfinite: vi.fn(() => ({
    data: undefined,
    isLoading: true,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  })),
  useLatestImportJob: vi.fn(() => ({ data: undefined })),
  startSpotifyLibraryConnect: vi.fn(),
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: vi.fn(() => ({
    radio: { station: null, status: "idle", toggle: vi.fn() },
  })),
}));

// jsdom has no IntersectionObserver (LibraryTab's auto-load sentinel).
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).IntersectionObserver = NoopObserver;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrap(ui: React.ReactElement, qc?: QueryClient) {
  const client =
    qc ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const onAirItem = (over: Partial<WpOnAirItem["now"]> = {}): WpOnAirItem => ({
  station: { slug: "kutx", name: "KUTX" } as WpOnAirItem["station"],
  show: { name: "Left of the Dial", djName: "Rae" },
  now: {
    mbid: "mbid-1",
    title: "Dreams",
    artist: "Fleetwood Mac",
    artworkUrl: null,
    playedAt: "2026-07-16T20:00:00.000Z",
    resolved: true,
    ...over,
  },
  earlier: [],
  matchCount: 3,
});

function mockOnAir(items: WpOnAirItem[], authenticated: boolean) {
  vi.mocked(useWpOnAir).mockReturnValue({
    data: { items, authenticated },
    isLoading: false,
    dataUpdatedAt: Date.now(),
  } as unknown as ReturnType<typeof useWpOnAir>);
}

describe("OnAirKeep visibility", () => {
  it("renders the keep button when authenticated with a resolved mbid", () => {
    mockOnAir([onAirItem()], true);
    wrap(<WebPlayer />);
    expect(screen.getByTestId("wp-onair-keep-mbid-1")).toBeTruthy();
  });

  it("does not render when anonymous", () => {
    mockOnAir([onAirItem()], false);
    vi.mocked(useIsAuthenticated).mockReturnValueOnce(false);
    wrap(<WebPlayer />);
    expect(screen.queryByTestId("wp-onair-keep-mbid-1")).toBeNull();
  });

  it("does not render when the spin has no mbid", () => {
    mockOnAir([onAirItem({ mbid: null })], true);
    wrap(<WebPlayer />);
    expect(screen.queryByTestId(/wp-onair-keep/)).toBeNull();
  });

  it("does not render when the spin is unresolved", () => {
    mockOnAir([onAirItem({ resolved: false })], true);
    wrap(<WebPlayer />);
    expect(screen.queryByTestId("wp-onair-keep-mbid-1")).toBeNull();
  });
});

describe("OnAirKeep keep flow", () => {
  it("flips to kept on success and invalidates lore-counts", () => {
    mockOnAir([onAirItem()], true);
    const mutate = vi.fn(
      (
        _vars: unknown,
        opts?: { onSuccess?: () => void },
      ) => opts?.onSuccess?.(),
    );
    vi.mocked(useMutationKeep).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useMutationKeep>);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    });
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    wrap(<WebPlayer />, qc);
    fireEvent.click(screen.getByTestId("wp-onair-keep-mbid-1"));

    expect(mutate).toHaveBeenCalledWith(
      { mbid: "mbid-1", provenance: { kind: "station", stationSlug: "kutx" } },
      expect.anything(),
    );
    expect(screen.getByTestId("wp-onair-kept-mbid-1")).toBeTruthy();
    expect(screen.queryByTestId("wp-onair-keep-mbid-1")).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["wp", "lore-counts"] });
  });

  it("resets to not-kept when the station's now-playing mbid changes", () => {
    mockOnAir([onAirItem()], true);
    const mutate = vi.fn(
      (
        _vars: unknown,
        opts?: { onSuccess?: () => void },
      ) => opts?.onSuccess?.(),
    );
    vi.mocked(useMutationKeep).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useMutationKeep>);

    const { rerender } = wrap(<WebPlayer />);
    fireEvent.click(screen.getByTestId("wp-onair-keep-mbid-1"));
    expect(screen.getByTestId("wp-onair-kept-mbid-1")).toBeTruthy();

    // Same station row, new track: key={mbid} remounts OnAirKeep so the
    // optimistic flag does not leak onto the next track.
    mockOnAir([onAirItem({ mbid: "mbid-2", title: "Gold Dust Woman" })], true);
    rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
        }
      >
        <WebPlayer />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("wp-onair-keep-mbid-2")).toBeTruthy();
    expect(screen.queryByTestId("wp-onair-kept-mbid-2")).toBeNull();
  });

  it("stays kept across an mbid change when the server says the new track is kept", () => {
    mockOnAir([onAirItem()], true);
    const { rerender } = wrap(<WebPlayer />);
    expect(screen.getByTestId("wp-onair-keep-mbid-1")).toBeTruthy();

    mockOnAir([onAirItem({ mbid: "mbid-2" })], true);
    vi.mocked(useWpLoreCounts).mockReturnValue({
      data: new Map([
        [
          "mbid-2",
          { mbid: "mbid-2", artifactCount: 0, listCount: 0, keptSince: "2026-07-01T00:00:00Z" },
        ],
      ]),
    } as unknown as ReturnType<typeof useWpLoreCounts>);
    rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
        }
      >
        <WebPlayer />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("wp-onair-kept-mbid-2")).toBeTruthy();
    expect(screen.queryByTestId("wp-onair-keep-mbid-2")).toBeNull();
  });
});

const libItem = (mbid: string, title: string): LibraryItem =>
  ({
    mbid,
    addedAt: "2026-07-10T00:00:00.000Z",
    provenance: { kind: "station", stationSlug: "kutx", service: null },
    recording: {
      mbid,
      title,
      artist: "Artist",
      albumTitle: null,
      artworkUrl: null,
      spotifyUrl: null,
    },
  }) as unknown as LibraryItem;

describe("LibraryTab paging", () => {
  it("Load more appends the next page", () => {
    const fetchNextPage = vi.fn();
    vi.mocked(useMyLibraryInfinite).mockReturnValue({
      data: { pages: [{ items: [libItem("m1", "One")], nextCursor: "c1" }] },
      isLoading: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    } as unknown as ReturnType<typeof useMyLibraryInfinite>);

    const { rerender } = wrap(
      <LibraryTab onOpenLore={() => {}} onOpenRun={() => {}} />,
    );
    expect(screen.getByTestId("wp-library-m1")).toBeTruthy();
    expect(screen.getByTestId("wp-library-footer").textContent).toContain("1 loaded");

    fireEvent.click(screen.getByTestId("wp-library-load-more"));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    // Next page arrives: both pages render, still more available.
    vi.mocked(useMyLibraryInfinite).mockReturnValue({
      data: {
        pages: [
          { items: [libItem("m1", "One")], nextCursor: "c1" },
          { items: [libItem("m2", "Two")], nextCursor: "c2" },
        ],
      },
      isLoading: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    } as unknown as ReturnType<typeof useMyLibraryInfinite>);
    rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
        }
      >
        <LibraryTab onOpenLore={() => {}} onOpenRun={() => {}} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("wp-library-m1")).toBeTruthy();
    expect(screen.getByTestId("wp-library-m2")).toBeTruthy();
    expect(screen.getByTestId("wp-library-footer").textContent).toContain("2 loaded");
    expect(screen.getByTestId("wp-library-load-more")).toBeTruthy();
  });

  it("shows \"that's everything\" at the end of the library", () => {
    vi.mocked(useMyLibraryInfinite).mockReturnValue({
      data: {
        pages: [{ items: [libItem("m1", "One"), libItem("m2", "Two")], nextCursor: null }],
      },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useMyLibraryInfinite>);

    wrap(<LibraryTab onOpenLore={() => {}} onOpenRun={() => {}} />);
    expect(screen.queryByTestId("wp-library-load-more")).toBeNull();
    expect(screen.getByText("that's everything")).toBeTruthy();
    expect(screen.getByTestId("wp-library-footer").textContent).toContain("2 loaded");
  });
});
