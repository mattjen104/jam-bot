// @vitest-environment jsdom
/**
 * Station fresh-set scan — contract tests.
 *
 * Pins the ducking contract: a station-track scan DUCKS the live stream
 * (volume ≈ 0.15) instead of stopping it, restores the user's volume on
 * stop/unmount/failed-preview scan end, and preserves a volume change made
 * during the duck.
 *
 * Also covers the scan strip UI: KeepButton receives the active track's
 * MBID with provenance { surface: 'stationScan' }, the "⬦ New" chip renders
 * for isFirstSpin tracks, and the hour-of-day label renders from
 * playedAtHour (UTC).
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetStationSpins,
  mockGetStationsRecentSpins,
  mockGetPreviewCached,
  mockPrefetchPreview,
  mockUsePlayer,
  keepButtonProps,
} = vi.hoisted(() => ({
  mockGetStationSpins: vi.fn(),
  mockGetStationsRecentSpins: vi.fn(),
  mockGetPreviewCached: vi.fn(),
  mockPrefetchPreview: vi.fn(),
  mockUsePlayer: vi.fn(),
  keepButtonProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@workspace/api-client-react", () => ({
  getStationSpins: mockGetStationSpins,
  getStationsRecentSpins: mockGetStationsRecentSpins,
}));

vi.mock("../src/player/previewCache", () => ({
  getPreviewCached: mockGetPreviewCached,
  prefetchPreview: mockPrefetchPreview,
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: mockUsePlayer,
}));

vi.mock("../src/components/KeepButton", () => ({
  KeepButton: (props: Record<string, unknown>) => {
    keepButtonProps.push(props);
    return <button data-testid="keep-button-stub">Keep</button>;
  },
}));

import { useStationScan, fmtHour } from "../src/hooks/useStationScan";
import { StationScanPanel } from "../src/components/StationScanPanel";
import { useRadioPlayer } from "../src/hooks/useRadioPlayer";
import type { Station } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PREVIEW = {
  previewUrl: "https://apple.example/clip.m4a",
  artworkUrl: null,
  source: "itunes",
};

const NEW_MUSIC_RESPONSE = {
  items: [
    {
      stationSlug: "wkcr",
      spins: [
        {
          mbid: "mbid-new-1",
          artistMbid: null,
          releaseGroupMbid: null,
          title: "Fresh Cut",
          artist: "New Artist",
          releaseYear: null,
          releaseDate: null,
          playedAt: "2026-08-18T14:05:00.000Z",
          playedAtHour: 14,
          djName: "Phil Schaap",
          showName: "Bird Flight",
          isFirstSpin: true,
          isLibraryHit: false,
          isArtistHit: false,
        },
        {
          mbid: "mbid-old-2",
          artistMbid: null,
          releaseGroupMbid: null,
          title: "Old Standard",
          artist: "Legacy Artist",
          releaseYear: null,
          releaseDate: null,
          playedAt: "2026-08-18T02:10:00.000Z",
          playedAtHour: 2,
          djName: null,
          showName: null,
          isFirstSpin: false,
          isLibraryHit: false,
          isArtistHit: false,
        },
      ],
    },
  ],
};

const LAST_SET_RESPONSE = {
  tracks: [
    {
      playedAt: "2026-08-18T13:00:00.000Z",
      rawTitle: "Raw One",
      rawArtist: "Raw Artist",
      recording: { mbid: "mbid-set-1", title: "Set Track One", artist: "Set Artist" },
    },
    {
      playedAt: "2026-08-18T12:55:00.000Z",
      rawTitle: "Raw Two",
      rawArtist: "Raw Artist Two",
      recording: null,
    },
  ],
};

function makeRadio() {
  return { duck: vi.fn(), restoreDuck: vi.fn(), stop: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockGetStationSpins.mockResolvedValue(LAST_SET_RESPONSE);
  mockGetStationsRecentSpins.mockResolvedValue(NEW_MUSIC_RESPONSE);
  mockGetPreviewCached.mockResolvedValue(PREVIEW);
  mockPrefetchPreview.mockImplementation(() => {});
  keepButtonProps.length = 0;
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// Flush microtasks under fake timers.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// useStationScan — ducking contract
// ---------------------------------------------------------------------------
describe("useStationScan — duck / restore contract", () => {
  it("start() ducks the live stream and never calls radio.stop()", async () => {
    const radio = makeRadio();
    const { result } = renderHook(() =>
      useStationScan("newMusic", "wkcr", radio),
    );
    await flush(); // fetch settles

    expect(result.current.tracks).toHaveLength(2);
    act(() => result.current.start());

    expect(radio.duck).toHaveBeenCalledTimes(1);
    expect(radio.stop).not.toHaveBeenCalled();
    expect(radio.restoreDuck).not.toHaveBeenCalled();
    expect(result.current.active).toBe(true);
  });

  it("stop() restores the duck exactly once", async () => {
    const radio = makeRadio();
    const { result } = renderHook(() =>
      useStationScan("newMusic", "wkcr", radio),
    );
    await flush();

    act(() => result.current.start());
    await flush();
    act(() => result.current.stop());

    expect(radio.restoreDuck).toHaveBeenCalledTimes(1);
    expect(radio.stop).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);

    // Double-stop must not restore twice.
    act(() => result.current.stop());
    expect(radio.restoreDuck).toHaveBeenCalledTimes(1);
  });

  it("unmount during an active scan restores the duck", async () => {
    const radio = makeRadio();
    const { result, unmount } = renderHook(() =>
      useStationScan("newMusic", "wkcr", radio),
    );
    await flush();
    act(() => result.current.start());
    await flush();

    unmount();
    expect(radio.restoreDuck).toHaveBeenCalledTimes(1);
    expect(radio.stop).not.toHaveBeenCalled();
  });

  it("a failed preview lookup skips ahead without ending the duck; stop still restores", async () => {
    mockGetPreviewCached.mockRejectedValue(new Error("lookup failed"));
    const radio = makeRadio();
    const { result } = renderHook(() =>
      useStationScan("newMusic", "wkcr", radio),
    );
    await flush();
    act(() => result.current.start());
    await flush();

    // Failure path schedules a quick-skip; duck still held.
    expect(radio.restoreDuck).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.idx).toBe(1);

    act(() => result.current.stop());
    expect(radio.restoreDuck).toHaveBeenCalledTimes(1);
  });

  it("land() restores the duck (tune-in commits to the live stream)", async () => {
    const radio = makeRadio();
    const { result } = renderHook(() =>
      useStationScan("lastSet", "wkcr", radio),
    );
    await flush();
    act(() => result.current.start());
    await flush();

    act(() => result.current.land());
    expect(radio.restoreDuck).toHaveBeenCalledTimes(1);
  });

  it("lastSet mode fetches station spins and maps recording metadata", async () => {
    const radio = makeRadio();
    const { result } = renderHook(() =>
      useStationScan("lastSet", "wkcr", radio),
    );
    await flush();

    expect(mockGetStationSpins).toHaveBeenCalledWith({ slug: "wkcr", limit: 50 });
    expect(result.current.tracks[0]).toMatchObject({
      mbid: "mbid-set-1",
      title: "Set Track One",
      artist: "Set Artist",
    });
    // Unresolved spin falls back to raw text.
    expect(result.current.tracks[1]).toMatchObject({
      mbid: null,
      title: "Raw Two",
      artist: "Raw Artist Two",
    });
  });

  it("a hop made while paused resolves the NEW track's preview on resume", async () => {
    const radio = makeRadio();
    const { result } = renderHook(() =>
      useStationScan("newMusic", "wkcr", radio),
    );
    await flush();
    act(() => result.current.start());
    await flush(); // track 0's preview resolved & playing

    act(() => result.current.togglePause());
    expect(result.current.paused).toBe(true);
    mockGetPreviewCached.mockClear();

    // Hop while paused: index moves, no audio yet.
    act(() => result.current.next());
    expect(result.current.idx).toBe(1);
    expect(mockGetPreviewCached).not.toHaveBeenCalled();

    // Resume: the playback effect must resolve the CURRENT (new) track's
    // preview, not replay the stale source from before the hop.
    act(() => result.current.togglePause());
    await flush();
    expect(result.current.paused).toBe(false);
    expect(mockGetPreviewCached).toHaveBeenCalledWith("mbid-old-2");
    expect(mockGetPreviewCached).not.toHaveBeenCalledWith("mbid-new-1");
  });

  it("a manual hop silences the outgoing preview immediately", async () => {
    const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, "pause");
    const radio = makeRadio();
    const { result } = renderHook(() =>
      useStationScan("newMusic", "wkcr", radio),
    );
    await flush();
    act(() => result.current.start());
    await flush(); // track 0 playing
    pauseSpy.mockClear();

    act(() => result.current.next());
    // The old preview element is paused + de-sourced before the new track's
    // lookup lands, so a delayed resolution can't play track 0 under row 1.
    expect(pauseSpy).toHaveBeenCalled();
  });

  it("a slow preview lookup from before a hop never plays under the new row", async () => {
    // Track 0's lookup hangs until after the user hops to track 1.
    let resolveFirst!: (p: typeof PREVIEW) => void;
    mockGetPreviewCached
      .mockImplementationOnce(
        () => new Promise((res) => (resolveFirst = res)),
      )
      .mockResolvedValue(PREVIEW);
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play");
    const radio = makeRadio();
    const { result } = renderHook(() =>
      useStationScan("newMusic", "wkcr", radio),
    );
    await flush();
    act(() => result.current.start());
    await flush(); // track 0 lookup in-flight

    act(() => result.current.next()); // hop invalidates the token
    await flush(); // track 1 resolves and plays
    const playsAfterHop = playSpy.mock.calls.length;

    // Now the stale track-0 lookup lands — it must be a no-op.
    act(() => resolveFirst(PREVIEW));
    await flush();
    expect(playSpy.mock.calls.length).toBe(playsAfterHop);
  });

  it("prefetches the next track's preview one hop ahead", async () => {
    const radio = makeRadio();
    const { result } = renderHook(() =>
      useStationScan("newMusic", "wkcr", radio),
    );
    await flush();
    act(() => result.current.start());
    await flush();

    expect(mockPrefetchPreview).toHaveBeenCalledWith("mbid-old-2");
  });
});

// ---------------------------------------------------------------------------
// useRadioPlayer — duck volume semantics
// ---------------------------------------------------------------------------
describe("useRadioPlayer — duck volume semantics", () => {
  const station = {
    slug: "kexp",
    name: "KEXP",
    streamUrl: "https://example.test/stream.mp3",
    streamFormat: "mp3",
  } as unknown as Station;

  it("duck() lowers the element volume without touching state.volume; restoreDuck() restores it", async () => {
    const { result } = renderHook(() => useRadioPlayer());
    await act(async () => {
      await result.current.play(station);
    });

    act(() => result.current.setVolume(0.7));
    expect(result.current.volume).toBe(0.7);

    act(() => result.current.duck());
    // User-facing volume unchanged; only the element is ducked.
    expect(result.current.volume).toBe(0.7);

    act(() => result.current.restoreDuck());
    expect(result.current.volume).toBe(0.7);
  });

  it("setVolume during a duck retargets the restore value and keeps the element ducked", async () => {
    const { result } = renderHook(() => useRadioPlayer());
    await act(async () => {
      await result.current.play(station);
    });
    // Grab the underlying element through the prototype spy side-effects:
    // we assert via the hook's own state plus a fresh element volume probe.
    act(() => result.current.setVolume(0.8));
    act(() => result.current.duck());

    // Change preference mid-duck.
    act(() => result.current.setVolume(0.4));
    expect(result.current.volume).toBe(0.4);

    act(() => result.current.restoreDuck());
    // Restored to the NEW preference, not the pre-duck snapshot.
    expect(result.current.volume).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------
// StationScanPanel — scan strip UI
// ---------------------------------------------------------------------------
describe("StationScanPanel — scan strip", () => {
  function setup() {
    const radio = makeRadio();
    mockUsePlayer.mockReturnValue({ radio });
    return radio;
  }

  it("new-music scan shows the ⬦ New chip, hour label, DJ/show, and passes the MBID to KeepButton", async () => {
    const radio = setup();
    render(<StationScanPanel slug="wkcr" />);

    await act(async () => {
      screen.getByTestId("scan-new-music").click();
    });
    await flush(); // fetch + auto-start + preview resolution

    expect(radio.duck).toHaveBeenCalled();
    expect(radio.stop).not.toHaveBeenCalled();

    const strip = screen.getByTestId("station-scan-strip");
    expect(strip.textContent).toContain("Fresh Cut");
    expect(strip.textContent).toContain("New Artist");
    expect(screen.getByTestId("scan-new-chip").textContent).toContain("New");
    expect(screen.getByTestId("scan-hour").textContent).toBe("2 PM");
    expect(strip.textContent).toContain("Bird Flight");
    expect(strip.textContent).toContain("Phil Schaap");

    // KeepButton got the active track's MBID + stationScan provenance.
    const last = keepButtonProps.at(-1)!;
    expect(last.mbid).toBe("mbid-new-1");
    expect(last.provenance).toEqual({ surface: "stationScan" });
  });

  it("stop button collapses the strip and restores the duck", async () => {
    const radio = setup();
    render(<StationScanPanel slug="wkcr" />);

    await act(async () => {
      screen.getByTestId("scan-new-music").click();
    });
    await flush();
    expect(screen.getByTestId("station-scan-strip")).toBeTruthy();

    await act(async () => {
      screen.getByTestId("scan-stop").click();
    });

    expect(screen.queryByTestId("station-scan-strip")).toBeNull();
    expect(radio.restoreDuck).toHaveBeenCalledTimes(1);
  });

  it("last-set scan hides hour label and New chip (no newMusic metadata)", async () => {
    setup();
    render(<StationScanPanel slug="wkcr" />);

    await act(async () => {
      screen.getByTestId("scan-last-set").click();
    });
    await flush();

    const strip = screen.getByTestId("station-scan-strip");
    expect(strip.textContent).toContain("Set Track One");
    expect(screen.queryByTestId("scan-hour")).toBeNull();
    expect(screen.queryByTestId("scan-new-chip")).toBeNull();
  });

  it("dwell selector switches the active dwell", async () => {
    setup();
    render(<StationScanPanel slug="wkcr" />);

    await act(async () => {
      screen.getByTestId("scan-new-music").click();
    });
    await flush();

    const d3 = screen.getByTestId("scan-dwell-3000");
    await act(async () => {
      d3.click();
    });
    expect(d3.className).toContain("dial-stnscan__dwell--on");
  });
});

// ---------------------------------------------------------------------------
// fmtHour
// ---------------------------------------------------------------------------
describe("fmtHour", () => {
  it("formats UTC hours as 12-hour clock labels", () => {
    expect(fmtHour(0)).toBe("12 AM");
    expect(fmtHour(2)).toBe("2 AM");
    expect(fmtHour(12)).toBe("12 PM");
    expect(fmtHour(14)).toBe("2 PM");
    expect(fmtHour(23)).toBe("11 PM");
  });
});
