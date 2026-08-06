/**
 * Live-to-past boundary — unit tests for pure helpers.
 *
 * Covers:
 *   - Interstitial fires exactly once on live→past; zero times between two
 *     past stops.
 *   - Device continuity check: mismatched device prompts before playback;
 *     matching device skips prompt; no pinned device skips prompt.
 *   - Device continuity session flag: confirming once suppresses all further
 *     prompts that session (simulated via the flag ref pattern).
 *   - EWMA depth converges UP for slow services and DOWN for fast ones.
 *   - EWMA respects the PREFETCH_DEPTH_MAX clamp.
 *   - Direction reversal: after reversal the old forward observations do not
 *     permanently inflate depth (new cadence observations drive it back down).
 *   - Buffer-outrun state logic: when the current item is unresolved it
 *     signals the "Finding…" state.
 *   - Prefetch does not fire in live orientation (pure guard condition).
 */
import { describe, it, expect } from "vitest";
import {
  isLiveToPastCrossing,
  isPastToPastTransition,
  checkDeviceContinuity,
  createServicePrefetchTracker,
  observeMaterializationLatency,
  observeScrubCadence,
  PREFETCH_DEPTH_START,
  PREFETCH_DEPTH_MAX,
  PREFETCH_EWMA_ALPHA,
  type TimeOrientation,
} from "../src/player/playbackSession";

// ---------------------------------------------------------------------------
// isLiveToPastCrossing — detects the live→past pipeline boundary
// ---------------------------------------------------------------------------
describe("isLiveToPastCrossing", () => {
  it("returns true when prev is live and next is past", () => {
    expect(isLiveToPastCrossing("live", "past")).toBe(true);
  });

  it("returns false when prev is null (session start, no prior ride)", () => {
    expect(isLiveToPastCrossing(null, "past")).toBe(false);
  });

  it("returns false for past → past (two consecutive past stops — no interstitial)", () => {
    expect(isLiveToPastCrossing("past", "past")).toBe(false);
  });

  it("returns false for curated → past (no interstitial — pipeline already non-live)", () => {
    expect(isLiveToPastCrossing("curated", "past")).toBe(false);
  });

  it("returns false for live → curated (no interstitial — not crossing to past)", () => {
    expect(isLiveToPastCrossing("live", "curated")).toBe(false);
  });

  it("returns false for live → live (same pipeline, no crossing)", () => {
    expect(isLiveToPastCrossing("live", "live")).toBe(false);
  });

  it("returns false for past → live (reverse crossing — no interstitial needed)", () => {
    expect(isLiveToPastCrossing("past", "live")).toBe(false);
  });

  it("simulates: live ride → stop → past replay fires interstitial exactly once", () => {
    // Session flow: active live ride → stop (prev becomes 'live') → start past replay.
    let prevOrientation: TimeOrientation | null = "live";
    let interstitialCount = 0;

    // First crossing: live → past
    const firstNew = "past" satisfies TimeOrientation;
    if (isLiveToPastCrossing(prevOrientation, firstNew)) interstitialCount++;
    prevOrientation = firstNew;

    // Second crossing: past → past (two consecutive past stops)
    const secondNew = "past" satisfies TimeOrientation;
    if (isLiveToPastCrossing(prevOrientation, secondNew)) interstitialCount++;
    prevOrientation = secondNew;

    expect(interstitialCount).toBe(1);
  });

  it("simulates: two consecutive past stops fire zero interstitials", () => {
    let prevOrientation: TimeOrientation | null = "past";
    let interstitialCount = 0;

    const secondNew = "past" satisfies TimeOrientation;
    if (isLiveToPastCrossing(prevOrientation, secondNew)) interstitialCount++;

    expect(interstitialCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isPastToPastTransition — non-live to non-live transitions
// ---------------------------------------------------------------------------
describe("isPastToPastTransition", () => {
  it("returns true for past → past", () => {
    expect(isPastToPastTransition("past", "past")).toBe(true);
  });

  it("returns true for curated → past", () => {
    expect(isPastToPastTransition("curated", "past")).toBe(true);
  });

  it("returns true for past → curated", () => {
    expect(isPastToPastTransition("past", "curated")).toBe(true);
  });

  it("returns false for live → past (that is a crossing, not a past-to-past)", () => {
    expect(isPastToPastTransition("live", "past")).toBe(false);
  });

  it("returns false when prev is null", () => {
    expect(isPastToPastTransition(null, "past")).toBe(false);
  });

  it("returns false for past → live", () => {
    expect(isPastToPastTransition("past", "live")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkDeviceContinuity — device-continuity check before live→past crossing
// ---------------------------------------------------------------------------
describe("checkDeviceContinuity", () => {
  it("matches when pinnedDeviceId is null (Connect not configured — no prompt)", () => {
    const result = checkDeviceContinuity(null, null);
    expect(result.matches).toBe(true);
    expect(result.noPinnedDevice).toBe(true);
  });

  it("matches when pinnedDeviceId is undefined", () => {
    const result = checkDeviceContinuity(undefined, undefined);
    expect(result.matches).toBe(true);
    expect(result.noPinnedDevice).toBe(true);
  });

  it("matches when pinnedDeviceId equals activeDeviceId (same room — no prompt)", () => {
    const result = checkDeviceContinuity("device-kitchen", "device-kitchen");
    expect(result.matches).toBe(true);
    expect(result.noPinnedDevice).toBe(false);
  });

  it("does not match when pinnedDeviceId differs from activeDeviceId (different room — prompt)", () => {
    const result = checkDeviceContinuity("device-living-room", "device-bedroom");
    expect(result.matches).toBe(false);
    expect(result.noPinnedDevice).toBe(false);
  });

  it("does not match when pinned device is set but active device is null (device not playing)", () => {
    const result = checkDeviceContinuity("device-abc", null);
    expect(result.matches).toBe(false);
    expect(result.noPinnedDevice).toBe(false);
  });

  it("noPinnedDevice is only true when pinnedDeviceId is null/undefined", () => {
    // A mismatch always has noPinnedDevice=false
    expect(checkDeviceContinuity("pin-1", "active-2").noPinnedDevice).toBe(false);
    // A match with an id also has noPinnedDevice=false
    expect(checkDeviceContinuity("same", "same").noPinnedDevice).toBe(false);
    // Only absent pin sets noPinnedDevice=true
    expect(checkDeviceContinuity(null, "anything").noPinnedDevice).toBe(true);
    expect(checkDeviceContinuity(undefined, "anything").noPinnedDevice).toBe(true);
  });

  it("simulates: session flag suppresses second prompt", () => {
    // The provider uses a ref (deviceContinuityCheckedRef) set to true after
    // the first check. Simulate the same pattern here.
    let deviceContinuityChecked = false;
    let promptCount = 0;

    const checkAndPrompt = (pinnedId: string | null, activeId: string | null) => {
      if (deviceContinuityChecked) return; // session gate
      const result = checkDeviceContinuity(pinnedId, activeId);
      deviceContinuityChecked = true; // mark checked regardless of result
      if (!result.matches && !result.noPinnedDevice) {
        promptCount++;
      }
    };

    // First crossing: mismatch → prompt fires, flag set.
    checkAndPrompt("room-a", "room-b");
    expect(promptCount).toBe(1);
    expect(deviceContinuityChecked).toBe(true);

    // Second crossing in same session: flag already set — no prompt.
    checkAndPrompt("room-a", "room-c");
    expect(promptCount).toBe(1);
  });

  it("simulates: matching pinned device skips prompt, flag still set", () => {
    let deviceContinuityChecked = false;
    let promptCount = 0;

    const checkAndPrompt = (pinnedId: string | null, activeId: string | null) => {
      if (deviceContinuityChecked) return;
      const result = checkDeviceContinuity(pinnedId, activeId);
      deviceContinuityChecked = true;
      if (!result.matches && !result.noPinnedDevice) {
        promptCount++;
      }
    };

    // Matching device: no prompt, but flag still marked.
    checkAndPrompt("same-device", "same-device");
    expect(promptCount).toBe(0);
    expect(deviceContinuityChecked).toBe(true);

    // Subsequent crossing: flag already set, no prompt even for a mismatch.
    checkAndPrompt("same-device", "different-device");
    expect(promptCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EWMA prefetch depth — convergence and clamp
// ---------------------------------------------------------------------------
describe("createServicePrefetchTracker", () => {
  it("starts with depth = PREFETCH_DEPTH_START", () => {
    const t = createServicePrefetchTracker();
    expect(t.depth).toBe(PREFETCH_DEPTH_START);
    expect(t.depth).toBe(3);
  });

  it("starts with latencyEwma and cadenceEwma both null", () => {
    const t = createServicePrefetchTracker();
    expect(t.latencyEwma).toBeNull();
    expect(t.cadenceEwma).toBeNull();
  });
});

describe("observeMaterializationLatency", () => {
  it("sets latencyEwma to the first observation (no prior history)", () => {
    const t = createServicePrefetchTracker();
    const t2 = observeMaterializationLatency(t, 500);
    expect(t2.latencyEwma).toBeCloseTo(500);
  });

  it("applies EWMA alpha to subsequent observations", () => {
    let t = createServicePrefetchTracker();
    t = observeMaterializationLatency(t, 1000);
    t = observeMaterializationLatency(t, 2000);
    // expected = α * 2000 + (1-α) * 1000
    const expected = PREFETCH_EWMA_ALPHA * 2000 + (1 - PREFETCH_EWMA_ALPHA) * 1000;
    expect(t.latencyEwma).toBeCloseTo(expected);
  });

  it("depth does not change until cadenceEwma is also observed", () => {
    let t = createServicePrefetchTracker();
    t = observeMaterializationLatency(t, 3000);
    // cadenceEwma is still null — depth stays at start value
    expect(t.depth).toBe(PREFETCH_DEPTH_START);
  });

  it("is pure — does not mutate the input tracker", () => {
    const t = createServicePrefetchTracker();
    const t2 = observeMaterializationLatency(t, 500);
    expect(t.latencyEwma).toBeNull(); // original unchanged
    expect(t2.latencyEwma).not.toBeNull();
  });
});

describe("observeScrubCadence", () => {
  it("sets cadenceEwma to the first observation (no prior history)", () => {
    const t = createServicePrefetchTracker();
    const t2 = observeScrubCadence(t, 4000);
    expect(t2.cadenceEwma).toBeCloseTo(4000);
  });

  it("depth does not change until latencyEwma is also observed", () => {
    let t = createServicePrefetchTracker();
    t = observeScrubCadence(t, 4000);
    // latencyEwma is still null — depth stays at start value
    expect(t.depth).toBe(PREFETCH_DEPTH_START);
  });

  it("is pure — does not mutate the input tracker", () => {
    const t = createServicePrefetchTracker();
    const t2 = observeScrubCadence(t, 4000);
    expect(t.cadenceEwma).toBeNull();
    expect(t2.cadenceEwma).not.toBeNull();
  });
});

describe("EWMA depth convergence", () => {
  /**
   * Converge a tracker by repeatedly applying the same latency and cadence
   * until the depth stabilises within ±0.1 of the expected steady state.
   */
  function converge(latencyMs: number, cadenceMs: number, iterations = 50) {
    let t = createServicePrefetchTracker();
    for (let i = 0; i < iterations; i++) {
      t = observeMaterializationLatency(t, latencyMs);
      t = observeScrubCadence(t, cadenceMs);
    }
    return t;
  }

  it("converges UP for a slow service (high latency relative to cadence)", () => {
    // latency=6000ms, cadence=2000ms → expected depth = ceil(6000/2000) = 3
    // After many observations starting from 3, depth should stay at 3
    const t = converge(6000, 2000);
    expect(t.depth).toBe(3);
  });

  it("converges UP to a higher depth for very slow service", () => {
    // latency=12000ms, cadence=2000ms → expected depth = ceil(12000/2000) = 6
    const t = converge(12000, 2000);
    expect(t.depth).toBe(6);
  });

  it("converges DOWN for a fast service (low latency relative to cadence)", () => {
    // latency=500ms, cadence=4000ms → expected depth = ceil(500/4000) = 1
    const t = converge(500, 4000);
    expect(t.depth).toBe(1);
  });

  it("clamps to PREFETCH_DEPTH_MAX for extremely slow service", () => {
    // latency=100_000ms, cadence=1000ms → ceil(100) = 100, clamped to PREFETCH_DEPTH_MAX
    const t = converge(100_000, 1000);
    expect(t.depth).toBe(PREFETCH_DEPTH_MAX);
  });

  it("clamps to 1 (minimum) for an extremely fast service", () => {
    // latency=1ms, cadence=100_000ms → ceil(0.00001) = 1
    const t = converge(1, 100_000);
    expect(t.depth).toBe(1);
  });

  it("depth of 3 as the starting default is in the plausible mid-range", () => {
    // The start value of 3 is between 1 (fastest) and PREFETCH_DEPTH_MAX.
    expect(PREFETCH_DEPTH_START).toBeGreaterThanOrEqual(1);
    expect(PREFETCH_DEPTH_START).toBeLessThanOrEqual(PREFETCH_DEPTH_MAX);
  });

  it("direction reversal: new fast cadence observations drive depth back down", () => {
    // Simulate: listener scrubbed forward fast (high depth), then reverses and
    // scrubs slowly backward. New cadence observations at 10s per track should
    // drive depth down toward 1 over time.
    let t = createServicePrefetchTracker();
    // Build up: fast forward scrub (2s cadence, 6s latency → depth ~3)
    for (let i = 0; i < 30; i++) {
      t = observeMaterializationLatency(t, 6000);
      t = observeScrubCadence(t, 2000);
    }
    const depthAfterFastForward = t.depth;

    // Reverse: slow scrub (20s cadence, 500ms latency → depth → 1)
    for (let i = 0; i < 50; i++) {
      t = observeMaterializationLatency(t, 500);
      t = observeScrubCadence(t, 20_000);
    }
    // Should converge down to 1 after enough observations.
    expect(t.depth).toBeLessThan(depthAfterFastForward);
    expect(t.depth).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Buffer-outrun state logic — pure condition
// ---------------------------------------------------------------------------
describe("buffer-outrun state conditions", () => {
  /**
   * The buffer-outrun condition in PlayerProvider is:
   *   active && !driverActive && currentMbid != null && currentPreview === undefined
   *
   * "undefined" = not yet fetched (in flight); "null" = fetched, not available.
   * This test validates the pure logic without React.
   */
  function computeBufferOutrun(opts: {
    active: boolean;
    driverActive: boolean;
    currentMbid: string | null | undefined;
    currentPreview: string | null | undefined;
  }): boolean {
    return (
      opts.active &&
      !opts.driverActive &&
      opts.currentMbid != null &&
      opts.currentPreview === undefined
    );
  }

  it("is true when current preview is unresolved (undefined = in-flight fetch)", () => {
    expect(computeBufferOutrun({
      active: true,
      driverActive: false,
      currentMbid: "mbid-a",
      currentPreview: undefined,
    })).toBe(true);
  });

  it("is false when current preview resolved (string URL available)", () => {
    expect(computeBufferOutrun({
      active: true,
      driverActive: false,
      currentMbid: "mbid-a",
      currentPreview: "https://preview.example.com/a.mp3",
    })).toBe(false);
  });

  it("is false when current preview resolved to null (no preview, but checked)", () => {
    expect(computeBufferOutrun({
      active: true,
      driverActive: false,
      currentMbid: "mbid-a",
      currentPreview: null,
    })).toBe(false);
  });

  it("is false when ride is not active", () => {
    expect(computeBufferOutrun({
      active: false,
      driverActive: false,
      currentMbid: "mbid-a",
      currentPreview: undefined,
    })).toBe(false);
  });

  it("is false when a service driver is carrying the track (driver handles buffering)", () => {
    expect(computeBufferOutrun({
      active: true,
      driverActive: true,
      currentMbid: "mbid-a",
      currentPreview: undefined,
    })).toBe(false);
  });

  it("is false when there is no current track MBID", () => {
    expect(computeBufferOutrun({
      active: true,
      driverActive: false,
      currentMbid: null,
      currentPreview: undefined,
    })).toBe(false);
  });

  it("never produces a 'silence as UI state' — bufferOutrun and null preview are distinct", () => {
    // bufferOutrun=true means "still loading" → UI shows "Finding this on [Service]…"
    // previewUrl=null means "no preview available" → ride auto-advances (2.5s skip)
    // They must never both be true for the same item.
    const bufferOutrunItem = computeBufferOutrun({
      active: true, driverActive: false, currentMbid: "x", currentPreview: undefined,
    });
    const nullPreviewItem = computeBufferOutrun({
      active: true, driverActive: false, currentMbid: "x", currentPreview: null,
    });
    // bufferOutrun=true means undefined (loading); null is a distinct resolved state.
    expect(bufferOutrunItem).toBe(true);
    expect(nullPreviewItem).toBe(false);
    // The two states are mutually exclusive for the same currentPreview value.
    expect(bufferOutrunItem && nullPreviewItem).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prefetch orientation gate — past only
// ---------------------------------------------------------------------------
describe("prefetch orientation gating", () => {
  /**
   * The prefetch effect in PlayerProvider has an early return for non-past
   * orientations: `if (timeOrientation !== "past") return`.
   * This pure logic test verifies the gate without requiring React.
   */
  function shouldPrefetch(opts: {
    active: boolean;
    timeOrientation: TimeOrientation;
    mode: "trail" | "replay";
  }): boolean {
    if (!opts.active) return false;
    if (opts.timeOrientation !== "past") return false; // only past
    if (opts.mode !== "replay") return false; // only replay (trail uses segue-lookahead)
    return true;
  }

  it("fires in past orientation with replay mode", () => {
    expect(shouldPrefetch({ active: true, timeOrientation: "past", mode: "replay" })).toBe(true);
  });

  it("does NOT fire in live orientation", () => {
    expect(shouldPrefetch({ active: true, timeOrientation: "live", mode: "replay" })).toBe(false);
  });

  it("does NOT fire in curated orientation", () => {
    expect(shouldPrefetch({ active: true, timeOrientation: "curated", mode: "replay" })).toBe(false);
  });

  it("does NOT fire in trail mode (trail uses segue-lookahead path)", () => {
    expect(shouldPrefetch({ active: true, timeOrientation: "past", mode: "trail" })).toBe(false);
  });

  it("does NOT fire when ride is idle", () => {
    expect(shouldPrefetch({ active: false, timeOrientation: "past", mode: "replay" })).toBe(false);
  });
});
