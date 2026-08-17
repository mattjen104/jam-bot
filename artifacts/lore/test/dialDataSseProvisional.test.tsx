// @vitest-environment jsdom
/**
 * Integration tests for the provisional now-playing fast path in useDialData.
 *
 * Drives all three SSE frame types through the shared `subscribeSpinStream`
 * adapter (mocked so we control events directly) into `useDialData` and
 * verifies that the returned `stations[].liveTrack` reflects the correct
 * state after each frame:
 *
 *   spin-raw         → liveTrack shows new artist+title, resolving:true,
 *                      hit flags forced false, artistMbid/releaseYear present
 *   spin-changed     → resolving cleared, accurate hit flags applied
 *   spin-raw-failed  → liveTrack reverts to pre-provisional state
 */
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SpinStreamEvent } from "../src/webplayer/nowPlayingStream";
import { useDialData } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Capture subscribeSpinStream listener via vi.hoisted
// (vi.mock factories are hoisted before module-level const declarations, so
// we need vi.hoisted to share state between the factory and the tests.)
// ---------------------------------------------------------------------------

const listenerRef = vi.hoisted(() => ({
  fn: null as ((ev: SpinStreamEvent) => void) | null,
}));

vi.mock("../src/webplayer/nowPlayingStream", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../src/webplayer/nowPlayingStream")>();
  return {
    ...mod,
    subscribeSpinStream: (fn: (ev: SpinStreamEvent) => void) => {
      listenerRef.fn = fn;
      return () => {
        listenerRef.fn = null;
      };
    },
  };
});

// ---------------------------------------------------------------------------
// Mock @workspace/api-client-react — provide one live station
// ---------------------------------------------------------------------------

const SLUG = "kcrw";
const NOW = new Date().toISOString();

vi.mock("@workspace/api-client-react", () => ({
  useListStations: () => ({
    data: {
      stations: [
        {
          id: 1,
          slug: SLUG,
          name: "KCRW",
          org: "KCRW",
          city: "Santa Monica",
          country: "US",
          streamUrl: "https://stream.kcrw.com/live",
          streamQuality: null,
          streamFormat: "aac",
          mode: "live",
          homepageUrl: "https://www.kcrw.com",
          donateUrl: null,
          logoUrl: null,
          attribution: true,
          tags: null,
          stationCategories: ["anchor"],
          mayHaveAds: false,
          votes: 0,
          clickcount: 0,
          upcomingShowCount: 0,
        },
      ],
    },
    isLoading: false,
    error: null,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
  useListStationsNowPlaying: () => ({
    data: {
      items: [
        {
          slug: SLUG,
          nowPlaying: {
            spinId: 1,
            rawArtist: "Old Artist",
            rawTitle: "Old Track",
            source: "icy",
            confidence: "unresolved",
            playedAt: NOW,
            freshness: "fresh",
            artworkUrl: null,
            recording: null,
            show: { name: "Morning Show", djName: null },
            isFirstSpin: false,
            isLibraryHit: false,
            isArtistHit: false,
          },
        },
      ],
    },
    isLoading: false,
  }),
  useGetStationsSchedule: () => ({ data: { items: [] }, isLoading: false }),
  useGetStationsRecentSpins: () => ({ data: { items: [] }, isLoading: false }),
  useGetStationsArtistFrequency: () => ({ data: { items: [] }, isLoading: false }),
  // Query key factories — not called with arguments that matter in unit tests.
  getListStationsQueryKey: () => ["stations"],
  getListStationsNowPlayingQueryKey: () => ["stations", "now-playing"],
  getGetStationsScheduleQueryKey: () => ["stations", "schedule"],
  getGetStationsRecentSpinsQueryKey: () => ["stations", "recent-spins"],
  getGetStationsArtistFrequencyQueryKey: () => ["stations", "artist-frequency"],
}));

// ---------------------------------------------------------------------------
// Mock personal-taste hooks (meHooks) — anonymous user, nothing to return
// ---------------------------------------------------------------------------

vi.mock("../src/lib/meHooks", () => ({
  useMyPickerNames: () => ({ data: undefined }),
  useMyDialCrossings: () => ({ data: undefined, isLoading: false }),
  useMyBlendedCrossings: () => ({ data: undefined, isLoading: false }),
  // Must return an array (not null) — the hook destructures as `data = []` which
  // only kicks in for undefined, not null. Returning [] directly avoids a
  // "not iterable" crash in the useMemo that builds overlapByPickerId.
  useMyPickerOverlap: () => ({ data: [] }),
}));

// ---------------------------------------------------------------------------
// Mock useAddedStations — no user-added stations
// ---------------------------------------------------------------------------

vi.mock("../src/hooks/useAddedStations", () => ({
  useAddedStations: () => ({ addedStations: [] }),
}));

// ---------------------------------------------------------------------------
// Wrapper (provides QueryClient that hooks may call useQueryClient on)
// ---------------------------------------------------------------------------

function Wrapper({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Push an SSE frame through the captured listener inside act(). */
function push(ev: Partial<SpinStreamEvent> & { stationSlug: string }) {
  act(() => {
    listenerRef.fn?.({
      rawArtist: "",
      rawTitle: "",
      mbid: null,
      ...ev,
    } as SpinStreamEvent);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useDialData — SSE provisional fast path integration", () => {
  beforeEach(() => {
    listenerRef.fn = null;
  });

  it("spin-raw sets resolving:true, forces hit flags false, passes artistMbid+releaseYear", () => {
    const { result } = renderHook(
      () => useDialData("personal", { includeAllStations: true }),
      { wrapper: Wrapper },
    );

    // The subscribeSpinStream listener must be registered by the useEffect.
    expect(listenerRef.fn).not.toBeNull();

    // Initial state: REST-poll baseline, no resolving flag.
    const before = result.current.stations.find((s) => s.station.slug === SLUG);
    expect(before?.liveTrack?.artist).toBe("Old Artist");
    expect(before?.liveTrack?.resolving).toBeFalsy();

    // Deliver a provisional frame.
    push({
      stationSlug: SLUG,
      rawArtist: "New Artist",
      rawTitle: "New Track",
      mbid: null,
      provisional: true,
      type: "spin-raw",
      observedAt: new Date().toISOString(),
      artistMbid: "bb000000-0000-0000-0000-000000000001",
      releaseYear: 2024,
      isFirstSpin: false,
    });

    const after = result.current.stations.find((s) => s.station.slug === SLUG);
    // New track is visible immediately.
    expect(after?.liveTrack?.artist).toBe("New Artist");
    expect(after?.liveTrack?.title).toBe("New Track");
    // Resolving cue is set.
    expect(after?.liveTrack?.resolving).toBe(true);
    // Hit flags must be false — cannot be confirmed before resolution.
    expect(after?.liveTrack?.isLibraryHit).toBe(false);
    expect(after?.liveTrack?.isArtistHit).toBe(false);
    // Artist MBID and release year must flow through the adapter.
    expect(after?.liveTrack?.artistMbid).toBe("bb000000-0000-0000-0000-000000000001");
    expect(after?.liveTrack?.releaseYear).toBe(2024);
  });

  it("spin-changed clears resolving and applies accurate server hit flags", () => {
    const { result } = renderHook(
      () => useDialData("personal", { includeAllStations: true }),
      { wrapper: Wrapper },
    );

    // Step 1 — provisional frame.
    push({
      stationSlug: SLUG,
      rawArtist: "New Artist",
      rawTitle: "New Track",
      mbid: null,
      provisional: true,
      type: "spin-raw",
      observedAt: new Date().toISOString(),
    });
    expect(
      result.current.stations.find((s) => s.station.slug === SLUG)?.liveTrack?.resolving,
    ).toBe(true);

    // Step 2 — resolved frame (spin-changed, no `type` field).
    push({
      stationSlug: SLUG,
      rawArtist: "New Artist",
      rawTitle: "New Track",
      mbid: "aa000000-0000-0000-0000-000000000001",
      isLibraryHit: true,
      isArtistHit: false,
      releaseYear: 2021,
      isFirstSpin: true,
      artistMbid: "bb000000-0000-0000-0000-000000000002",
      observedAt: new Date().toISOString(),
    });

    const resolved = result.current.stations.find((s) => s.station.slug === SLUG);
    // Resolving flag must be cleared.
    expect(resolved?.liveTrack?.resolving).toBeFalsy();
    // MBID and server hit flags are applied.
    expect(resolved?.liveTrack?.mbid).toBe("aa000000-0000-0000-0000-000000000001");
    expect(resolved?.liveTrack?.isLibraryHit).toBe(true);
    // Release year from the SSE payload must be preserved.
    expect(resolved?.liveTrack?.releaseYear).toBe(2021);
  });

  it("spin-raw-failed reverts liveTrack to pre-provisional state", () => {
    const { result } = renderHook(
      () => useDialData("personal", { includeAllStations: true }),
      { wrapper: Wrapper },
    );

    // Step 1 — provisional frame creates a stash of the prior state.
    push({
      stationSlug: SLUG,
      rawArtist: "Ghost Artist",
      rawTitle: "Ghost Track",
      mbid: null,
      provisional: true,
      type: "spin-raw",
      observedAt: new Date().toISOString(),
    });
    expect(
      result.current.stations.find((s) => s.station.slug === SLUG)?.liveTrack?.artist,
    ).toBe("Ghost Artist");

    // Step 2 — failure: the track was never persisted.
    push({
      stationSlug: SLUG,
      rawArtist: "Ghost Artist",
      rawTitle: "Ghost Track",
      mbid: null,
      provisional: false,
      type: "spin-raw-failed",
      observedAt: new Date().toISOString(),
    });

    // After revert the override is removed; the REST-poll baseline (Old Artist)
    // takes over again via nowPlayingBySlug's REST-poll layer.
    const reverted = result.current.stations.find((s) => s.station.slug === SLUG);
    // The ghost artist must no longer appear.
    expect(reverted?.liveTrack?.artist).not.toBe("Ghost Artist");
    // Resolving flag must be gone.
    expect(reverted?.liveTrack?.resolving).toBeFalsy();
  });
});
