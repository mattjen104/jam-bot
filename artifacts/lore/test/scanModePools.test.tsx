// @vitest-environment jsdom
/**
 * Integration test: the Scan lens covers stations that ONLY exist in the
 * sleep / era-genre mode pools — they are intentionally hidden from the
 * default /api/stations list, so Scan must union those pools AND poll the
 * inclusive now-playing variant (?includeModePools=true) to see their tracks.
 *
 * Proves, against the real useDialData + CategoryScanLane wiring:
 *   1. scanStations unions base + ambient + specialist pools (deduped by id).
 *   2. The now-playing poll switches to includeModePools:true while Scan is
 *      active, and stays on the default variant otherwise.
 *   3. A category-exclusive sleep station with a FRESH spin renders on its
 *      category button (artist · station) and tapping tunes that station.
 *   4. A specialist-exclusive station whose last spin is STALE (off air)
 *      shows the "Quiet right now" state — the freshness gate keeps Scan
 *      honest instead of presenting an old track as live.
 */
import React from "react";
import { renderHook, render, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDialData } from "../src/hooks/useDialData";
import { CategoryScanLane } from "../src/components/dial/CategoryScanLane";

// ---------------------------------------------------------------------------
// Captured now-playing params (vi.mock factories hoist above module consts)
// ---------------------------------------------------------------------------

const npParamsRef = vi.hoisted(() => ({
  values: [] as unknown[],
}));

const NOW = Date.now();
const FRESH_ISO = new Date(NOW - 5 * 60 * 1000).toISOString(); // 5 min ago
const STALE_ISO = new Date(NOW - 2 * 60 * 60 * 1000).toISOString(); // 2 h ago

type MockStation = {
  id: number;
  slug: string;
  name: string;
  stationCategories: string[];
  streamUrl: string;
};

function mockStation(
  id: number,
  slug: string,
  name: string,
  category: string,
): MockStation {
  return { id, slug, name, stationCategories: [category], streamUrl: `https://example.invalid/${slug}` };
}

// Base (default list) station, a sleep-only station, an era-genre-only
// station, and one dual-listed station present in BOTH the default list and
// the sleep pool (proves the union dedupes by id).
const BASE_STATION = mockStation(1, "wbar", "WBAR", "campus");
const DUAL_STATION = mockStation(2, "fip", "FIP", "anchor");
const SLEEP_ONLY = mockStation(3, "sleepy-fish", "Sleepy Fish", "ambient");
const SPECIALIST_ONLY = mockStation(4, "era-fm", "Era FM", "specialist");

function npItem(slug: string, rawArtist: string, playedAt: string) {
  return {
    slug,
    nowPlaying: {
      spinId: 1,
      rawArtist,
      rawTitle: "Track",
      source: "icy",
      confidence: "unresolved",
      playedAt,
      freshness: "fresh",
      artworkUrl: null,
      recording: null,
      show: null,
      isFirstSpin: false,
      isLibraryHit: false,
      isArtistHit: false,
    },
  };
}

vi.mock("@workspace/api-client-react", () => ({
  // Param-aware: each pool answers only its own mode request.
  useListStations: (params?: { mode?: string }) => ({
    data: {
      stations:
        params?.mode === "sleep"
          ? [DUAL_STATION, SLEEP_ONLY]
          : params?.mode === "era-genre"
          ? [SPECIALIST_ONLY]
          : [BASE_STATION, DUAL_STATION],
    },
    isLoading: false,
    error: null,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
  useListStationsNowPlaying: (params?: unknown) => {
    npParamsRef.values.push(params);
    return {
      data: {
        items: [
          npItem("wbar", "Campus Artist", FRESH_ISO),
          npItem("sleepy-fish", "Sleepy Artist", FRESH_ISO),
          // Off-air specialist station: last spin 2h ago must NOT show as live.
          npItem("era-fm", "Era Artist", STALE_ISO),
        ],
      },
      isLoading: false,
    };
  },
  useGetStationsSchedule: () => ({ data: { items: [] }, isLoading: false }),
  useGetStationsRecentSpins: () => ({ data: { items: [] }, isLoading: false }),
  useGetStationsArtistFrequency: () => ({ data: { items: [] }, isLoading: false }),
  getListStationsQueryKey: () => ["stations"],
  getListStationsNowPlayingQueryKey: () => ["stations", "now-playing"],
  getGetStationsScheduleQueryKey: () => ["stations", "schedule"],
  getGetStationsRecentSpinsQueryKey: () => ["stations", "recent-spins"],
  getGetStationsArtistFrequencyQueryKey: () => ["stations", "artist-frequency"],
}));

vi.mock("../src/webplayer/nowPlayingStream", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../src/webplayer/nowPlayingStream")>();
  return { ...mod, subscribeSpinStream: () => () => {} };
});

vi.mock("../src/lib/meHooks", () => ({
  useMyPickerNames: () => ({ data: undefined }),
  useMyDialCrossings: () => ({ data: undefined, isLoading: false }),
  useMyBlendedCrossings: () => ({ data: undefined, isLoading: false }),
  useMyPickerOverlap: () => ({ data: [] }),
}));

vi.mock("../src/hooks/useAddedStations", () => ({
  useAddedStations: () => ({ addedStations: [] }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// No vitest globals here → testing-library auto-cleanup is off; without it
// each test's render container lingers and later queries see duplicates.
afterEach(cleanup);

describe("Scan lens — mode-pool coverage", () => {
  it("unions base + ambient + specialist pools into scanStations, deduped by id", () => {
    const { result } = renderHook(
      () => useDialData("personal", { includeAllStations: true, scanActive: true }),
      { wrapper: Wrapper },
    );
    const slugs = result.current.scanStations.map((s) => s.slug);
    expect(slugs).toContain("wbar");
    expect(slugs).toContain("sleepy-fish");
    expect(slugs).toContain("era-fm");
    // Dual-listed station appears exactly once.
    expect(slugs.filter((s) => s === "fip")).toHaveLength(1);
  });

  it("polls the inclusive now-playing variant only while Scan is active", () => {
    npParamsRef.values.length = 0;
    const { unmount } = renderHook(
      () => useDialData("personal", { includeAllStations: true, scanActive: true }),
      { wrapper: Wrapper },
    );
    expect(npParamsRef.values.at(-1)).toEqual({ includeModePools: true });
    unmount();

    npParamsRef.values.length = 0;
    renderHook(() => useDialData("personal", { includeAllStations: true }), {
      wrapper: Wrapper,
    });
    expect(npParamsRef.values.at(-1)).toBeUndefined();
  });

  it("gates pool now-playing by freshness: fresh sleep spin in, stale specialist spin out", () => {
    const { result } = renderHook(
      () => useDialData("personal", { includeAllStations: true, scanActive: true }),
      { wrapper: Wrapper },
    );
    const np = result.current.scanNowPlaying;
    expect(np.get("sleepy-fish")?.artist).toBe("Sleepy Artist");
    // Source timestamp preserved (not replaced by a ~now display stamp).
    expect(np.get("sleepy-fish")?.playedAt).toBe(FRESH_ISO);
    expect(np.has("era-fm")).toBe(false);
  });

  it("renders category-exclusive pool stations and tunes the displayed one", () => {
    const { result } = renderHook(
      () => useDialData("personal", { includeAllStations: true, scanActive: true }),
      { wrapper: Wrapper },
    );
    const tuned: string[] = [];
    const lane = render(
      <CategoryScanLane
        stations={result.current.scanStations}
        nowPlayingBySlug={result.current.scanNowPlaying}
        activeSlug={null}
        onTuneIn={(slug) => tuned.push(slug)}
      />,
      { wrapper: Wrapper },
    );

    // Ambient & Sleep button shows the fresh pool-exclusive spin and tunes it.
    const ambientBtn = lane
      .getByText("Ambient & Sleep")
      .closest("button")!;
    expect(ambientBtn.textContent).toContain("Sleepy Artist");
    expect(ambientBtn.textContent).toContain("Sleepy Fish");
    expect(ambientBtn.textContent).toContain("1 live");
    fireEvent.click(ambientBtn);
    expect(tuned).toEqual(["sleepy-fish"]);

    // Specialist button: the only station's spin is stale → honest quiet state,
    // disabled rather than presenting a 2-hour-old track as live.
    const specialistBtn = lane.getByText("Specialist Radio").closest("button")!;
    expect(specialistBtn.textContent).toContain("Quiet right now");
    expect(specialistBtn.textContent).toContain("0 live");
    expect(specialistBtn.disabled).toBe(true);
  });
});
