// @vitest-environment jsdom
/**
 * Station-landing fast lane (useStationFastLane):
 *  - tracksDiffer reconciliation rules (MBID wins, normalized text fallback);
 *  - landing fetches the fast-lane endpoint and reports a differing track;
 *  - a triggered refresh schedules the brief re-check polls;
 *  - no refresh ⇒ no re-checks; identical track ⇒ no reconciliation callback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useStationFastLane,
  tracksDiffer,
  FAST_LANE_RECHECK_DELAYS_MS,
  type FastLaneNow,
  type FastLaneResponse,
} from "../src/hooks/useStationFastLane";

const NOW_BASE: FastLaneNow = {
  mbid: "mbid-new",
  artistMbid: null,
  title: "New Song",
  artist: "New Artist",
  artworkUrl: null,
  releaseYear: null,
  playedAt: "2026-08-15T12:00:00.000Z",
  observedAt: "2026-08-15T12:00:00.000Z",
  freshness: "fresh",
  resolved: true,
};

describe("tracksDiffer", () => {
  it("treats a missing candidate as differing", () => {
    expect(tracksDiffer(null, NOW_BASE)).toBe(true);
    expect(tracksDiffer(undefined, NOW_BASE)).toBe(true);
  });

  it("compares by MBID when both sides have one", () => {
    expect(tracksDiffer({ mbid: "mbid-new", title: "x", artist: "y" }, NOW_BASE)).toBe(false);
    expect(tracksDiffer({ mbid: "mbid-old", title: "New Song", artist: "New Artist" }, NOW_BASE)).toBe(true);
  });

  it("falls back to normalized title/artist text", () => {
    expect(tracksDiffer({ mbid: null, title: "  new song ", artist: "NEW ARTIST" }, NOW_BASE)).toBe(false);
    expect(tracksDiffer({ mbid: null, title: "Old Song", artist: "New Artist" }, NOW_BASE)).toBe(true);
  });
});

function fetchResponding(bodies: FastLaneResponse[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(() => {
    const body = bodies[Math.min(i++, bodies.length - 1)]!;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);
  });
}

const resp = (now: FastLaneNow | null, refreshTriggered: boolean): FastLaneResponse => ({
  station: { slug: "kfoo", name: "KFOO" },
  now,
  refreshTriggered,
});

describe("useStationFastLane", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches on landing and reconciles a differing track (no re-checks when no refresh)", async () => {
    const fetchMock = fetchResponding([resp(NOW_BASE, false)]);
    vi.stubGlobal("fetch", fetchMock);
    const onFresh = vi.fn();
    const { result } = renderHook(() => useStationFastLane(onFresh));

    await act(async () => {
      result.current.landOnStation("kfoo", { mbid: "mbid-old", title: "Old", artist: "Old" });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/player/station/kfoo/now");
    expect(onFresh).toHaveBeenCalledTimes(1);
    expect(onFresh).toHaveBeenCalledWith("kfoo", NOW_BASE);

    // No refresh triggered ⇒ no re-check polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not reconcile when the fast-lane track matches the candidate", async () => {
    const fetchMock = fetchResponding([resp(NOW_BASE, false)]);
    vi.stubGlobal("fetch", fetchMock);
    const onFresh = vi.fn();
    const { result } = renderHook(() => useStationFastLane(onFresh));

    await act(async () => {
      result.current.landOnStation("kfoo", { mbid: "mbid-new", title: "New Song", artist: "New Artist" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onFresh).not.toHaveBeenCalled();
  });

  it("re-checks briefly after a triggered refresh and reconciles the corrected track", async () => {
    const corrected: FastLaneNow = { ...NOW_BASE, mbid: "mbid-corrected", title: "Corrected" };
    // Landing sees the stale candidate track + refreshTriggered; re-checks see
    // the corrected spin the one-shot refresh wrote.
    const fetchMock = fetchResponding([
      resp({ ...NOW_BASE, mbid: "mbid-old", title: "Old", artist: "Old", freshness: "stale" }, true),
      resp(corrected, false),
      resp(corrected, false),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const onFresh = vi.fn();
    const { result } = renderHook(() => useStationFastLane(onFresh));

    await act(async () => {
      // Candidate matches the (stale) stored state — no immediate reconcile.
      result.current.landOnStation("kfoo", { mbid: "mbid-old", title: "Old", artist: "Old" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onFresh).not.toHaveBeenCalled();

    // Both scheduled re-checks fire; the corrected track reconciles.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.max(...FAST_LANE_RECHECK_DELAYS_MS) + 100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1 + FAST_LANE_RECHECK_DELAYS_MS.length);
    expect(onFresh).toHaveBeenCalledWith("kfoo", corrected);
    // Re-checks never reschedule themselves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1 + FAST_LANE_RECHECK_DELAYS_MS.length);
  });

  it("cancels pending re-checks on unmount", async () => {
    const fetchMock = fetchResponding([
      resp({ ...NOW_BASE, freshness: "stale" }, true),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useStationFastLane(vi.fn()));

    await act(async () => {
      result.current.landOnStation("kfoo", null);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
