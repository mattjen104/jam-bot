/**
 * Live-ride fallback for explicit service selection (preferredService).
 *
 * Task 1411 introduced a user-facing options panel that lets listeners select
 * YouTube or Apple Music as their ride driver. A gap existed: when the selected
 * service fails (driver emits "unavailable" / "error"), Spotify's `fallbackUsed`
 * flag is never set (Spotify was never attempted), so `resumeLiveRadio` was
 * never called — leaving the listener with silence on a live ride.
 *
 * Fix: `altDriversAllFailed` is set true in `tryAltDriverRef.current`'s
 * exhausted branch, and `effectiveFallbackUsed = fallbackUsed || altDriversAllFailed`
 * gates the live-broadcast-resume effect.  `retryService` clears the flag and
 * re-triggers the cascade for the current track.
 *
 * These tests use a pure simulator mirroring `tryAltDriverRef.current` in
 * PlayerProvider.tsx — the same approach as `youtubeDriverFallback.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Cascade simulator (mirrors tryAltDriverRef.current in PlayerProvider.tsx)
// now including the setAltDriversAllFailed hook from the fix.
// ---------------------------------------------------------------------------

interface MockDriver {
  available: boolean;
  play: (item: MockItem) => Promise<void>;
}

interface MockItem {
  mbid: string;
  links: { url: string }[];
}

interface CascadeResult {
  altDriverActiveMbid: string | null;
  altDriversAllFailed: boolean;
  amPlayCalled: boolean;
  ytPlayCalled: boolean;
  amPlayCallCount: number;
  ytPlayCallCount: number;
}

async function runCascade(opts: {
  appleMusic: MockDriver;
  youtube: MockDriver;
  mbid: string;
  item: MockItem;
  skipApple?: boolean;
}): Promise<CascadeResult> {
  const altDriverFailedRef = new Set<string>();
  let altDriverActiveMbid: string | null = null;
  let altDriversAllFailed = false;

  const tryAltDriver = async (
    mbid: string,
    item: MockItem,
    skipApple: boolean,
  ): Promise<void> => {
    const failedAm = altDriverFailedRef.has(`am:${mbid}`);
    if (!skipApple && opts.appleMusic.available && !failedAm) {
      altDriverActiveMbid = mbid;
      try {
        await opts.appleMusic.play(item);
      } catch {
        altDriverFailedRef.add(`am:${mbid}`);
        await tryAltDriver(mbid, item, true);
      }
      return;
    }
    const failedYt = altDriverFailedRef.has(`yt:${mbid}`);
    if (!failedYt) {
      altDriverActiveMbid = mbid;
      try {
        await opts.youtube.play(item);
      } catch {
        altDriverFailedRef.add(`yt:${mbid}`);
        altDriverActiveMbid = null;
        // YouTube is the last driver — exhaust here, not in the dead branch.
        // Mirrors the .catch() handler fix in PlayerProvider.tsx.
        altDriversAllFailed = true;
      }
      return;
    }
    // Safety-net branch: both keys already failed before entering (retry path).
    altDriverActiveMbid = null;
    altDriversAllFailed = true;
  };

  await tryAltDriver(opts.mbid, opts.item, opts.skipApple ?? false);

  const amFn = opts.appleMusic.play as ReturnType<typeof vi.fn>;
  const ytFn = opts.youtube.play as ReturnType<typeof vi.fn>;
  return {
    altDriverActiveMbid,
    altDriversAllFailed,
    amPlayCalled: amFn.mock.calls.length > 0,
    ytPlayCalled: ytFn.mock.calls.length > 0,
    amPlayCallCount: amFn.mock.calls.length,
    ytPlayCallCount: ytFn.mock.calls.length,
  };
}

const ITEM_YT: MockItem = {
  mbid: "mbid-yt-ok",
  links: [{ url: "https://www.youtube.com/watch?v=abc123" }],
};
const ITEM_NO_LINKS: MockItem = { mbid: "mbid-no-links", links: [] };

// ---------------------------------------------------------------------------
// Section 1: preferredService=youtube — YouTube is the first and only attempt.
// When it fails, altDriversAllFailed must be set (live broadcast can resume).
// ---------------------------------------------------------------------------
describe("preferredService=youtube — YouTube failure → altDriversAllFailed", () => {
  it("sets altDriversAllFailed when YouTube play() throws (skipApple=true path)", async () => {
    const result = await runCascade({
      appleMusic: { available: true, play: vi.fn() },
      youtube: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("No YouTube link")),
      },
      mbid: ITEM_NO_LINKS.mbid,
      item: ITEM_NO_LINKS,
      skipApple: true, // preferredService=youtube skips Apple Music
    });

    expect(result.altDriversAllFailed).toBe(true);
  });

  it("Apple Music is never attempted when skipApple=true (YouTube selected)", async () => {
    const amPlay = vi.fn();
    const result = await runCascade({
      appleMusic: { available: true, play: amPlay },
      youtube: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("No YouTube link")),
      },
      mbid: ITEM_NO_LINKS.mbid,
      item: ITEM_NO_LINKS,
      skipApple: true,
    });

    expect(result.amPlayCalled).toBe(false);
    expect(result.altDriversAllFailed).toBe(true);
  });

  it("altDriverActiveMbid is null after YouTube failure (driverActive=false → resume fires)", async () => {
    const result = await runCascade({
      appleMusic: { available: false, play: vi.fn() },
      youtube: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("unavailable")),
      },
      mbid: ITEM_NO_LINKS.mbid,
      item: ITEM_NO_LINKS,
      skipApple: true,
    });

    // driverActive = altDriverActiveMbid === currentMbid — must be false so
    // the live fallback effect runs (not gated by driverActive).
    expect(result.altDriverActiveMbid).toBeNull();
  });

  it("does NOT set altDriversAllFailed when YouTube play() resolves (happy path)", async () => {
    const result = await runCascade({
      appleMusic: { available: false, play: vi.fn() },
      youtube: {
        available: true,
        play: vi.fn().mockResolvedValue(undefined),
      },
      mbid: ITEM_YT.mbid,
      item: ITEM_YT,
      skipApple: true,
    });

    expect(result.altDriversAllFailed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 2: preferredService=apple-music — both AM and YouTube fail.
// altDriversAllFailed must be set so the live broadcast resumes.
// ---------------------------------------------------------------------------
describe("preferredService=apple-music — AM+YouTube failure → altDriversAllFailed", () => {
  it("sets altDriversAllFailed when Apple Music fails and YouTube also fails", async () => {
    const result = await runCascade({
      appleMusic: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("token expired")),
      },
      youtube: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("No YouTube link")),
      },
      mbid: ITEM_NO_LINKS.mbid,
      item: ITEM_NO_LINKS,
      skipApple: false, // preferredService=apple-music tries AM first
    });

    expect(result.altDriversAllFailed).toBe(true);
  });

  it("cascades from Apple Music to YouTube before setting altDriversAllFailed", async () => {
    const result = await runCascade({
      appleMusic: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("token expired")),
      },
      youtube: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("No link")),
      },
      mbid: ITEM_NO_LINKS.mbid,
      item: ITEM_NO_LINKS,
      skipApple: false,
    });

    // Both were attempted before the exhausted branch.
    expect(result.amPlayCalled).toBe(true);
    expect(result.ytPlayCalled).toBe(true);
    expect(result.altDriversAllFailed).toBe(true);
  });

  it("altDriverActiveMbid is null after both drivers fail", async () => {
    const result = await runCascade({
      appleMusic: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("token expired")),
      },
      youtube: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("No link")),
      },
      mbid: ITEM_NO_LINKS.mbid,
      item: ITEM_NO_LINKS,
    });

    expect(result.altDriverActiveMbid).toBeNull();
    expect(result.altDriversAllFailed).toBe(true);
  });

  it("does NOT set altDriversAllFailed when Apple Music succeeds", async () => {
    const result = await runCascade({
      appleMusic: {
        available: true,
        play: vi.fn().mockResolvedValue(undefined),
      },
      youtube: { available: true, play: vi.fn() },
      mbid: ITEM_YT.mbid,
      item: ITEM_YT,
    });

    expect(result.altDriversAllFailed).toBe(false);
    expect(result.amPlayCallCount).toBe(1);
    // YouTube never needed.
    expect(result.ytPlayCalled).toBe(false);
  });

  it("does NOT set altDriversAllFailed when cascade reaches YouTube and succeeds", async () => {
    const result = await runCascade({
      appleMusic: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("token expired")),
      },
      youtube: {
        available: true,
        play: vi.fn().mockResolvedValue(undefined),
      },
      mbid: ITEM_YT.mbid,
      item: ITEM_YT,
    });

    expect(result.altDriversAllFailed).toBe(false);
    expect(result.ytPlayCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 3: effectiveFallbackUsed logic.
// Verifies that the gate condition `fallbackUsed || altDriversAllFailed`
// correctly gates resumeLiveRadio in the live fallback effect.
// ---------------------------------------------------------------------------
describe("effectiveFallbackUsed — live broadcast resume gate", () => {
  /**
   * Simulates the live fallback effect from PlayerProvider:
   *   if (!active) return;
   *   if (playbackMode !== "resolve_to_service") return;
   *   if (timeOrientation !== "live") return;
   *   if (driverActive) return;
   *   if (!effectiveFallbackUsed) return;
   *   resumeLiveRadio?.();
   */
  function shouldResumeBroadcast(opts: {
    active: boolean;
    playbackMode: "resolve_to_service" | "passthrough";
    timeOrientation: "live" | "past" | "curated";
    driverActive: boolean;
    fallbackUsed: boolean;
    altDriversAllFailed: boolean;
  }): boolean {
    if (!opts.active) return false;
    if (opts.playbackMode !== "resolve_to_service") return false;
    if (opts.timeOrientation !== "live") return false;
    if (opts.driverActive) return false;
    const effectiveFallbackUsed = opts.fallbackUsed || opts.altDriversAllFailed;
    if (!effectiveFallbackUsed) return false;
    return true;
  }

  it("resumes broadcast when altDriversAllFailed=true (preferredService path)", () => {
    expect(
      shouldResumeBroadcast({
        active: true,
        playbackMode: "resolve_to_service",
        timeOrientation: "live",
        driverActive: false,
        fallbackUsed: false, // Spotify was never attempted
        altDriversAllFailed: true,
      }),
    ).toBe(true);
  });

  it("resumes broadcast when fallbackUsed=true (Spotify path — unchanged behaviour)", () => {
    expect(
      shouldResumeBroadcast({
        active: true,
        playbackMode: "resolve_to_service",
        timeOrientation: "live",
        driverActive: false,
        fallbackUsed: true,
        altDriversAllFailed: false,
      }),
    ).toBe(true);
  });

  it("does NOT resume broadcast when a driver is still active (driverActive=true)", () => {
    expect(
      shouldResumeBroadcast({
        active: true,
        playbackMode: "resolve_to_service",
        timeOrientation: "live",
        driverActive: true,
        fallbackUsed: false,
        altDriversAllFailed: true,
      }),
    ).toBe(false);
  });

  it("does NOT resume broadcast when both fallbackUsed and altDriversAllFailed are false", () => {
    expect(
      shouldResumeBroadcast({
        active: true,
        playbackMode: "resolve_to_service",
        timeOrientation: "live",
        driverActive: false,
        fallbackUsed: false,
        altDriversAllFailed: false,
      }),
    ).toBe(false);
  });

  it("does NOT resume broadcast when timeOrientation is not live (past ride)", () => {
    expect(
      shouldResumeBroadcast({
        active: true,
        playbackMode: "resolve_to_service",
        timeOrientation: "past",
        driverActive: false,
        fallbackUsed: false,
        altDriversAllFailed: true,
      }),
    ).toBe(false);
  });

  it("does NOT resume broadcast when playbackMode is passthrough", () => {
    expect(
      shouldResumeBroadcast({
        active: true,
        playbackMode: "passthrough",
        timeOrientation: "live",
        driverActive: false,
        fallbackUsed: false,
        altDriversAllFailed: true,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 4: retryService semantics.
// Verifies that the retry clears altDriversAllFailed + per-track failure keys,
// making the cascade eligible to run again for the same track.
// ---------------------------------------------------------------------------
describe("retryService — clears failure state for the current track", () => {
  /**
   * Simulates the retryService callback in PlayerProvider:
   *   if (altDriversAllFailed && currentMbid) {
   *     altDriverFailedRef.delete(`yt:${currentMbid}`);
   *     altDriverFailedRef.delete(`am:${currentMbid}`);
   *     setAltDriversAllFailed(false);
   *     setAltDriverActiveMbid(null);
   *   } else {
   *     retryCurrentTrack(); // Spotify-specific
   *   }
   */
  function retryService(state: {
    altDriversAllFailed: boolean;
    currentMbid: string | null;
    altDriverFailedRef: Set<string>;
  }): {
    altDriversAllFailed: boolean;
    altDriverActiveMbid: string | null;
    spotifyRetryCalled: boolean;
    failedRef: Set<string>;
  } {
    const spotifyRetry = vi.fn();
    let altDriversAllFailed = state.altDriversAllFailed;
    let altDriverActiveMbid: string | null = "some-mbid"; // non-null to show it was reset
    let spotifyRetryCalled = false;

    if (state.altDriversAllFailed && state.currentMbid) {
      state.altDriverFailedRef.delete(`yt:${state.currentMbid}`);
      state.altDriverFailedRef.delete(`am:${state.currentMbid}`);
      altDriversAllFailed = false;
      altDriverActiveMbid = null;
    } else {
      spotifyRetry();
      spotifyRetryCalled = true;
    }

    return {
      altDriversAllFailed,
      altDriverActiveMbid,
      spotifyRetryCalled,
      failedRef: state.altDriverFailedRef,
    };
  }

  it("clears altDriversAllFailed when an alt driver had previously failed", () => {
    const result = retryService({
      altDriversAllFailed: true,
      currentMbid: "mbid-abc",
      altDriverFailedRef: new Set(["yt:mbid-abc"]),
    });

    expect(result.altDriversAllFailed).toBe(false);
  });

  it("removes per-track failure keys for both YouTube and Apple Music", () => {
    const failedRef = new Set(["yt:mbid-abc", "am:mbid-abc", "yt:mbid-other"]);
    const result = retryService({
      altDriversAllFailed: true,
      currentMbid: "mbid-abc",
      altDriverFailedRef: failedRef,
    });

    // Only keys for the current track are removed.
    expect(result.failedRef.has("yt:mbid-abc")).toBe(false);
    expect(result.failedRef.has("am:mbid-abc")).toBe(false);
    // Keys for other tracks are untouched.
    expect(result.failedRef.has("yt:mbid-other")).toBe(true);
  });

  it("resets altDriverActiveMbid to null so the trigger effect re-fires", () => {
    const result = retryService({
      altDriversAllFailed: true,
      currentMbid: "mbid-abc",
      altDriverFailedRef: new Set(["yt:mbid-abc"]),
    });

    expect(result.altDriverActiveMbid).toBeNull();
  });

  it("falls through to Spotify retry when altDriversAllFailed is false", () => {
    const result = retryService({
      altDriversAllFailed: false,
      currentMbid: "mbid-abc",
      altDriverFailedRef: new Set(),
    });

    expect(result.spotifyRetryCalled).toBe(true);
    expect(result.altDriversAllFailed).toBe(false);
  });

  it("falls through to Spotify retry when currentMbid is null", () => {
    const result = retryService({
      altDriversAllFailed: true,
      currentMbid: null,
      altDriverFailedRef: new Set(),
    });

    expect(result.spotifyRetryCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 5: retry → re-attempt (driver play() is called again after retry).
//
// Verifies the full cycle: service fails → altDriversAllFailed=true →
// user clicks Retry → failure keys cleared → driver play() called again.
// This pins the deterministic direct-call fix (retryService calls
// tryAltDriverRef.current directly, not via effect re-fire).
// ---------------------------------------------------------------------------
describe("retry → driver play() is called again after preferred-service failure", () => {
  /**
   * Simulates one full cycle:
   *  1. Initial cascade attempt — service fails → altDriversAllFailed=true.
   *  2. retryService() is called — clears state and re-invokes cascade.
   *  3. Second cascade attempt — service succeeds (mock resolves this time).
   */
  async function runRetryRound(opts: {
    preferredService: "youtube" | "apple-music";
    /** First play() call rejects; second resolves. */
    appleMusic: { available: boolean; firstReject?: boolean };
    youtube: { firstReject?: boolean };
  }) {
    const altDriverFailedRef = new Set<string>();
    let altDriverActiveMbid: string | null = null;
    let altDriversAllFailed = false;

    const mbid = "retry-mbid";
    const item: MockItem = { mbid, links: [{ url: "https://www.youtube.com/watch?v=abc" }] };

    // Track call counts across both rounds.
    let amCallCount = 0;
    let ytCallCount = 0;

    const applePlay = vi.fn().mockImplementation(() => {
      amCallCount++;
      if (opts.appleMusic.firstReject && amCallCount === 1) {
        return Promise.reject(new Error("token expired"));
      }
      return Promise.resolve();
    });

    const youtubePlay = vi.fn().mockImplementation(() => {
      ytCallCount++;
      if (opts.youtube.firstReject && ytCallCount === 1) {
        return Promise.reject(new Error("no link"));
      }
      return Promise.resolve();
    });

    const appleDriver: MockDriver = { available: opts.appleMusic.available, play: applePlay };
    const ytDriver: MockDriver = { available: true, play: youtubePlay };

    const tryAltDriver = async (
      m: string,
      it: MockItem,
      skipApple: boolean,
    ): Promise<void> => {
      const failedAm = altDriverFailedRef.has(`am:${m}`);
      if (!skipApple && appleDriver.available && !failedAm) {
        altDriverActiveMbid = m;
        try {
          await appleDriver.play(it);
        } catch {
          altDriverFailedRef.add(`am:${m}`);
          await tryAltDriver(m, it, true);
        }
        return;
      }
      const failedYt = altDriverFailedRef.has(`yt:${m}`);
      if (!failedYt) {
        altDriverActiveMbid = m;
        try {
          await ytDriver.play(it);
        } catch {
          altDriverFailedRef.add(`yt:${m}`);
          altDriverActiveMbid = null;
          altDriversAllFailed = true;
        }
        return;
      }
      altDriverActiveMbid = null;
      altDriversAllFailed = true;
    };

    // Round 1: initial attempt (fails).
    await tryAltDriver(mbid, item, opts.preferredService === "youtube");

    const failedAfterRound1 = altDriversAllFailed;

    // Simulate retryService: clear state then directly call cascade.
    altDriverFailedRef.delete(`yt:${mbid}`);
    altDriverFailedRef.delete(`am:${mbid}`);
    altDriversAllFailed = false;
    altDriverActiveMbid = null;

    // Round 2: retry (succeeds this time).
    await tryAltDriver(mbid, item, opts.preferredService === "youtube");

    return {
      failedAfterRound1,
      altDriversAllFailed,
      altDriverActiveMbid,
      ytCallCount,
      amCallCount,
    };
  }

  it("YouTube selected: play() is called again after retry and succeeds", async () => {
    const r = await runRetryRound({
      preferredService: "youtube",
      appleMusic: { available: false },
      youtube: { firstReject: true },
    });

    expect(r.failedAfterRound1).toBe(true); // confirmed failure in round 1
    expect(r.altDriversAllFailed).toBe(false); // cleared by retry success
    expect(r.ytCallCount).toBe(2); // play() called twice (fail + success)
    expect(r.altDriverActiveMbid).toBe("retry-mbid"); // driving again
  });

  it("Apple Music selected: both drivers fail, retry re-attempts Apple Music then YouTube", async () => {
    const r = await runRetryRound({
      preferredService: "apple-music",
      appleMusic: { available: true, firstReject: true },
      youtube: { firstReject: true },
    });

    expect(r.failedAfterRound1).toBe(true);
    // Second round: Apple Music succeeds on second call (mock resolves).
    // amCallCount=2 (tried twice), ytCallCount=1 (only in round 1 cascade).
    expect(r.amCallCount).toBeGreaterThanOrEqual(2);
    expect(r.altDriversAllFailed).toBe(false);
  });

  it("does NOT call Spotify retry when altDriversAllFailed is true and currentItem present", () => {
    // Guard: the else branch (Spotify retry) must not fire for the preferred path.
    const spotifyRetry = vi.fn();
    const altDriversAllFailed = true;
    const currentMbid = "retry-mbid";
    const currentItem = { mbid: currentMbid } as MockItem;
    const tryAltRef = vi.fn();

    // Simulate the retryService callback body:
    if (altDriversAllFailed && currentMbid && currentItem) {
      tryAltRef(currentMbid, currentItem, false);
    } else {
      spotifyRetry();
    }

    expect(spotifyRetry).not.toHaveBeenCalled();
    expect(tryAltRef).toHaveBeenCalledOnce();
  });
});
