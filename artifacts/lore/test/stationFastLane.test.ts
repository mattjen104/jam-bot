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
  expiryRecheckDelayMs,
  FAST_LANE_RECHECK_DELAYS_MS,
  EXPIRY_RECHECK_PAD_MS,
  EXPIRY_RECHECK_MAX_MS,
  LANDING_CONFIRM_WINDOW_MS,
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

describe("expiryRecheckDelayMs", () => {
  it("returns null without a likely-expiring flag or usable estimate", () => {
    expect(expiryRecheckDelayMs(null)).toBeNull();
    expect(expiryRecheckDelayMs(NOW_BASE)).toBeNull();
    expect(
      expiryRecheckDelayMs({ ...NOW_BASE, likelyExpiring: false, estimatedRemainingMs: 5000 }),
    ).toBeNull();
    // Advisory rule: expiring without an estimate schedules nothing.
    expect(
      expiryRecheckDelayMs({ ...NOW_BASE, likelyExpiring: true, estimatedRemainingMs: null }),
    ).toBeNull();
  });

  it("schedules just past the estimated boundary, capped", () => {
    expect(
      expiryRecheckDelayMs({ ...NOW_BASE, likelyExpiring: true, estimatedRemainingMs: 8000 }),
    ).toBe(8000 + EXPIRY_RECHECK_PAD_MS);
    expect(
      expiryRecheckDelayMs({ ...NOW_BASE, likelyExpiring: true, estimatedRemainingMs: 0 }),
    ).toBe(EXPIRY_RECHECK_PAD_MS);
    expect(
      expiryRecheckDelayMs({ ...NOW_BASE, likelyExpiring: true, estimatedRemainingMs: 500_000 }),
    ).toBe(EXPIRY_RECHECK_MAX_MS);
  });
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

  it("keeps a fresh aggregate row in checking state until a station-specific observation confirms it", async () => {
    const fetchMock = fetchResponding([
      { ...resp(NOW_BASE, true), confirmed: false },
      { ...resp(NOW_BASE, false), confirmed: true },
      { ...resp(NOW_BASE, false), confirmed: true },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useStationFastLane(vi.fn()));

    act(() => {
      result.current.landOnStation("kfoo", null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.confirmation).toEqual({
      slug: "kfoo",
      phase: "confirming",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_LANE_RECHECK_DELAYS_MS[0]! + 100);
    });
    expect(result.current.confirmation).toEqual({
      slug: "kfoo",
      phase: "confirmed",
    });
  });

  it("schedules ONE boundary re-check for a likely-expiring landing and reconciles only on real change", async () => {
    const expiring: FastLaneNow = {
      ...NOW_BASE,
      mbid: "mbid-old",
      title: "Old",
      artist: "Old",
      likelyExpiring: true,
      estimatedRemainingMs: 8000,
    };
    const swapped: FastLaneNow = { ...NOW_BASE, mbid: "mbid-next", title: "Next Song" };
    const fetchMock = fetchResponding([resp(expiring, false), resp(swapped, false)]);
    vi.stubGlobal("fetch", fetchMock);
    const onFresh = vi.fn();
    const { result } = renderHook(() => useStationFastLane(onFresh));

    await act(async () => {
      // Candidate matches the expiring track — advisory only, no reconcile yet.
      result.current.landOnStation("kfoo", { mbid: "mbid-old", title: "Old", artist: "Old" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onFresh).not.toHaveBeenCalled();

    // Before the boundary: nothing fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000 + EXPIRY_RECHECK_PAD_MS - 100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Just past the boundary: exactly one re-check; the real swap reconciles.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onFresh).toHaveBeenCalledTimes(1);
    expect(onFresh).toHaveBeenCalledWith("kfoo", swapped);

    // The boundary re-check never reschedules itself.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("no boundary re-check when the landing result carries no estimate", async () => {
    const fetchMock = fetchResponding([resp({ ...NOW_BASE, likelyExpiring: true, estimatedRemainingMs: null }, false)]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useStationFastLane(vi.fn()));
    await act(async () => {
      result.current.landOnStation("kfoo", { mbid: "mbid-new", title: "New Song", artist: "New Artist" });
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a new landing on the same station supersedes a pending boundary re-check", async () => {
    const expiring: FastLaneNow = {
      ...NOW_BASE,
      likelyExpiring: true,
      estimatedRemainingMs: 10_000,
    };
    const fetchMock = fetchResponding([
      resp(expiring, false),
      resp(NOW_BASE, false),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useStationFastLane(vi.fn()));

    await act(async () => {
      result.current.landOnStation("kfoo", { mbid: "mbid-new", title: "New Song", artist: "New Artist" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Re-land before the boundary: old timer cleared, new landing fetches.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      result.current.landOnStation("kfoo", { mbid: "mbid-new", title: "New Song", artist: "New Artist" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second response was not expiring — the superseded timer must not fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("discards a superseded landing's delayed first response (no reconcile, no timers)", async () => {
    // First landing's response is likely-expiring AND differs from the new
    // candidate — if the race were unguarded it would both reconcile the old
    // track and register a boundary re-check.
    const stale: FastLaneNow = {
      ...NOW_BASE,
      mbid: "mbid-stale",
      title: "Stale",
      artist: "Stale",
      likelyExpiring: true,
      estimatedRemainingMs: 5000,
    };
    let resolveFirst!: (r: Response) => void;
    const bodies = [resp(NOW_BASE, false)];
    let call = 0;
    const fetchMock = vi.fn(() => {
      call += 1;
      if (call === 1) {
        return new Promise<Response>((r) => { resolveFirst = r; });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(bodies[0]),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onFresh = vi.fn();
    const { result } = renderHook(() => useStationFastLane(onFresh));

    await act(async () => {
      result.current.landOnStation("kfoo", { mbid: "mbid-old", title: "Old", artist: "Old" });
      await vi.advanceTimersByTimeAsync(0);
      // Second landing on the same station while the first fetch hangs.
      result.current.landOnStation("kfoo", { mbid: "mbid-new", title: "New Song", artist: "New Artist" });
      await vi.advanceTimersByTimeAsync(0);
      // Now the FIRST (superseded) response arrives, late.
      resolveFirst({ ok: true, json: () => Promise.resolve(resp(stale, true)) } as Response);
      await vi.advanceTimersByTimeAsync(0);
    });

    // The late stale response must not reconcile (second landing's response
    // matched its candidate, so no callback at all)…
    expect(onFresh).not.toHaveBeenCalled();
    // …and must not have registered refresh/expiry timers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("a response arriving after unmount neither reconciles nor registers timers", async () => {
    let resolveFirst!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => { resolveFirst = r; }));
    vi.stubGlobal("fetch", fetchMock);
    const onFresh = vi.fn();
    const { result, unmount } = renderHook(() => useStationFastLane(onFresh));

    await act(async () => {
      result.current.landOnStation("kfoo", { mbid: "mbid-old", title: "Old", artist: "Old" });
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await act(async () => {
      // Late response: differing, likely-expiring, refresh-triggered — every
      // path that could reconcile or schedule.
      resolveFirst({
        ok: true,
        json: () =>
          Promise.resolve(
            resp({ ...NOW_BASE, likelyExpiring: true, estimatedRemainingMs: 5000 }, true),
          ),
      } as Response);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onFresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Landing confirmation state machine (task: parallel live-stream startup):
 * audio and metadata race in parallel; the bounded window never converts a
 * timeout into a negative claim.
 */
describe("useStationFastLane — landing confirmation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts confirming on landing and confirms when fresh metadata wins the race", async () => {
    // Metadata-first order: the fast-lane response resolves inside the window.
    const fetchMock = fetchResponding([resp(NOW_BASE, false)]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useStationFastLane(vi.fn()));

    expect(result.current.confirmation).toBeNull();
    act(() => {
      result.current.landOnStation("kfoo", null);
    });
    // Synchronously confirming — audio startup at the call site is not gated.
    expect(result.current.confirmation).toEqual({ slug: "kfoo", phase: "confirming" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.confirmation).toEqual({ slug: "kfoo", phase: "confirmed" });

    // Window elapsing after confirmation never downgrades it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LANDING_CONFIRM_WINDOW_MS + 100);
    });
    expect(result.current.confirmation).toEqual({ slug: "kfoo", phase: "confirmed" });
  });

  it("moves to soft unconfirmed when the window elapses, then upgrades on a late response (audio-first order)", async () => {
    // The response resolves only after the window — playback continues,
    // the state is unconfirmed (never negative), and the late arrival upgrades it.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchMock = vi.fn(async () => {
      await gate;
      return {
        ok: true,
        json: () => Promise.resolve(resp(NOW_BASE, false)),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const onFresh = vi.fn();
    const { result } = renderHook(() => useStationFastLane(onFresh));

    act(() => {
      result.current.landOnStation("kfoo", null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LANDING_CONFIRM_WINDOW_MS + 100);
    });
    expect(result.current.confirmation).toEqual({ slug: "kfoo", phase: "unconfirmed" });
    // A timeout is never a negative claim — no callback fired to blank the track.
    expect(onFresh).not.toHaveBeenCalled();

    // Late confirmation upgrades seamlessly.
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.confirmation).toEqual({ slug: "kfoo", phase: "confirmed" });
    expect(onFresh).toHaveBeenCalledWith("kfoo", NOW_BASE);
  });

  it("keeps confirming on a stale response and confirms via the post-refresh re-check", async () => {
    const fresh: FastLaneNow = { ...NOW_BASE, mbid: "mbid-corrected", title: "Corrected" };
    const fetchMock = fetchResponding([
      resp({ ...NOW_BASE, freshness: "stale" }, true),
      resp(fresh, false),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useStationFastLane(vi.fn()));

    act(() => {
      result.current.landOnStation("kfoo", null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Stale stored state does not count as confirmation.
    expect(result.current.confirmation).toEqual({ slug: "kfoo", phase: "confirming" });

    // Window elapses first (re-checks come later) → soft unconfirmed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LANDING_CONFIRM_WINDOW_MS + 100);
    });
    expect(result.current.confirmation).toEqual({ slug: "kfoo", phase: "unconfirmed" });

    // First re-check returns fresh data → upgraded to confirmed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.max(...FAST_LANE_RECHECK_DELAYS_MS) + 100);
    });
    expect(result.current.confirmation).toEqual({ slug: "kfoo", phase: "confirmed" });
  });

  it("a failed fetch never becomes a negative claim — soft unconfirmed only", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", fetchMock);
    const onFresh = vi.fn();
    const { result } = renderHook(() => useStationFastLane(onFresh));

    act(() => {
      result.current.landOnStation("kfoo", null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LANDING_CONFIRM_WINDOW_MS + 100);
    });
    expect(result.current.confirmation).toEqual({ slug: "kfoo", phase: "unconfirmed" });
    expect(onFresh).not.toHaveBeenCalled();
  });

  it("a new landing supersedes the previous one; late responses for the old slug are ignored", async () => {
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((r) => { releaseOld = r; });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("kold")) {
        // refreshTriggered:true — a live landing would schedule re-checks;
        // a superseded one must not.
        return oldGate.then(() => ({
          ok: true,
          json: () => Promise.resolve(resp(NOW_BASE, true)),
        } as Response));
      }
      // New landing: respond stale so it stays confirming.
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(resp({ ...NOW_BASE, freshness: "stale" }, false)),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onFresh = vi.fn();
    const { result } = renderHook(() => useStationFastLane(onFresh));

    act(() => {
      result.current.landOnStation("kold", null);
    });
    act(() => {
      result.current.landOnStation("knew", null);
    });
    expect(result.current.confirmation).toEqual({ slug: "knew", phase: "confirming" });

    // The old landing's response arrives late — it must not confirm "knew",
    // must never fire the reconciliation callback (which would mutate the
    // shared now-playing override), and must not schedule re-checks.
    await act(async () => {
      releaseOld();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.confirmation).toEqual({ slug: "knew", phase: "confirming" });
    expect(onFresh).not.toHaveBeenCalledWith("kold", expect.anything());
    // Only the two landing fetches — no re-checks from the superseded landing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.max(...FAST_LANE_RECHECK_DELAYS_MS) + 100);
    });
    const koldCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("kold"));
    expect(koldCalls).toHaveLength(1);
  });
});
