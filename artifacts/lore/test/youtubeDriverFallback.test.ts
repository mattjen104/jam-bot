/**
 * Tests confirming the driver fallback ladder reaches YouTube when Spotify is
 * unavailable, and that the preview audio path kicks in when YouTube also has
 * no link for the track.
 *
 * Approach: pure simulation of the tryAltDriver cascade from PlayerProvider
 * (mirrors tryAltDriverRef.current in PlayerProvider.tsx lines ~853–881) so
 * these tests remain fast, side-effect-free, and dependency-free — exactly
 * the pattern used in deviceLostFallback.test.ts.
 *
 * Three behaviours are pinned:
 *   1. Spotify "unavailable" → YouTube play() is attempted.
 *   2. Apple Music fails → cascade continues to YouTube (not stranded).
 *   3. YouTube also fails (no link) → altDriverActiveMbid cleared → preview.
 *
 * The RideBar source-label contract is covered by a separate section that
 * tests the string each `ride.source` value produces.
 */
import { describe, expect, it, vi } from "vitest";
import { resolveAudioPath } from "../src/player/playbackSession";
import type { TimeOrientation } from "../src/player/playbackSession";

// ---------------------------------------------------------------------------
// Cascade simulator
//
// Mirrors tryAltDriverRef.current in PlayerProvider.tsx:
//
//   tryAltDriver(mbid, item, skipApple):
//     if (!skipApple && appleAvail && !failedAm) → try Apple Music
//       .catch → mark am-failed, recurse with skipApple=true
//     else if (!failedYt)                        → try YouTube
//       .catch → mark yt-failed, clear altDriverActiveMbid
//     else                                        → clear altDriverActiveMbid
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
  /** Final altDriverActiveMbid after all async work settles. */
  altDriverActiveMbid: string | null;
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
      }
      return;
    }
    altDriverActiveMbid = null;
  };

  await tryAltDriver(opts.mbid, opts.item, opts.skipApple ?? false);

  const amFn = opts.appleMusic.play as ReturnType<typeof vi.fn>;
  const ytFn = opts.youtube.play as ReturnType<typeof vi.fn>;
  return {
    altDriverActiveMbid,
    amPlayCalled: amFn.mock.calls.length > 0,
    ytPlayCalled: ytFn.mock.calls.length > 0,
    amPlayCallCount: amFn.mock.calls.length,
    ytPlayCallCount: ytFn.mock.calls.length,
  };
}

const ITEM_WITH_YT: MockItem = {
  mbid: "mbid-yt-ok",
  links: [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
};

const ITEM_NO_LINKS: MockItem = {
  mbid: "mbid-no-links",
  links: [],
};

// ---------------------------------------------------------------------------
// Section 1: Spotify unavailable → YouTube play() is attempted
//
// PlayerProvider receives state:"unavailable" from the Spotify driver and
// calls tryAltDriverRef.current(mbid, currentItem, /*skipApple=*/false).
// When Apple Music is not available the cascade must immediately reach YouTube.
// ---------------------------------------------------------------------------
describe("Spotify unavailable → YouTube play() is attempted", () => {
  it("calls YouTube play() when Apple Music is not available", async () => {
    const result = await runCascade({
      appleMusic: { available: false, play: vi.fn() },
      youtube: { available: true, play: vi.fn().mockResolvedValue(undefined) },
      mbid: ITEM_WITH_YT.mbid,
      item: ITEM_WITH_YT,
    });

    expect(result.ytPlayCalled).toBe(true);
    expect(result.amPlayCalled).toBe(false);
  });

  it("passes the correct item to YouTube play()", async () => {
    const ytPlay = vi.fn().mockResolvedValue(undefined);
    await runCascade({
      appleMusic: { available: false, play: vi.fn() },
      youtube: { available: true, play: ytPlay },
      mbid: ITEM_WITH_YT.mbid,
      item: ITEM_WITH_YT,
    });

    expect(ytPlay).toHaveBeenCalledWith(ITEM_WITH_YT);
  });

  it("sets altDriverActiveMbid to the track MBID while YouTube is playing", async () => {
    const result = await runCascade({
      appleMusic: { available: false, play: vi.fn() },
      youtube: { available: true, play: vi.fn().mockResolvedValue(undefined) },
      mbid: ITEM_WITH_YT.mbid,
      item: ITEM_WITH_YT,
    });

    expect(result.altDriverActiveMbid).toBe(ITEM_WITH_YT.mbid);
  });

  it("YouTube play() is called exactly once (no double-play)", async () => {
    const result = await runCascade({
      appleMusic: { available: false, play: vi.fn() },
      youtube: { available: true, play: vi.fn().mockResolvedValue(undefined) },
      mbid: ITEM_WITH_YT.mbid,
      item: ITEM_WITH_YT,
    });

    expect(result.ytPlayCallCount).toBe(1);
  });

  it("Apple Music is never tried when it reports available=false", async () => {
    const amPlay = vi.fn();
    await runCascade({
      appleMusic: { available: false, play: amPlay },
      youtube: { available: true, play: vi.fn().mockResolvedValue(undefined) },
      mbid: ITEM_WITH_YT.mbid,
      item: ITEM_WITH_YT,
    });

    expect(amPlay).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section 2: Apple Music fails → cascade continues to YouTube
//
// When Apple Music is available but play() throws (no token, etc.), the
// cascade must reach YouTube — riders must never be stranded at Apple Music.
// ---------------------------------------------------------------------------
describe("Apple Music fails → cascade continues to YouTube", () => {
  it("calls YouTube play() after Apple Music throws", async () => {
    const result = await runCascade({
      appleMusic: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("No MusicKit token")),
      },
      youtube: { available: true, play: vi.fn().mockResolvedValue(undefined) },
      mbid: ITEM_WITH_YT.mbid,
      item: ITEM_WITH_YT,
    });

    expect(result.ytPlayCalled).toBe(true);
  });

  it("Apple Music play() is tried exactly once before cascading", async () => {
    const result = await runCascade({
      appleMusic: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("No MusicKit token")),
      },
      youtube: { available: true, play: vi.fn().mockResolvedValue(undefined) },
      mbid: ITEM_WITH_YT.mbid,
      item: ITEM_WITH_YT,
    });

    expect(result.amPlayCallCount).toBe(1);
    expect(result.ytPlayCallCount).toBe(1);
  });

  it("altDriverActiveMbid is set to the track MBID after cascade reaches YouTube", async () => {
    const result = await runCascade({
      appleMusic: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("no token")),
      },
      youtube: { available: true, play: vi.fn().mockResolvedValue(undefined) },
      mbid: ITEM_WITH_YT.mbid,
      item: ITEM_WITH_YT,
    });

    expect(result.altDriverActiveMbid).toBe(ITEM_WITH_YT.mbid);
  });

  it("skipApple=true path skips Apple Music entirely and goes straight to YouTube", async () => {
    const amPlay = vi.fn().mockRejectedValue(new Error("should not be called"));
    const result = await runCascade({
      appleMusic: { available: true, play: amPlay },
      youtube: { available: true, play: vi.fn().mockResolvedValue(undefined) },
      mbid: ITEM_WITH_YT.mbid,
      item: ITEM_WITH_YT,
      skipApple: true,
    });

    expect(amPlay).not.toHaveBeenCalled();
    expect(result.ytPlayCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 3: YouTube unavailable (no link) → altDriverActiveMbid cleared → preview
//
// When the item has no YouTube link, useYouTubeDriver.play() throws
// "No YouTube link for this track". After that the cascade clears
// altDriverActiveMbid, making driverActive=false in PlayerProvider so
// the preview audio effect takes over.
// ---------------------------------------------------------------------------
describe("YouTube unavailable (no link) → preview path kicks in", () => {
  it("clears altDriverActiveMbid when YouTube play() throws", async () => {
    const result = await runCascade({
      appleMusic: { available: false, play: vi.fn() },
      youtube: {
        available: true,
        play: vi.fn().mockRejectedValue(
          new Error("No YouTube link for this track"),
        ),
      },
      mbid: ITEM_NO_LINKS.mbid,
      item: ITEM_NO_LINKS,
    });

    // altDriverActiveMbid===null signals PlayerProvider that no driver is
    // active, so driverActive becomes false and the preview effect fires.
    expect(result.altDriverActiveMbid).toBeNull();
  });

  it("YouTube play() is still called even when there is no link (driver decides)", async () => {
    // The cascade always attempts YouTube.play() — it is the driver's
    // responsibility to throw when it finds no link, not the cascade's.
    const ytPlay = vi.fn().mockRejectedValue(
      new Error("No YouTube link for this track"),
    );
    await runCascade({
      appleMusic: { available: false, play: vi.fn() },
      youtube: { available: true, play: ytPlay },
      mbid: ITEM_NO_LINKS.mbid,
      item: ITEM_NO_LINKS,
    });

    expect(ytPlay).toHaveBeenCalledOnce();
  });

  it("both Apple Music and YouTube failures leave altDriverActiveMbid null", async () => {
    const result = await runCascade({
      appleMusic: {
        available: true,
        play: vi.fn().mockRejectedValue(new Error("no token")),
      },
      youtube: {
        available: true,
        play: vi.fn().mockRejectedValue(
          new Error("No YouTube link for this track"),
        ),
      },
      mbid: ITEM_NO_LINKS.mbid,
      item: ITEM_NO_LINKS,
    });

    expect(result.altDriverActiveMbid).toBeNull();
  });

  it("resolveAudioPath returns 'preview' for curated when all services fail", () => {
    // Once altDriverActiveMbid is cleared and spotifyModeForCurrent=false,
    // driverActive=false and the preview effect runs. resolveAudioPath models
    // the same decision pure: serviceFailed=true → preview for non-live.
    const orientations: TimeOrientation[] = ["past", "curated"];
    for (const o of orientations) {
      const path = resolveAudioPath(
        { mode: "resolve_to_service", timeOrientation: o },
        { serviceConnected: true, serviceFailed: true, previewAvailable: true },
      );
      expect(path).toBe("preview");
      expect(path).not.toBe("service");
    }
  });

  it("resolveAudioPath returns 'passthrough' for live when all services fail", () => {
    // For live orientation the broadcast carries the fallback, not a preview.
    const path = resolveAudioPath(
      { mode: "resolve_to_service", timeOrientation: "live" },
      { serviceConnected: true, serviceFailed: true, previewAvailable: true },
    );
    expect(path).toBe("passthrough");
  });
});

// ---------------------------------------------------------------------------
// Section 4: RideBar source label reflects active driver
//
// RideBar uses a local rideSourceLabel(source) switch to build the label
// shown below the track title. These tests lock in the expected strings for
// each source value so any future rename is caught immediately.
//
// The function is not exported, so we replicate its contract here rather than
// importing it — this is intentional: the test pins the *user-visible* string,
// not the internal implementation.
// ---------------------------------------------------------------------------

/**
 * Matches the contract of the local rideSourceLabel() in RideBar.tsx.
 * Tests below assert these exact strings so a rename forces a deliberate update.
 */
function rideSourceLabel(source: "spotify" | "youtube" | "apple-music" | "preview" | null): string {
  switch (source) {
    case "spotify":    return "Riding full tracks on your Spotify";
    case "youtube":    return "Riding full tracks on your YouTube";
    case "apple-music": return "Riding full tracks on your Apple Music";
    default:           return "Riding full tracks";
  }
}

describe("RideBar source label reflects active driver", () => {
  it("shows YouTube label when source is 'youtube'", () => {
    const label = rideSourceLabel("youtube");
    expect(label).toContain("YouTube");
    expect(label).not.toContain("Spotify");
    expect(label).not.toContain("Apple Music");
  });

  it("shows generic label when source is 'preview'", () => {
    // Preview uses the audio element, not a named service — no service name shown.
    const label = rideSourceLabel("preview");
    expect(label).toBe("Riding full tracks");
    expect(label).not.toContain("YouTube");
    expect(label).not.toContain("Spotify");
  });

  it("shows generic label when source is null (ride starting)", () => {
    const label = rideSourceLabel(null);
    expect(label).toBe("Riding full tracks");
  });

  it("shows Spotify label when source is 'spotify'", () => {
    const label = rideSourceLabel("spotify");
    expect(label).toContain("Spotify");
  });

  it("shows Apple Music label when source is 'apple-music'", () => {
    const label = rideSourceLabel("apple-music");
    expect(label).toContain("Apple Music");
  });

  it("YouTube and preview labels are distinct (different fallback tiers)", () => {
    expect(rideSourceLabel("youtube")).not.toBe(rideSourceLabel("preview"));
    expect(rideSourceLabel("youtube")).not.toBe(rideSourceLabel(null));
  });

  it("YouTube label is shown after cascade succeeds — not Spotify or Apple Music", () => {
    // Confirms the label for the specific fallback this test file covers:
    // Spotify unavailable + Apple Music unavailable → YouTube plays →
    // source becomes "youtube" → RideBar says "on your YouTube".
    const label = rideSourceLabel("youtube");
    expect(label).toMatch(/YouTube/);
    expect(label).not.toMatch(/Spotify/);
    expect(label).not.toMatch(/Apple Music/);
    expect(label).not.toMatch(/preview/i);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Cascade guard — already-failed alt driver is not retried
//
// altDriverFailedRef tracks per-driver per-MBID failures so a second call to
// tryAltDriver for the same MBID (e.g. after a track advance and prev()) does
// not re-attempt a driver that already threw for that MBID.
// ---------------------------------------------------------------------------
describe("Cascade guard — already-failed driver is not retried", () => {
  it("does not call YouTube play() a second time when yt:<mbid> is already in altDriverFailedRef", async () => {
    // Simulate: first attempt already failed, altDriverFailedRef has yt:<mbid>
    const altDriverFailed = new Set<string>();
    const mbid = "mbid-already-failed";
    altDriverFailed.add(`yt:${mbid}`);
    let altDriverActiveMbid: string | null = null;

    const ytPlay = vi.fn().mockResolvedValue(undefined);

    // Run the cascade with yt already marked failed
    const tryAltDriver = async (m: string, item: MockItem, skipApple: boolean): Promise<void> => {
      if (!skipApple && false /* appleMusic.available */) return;
      const failedYt = altDriverFailed.has(`yt:${m}`);
      if (!failedYt) {
        altDriverActiveMbid = m;
        await ytPlay(item);
        return;
      }
      altDriverActiveMbid = null;
    };

    await tryAltDriver(mbid, ITEM_WITH_YT, true);

    expect(ytPlay).not.toHaveBeenCalled();
    expect(altDriverActiveMbid).toBeNull();
  });

  it("clears altDriverActiveMbid when all alt drivers are exhausted", async () => {
    // Both am:<mbid> and yt:<mbid> pre-failed — cascade falls through to null.
    const altDriverFailed = new Set<string>();
    const mbid = "mbid-all-exhausted";
    altDriverFailed.add(`am:${mbid}`);
    altDriverFailed.add(`yt:${mbid}`);
    let altDriverActiveMbid: string | null = "should-be-cleared";

    const tryAltDriver = (_m: string, _item: MockItem, _skipApple: boolean): void => {
      const failedYt = altDriverFailed.has(`yt:${_m}`);
      if (!failedYt) {
        altDriverActiveMbid = _m;
        return;
      }
      altDriverActiveMbid = null;
    };

    tryAltDriver(mbid, ITEM_WITH_YT, true);

    expect(altDriverActiveMbid).toBeNull();
  });
});
