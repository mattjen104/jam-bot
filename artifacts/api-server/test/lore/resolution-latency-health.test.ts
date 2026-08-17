/**
 * Unit tests for resolution-latency-health.ts
 *
 * The module is pure in-memory so no DB or network setup is needed.
 * Each test clears state via clearResolutionLatencyState().
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordResolutionLatency,
  captureResolutionGeneration,
  getSlowResolutionStations,
  getAllResolutionLatencyStations,
  clearResolutionLatencyState,
  getResolutionLatencyStateSnapshot,
  RING_SIZE,
  SLOW_THRESHOLD_MS,
} from "../../src/lore/resolution-latency-health.js";

/** Record a sample using the current generation (normal, non-stale path). */
function record(stationId: number, slug: string, ms: number): void {
  const gen = captureResolutionGeneration(stationId);
  recordResolutionLatency(stationId, slug, ms, gen);
}

beforeEach(() => {
  clearResolutionLatencyState();
});

// ---------------------------------------------------------------------------
// recordResolutionLatency
// ---------------------------------------------------------------------------

describe("recordResolutionLatency — basic recording", () => {
  it("creates an entry on first record", () => {
    record(1, "kexp", 500);
    const snap = getResolutionLatencyStateSnapshot().get(1)!;
    expect(snap).toBeDefined();
    expect(snap.stationId).toBe(1);
    expect(snap.slug).toBe("kexp");
    expect(snap.count).toBe(1);
    expect(snap.samples[0]).toBe(500);
  });

  it("accumulates multiple samples for the same station", () => {
    record(1, "kexp", 100);
    record(1, "kexp", 200);
    record(1, "kexp", 300);
    const snap = getResolutionLatencyStateSnapshot().get(1)!;
    expect(snap.count).toBe(3);
  });

  it("tracks multiple stations independently", () => {
    record(1, "kexp", 100);
    record(2, "somafm", 20_000);
    expect(getResolutionLatencyStateSnapshot().size).toBe(2);
    expect(getResolutionLatencyStateSnapshot().get(1)!.count).toBe(1);
    expect(getResolutionLatencyStateSnapshot().get(2)!.count).toBe(1);
  });

  it("wraps the ring buffer after RING_SIZE samples without growing beyond it", () => {
    for (let i = 0; i < RING_SIZE + 10; i++) {
      record(1, "kexp", i * 100);
    }
    const snap = getResolutionLatencyStateSnapshot().get(1)!;
    expect(snap.count).toBe(RING_SIZE);
    expect(snap.samples.length).toBe(RING_SIZE);
  });

  it("ring buffer overwrites oldest sample when full", () => {
    // Fill the ring with a known sentinel value.
    for (let i = 0; i < RING_SIZE; i++) {
      record(1, "kexp", 1000);
    }
    // Add one more with a different value — it should overwrite.
    record(1, "kexp", 99_999);
    const snap = getResolutionLatencyStateSnapshot().get(1)!;
    expect(snap.count).toBe(RING_SIZE);
    expect(snap.samples).toContain(99_999);
  });

  it("updates slug when it changes", () => {
    record(1, "old-slug", 500);
    record(1, "new-slug", 600);
    const snap = getResolutionLatencyStateSnapshot().get(1)!;
    expect(snap.slug).toBe("new-slug");
  });
});

// ---------------------------------------------------------------------------
// Generation guard — prevents stale in-flight samples from landing
// ---------------------------------------------------------------------------

describe("generation guard", () => {
  it("drops a sample when the generation is stale (unenroll happened after capture)", () => {
    // Capture generation BEFORE unenroll.
    const staleGen = captureResolutionGeneration(1);
    // Unenroll bumps the generation.
    clearResolutionLatencyState(1);
    // In-flight work now tries to record with the stale generation — must be dropped.
    recordResolutionLatency(1, "kexp", 20_000, staleGen);
    expect(getResolutionLatencyStateSnapshot().has(1)).toBe(false);
  });

  it("accepts a sample captured after unenroll (re-enrollment scenario)", () => {
    // Unenroll bumps generation.
    clearResolutionLatencyState(1);
    // New work starts after unenroll — captures the new generation.
    const freshGen = captureResolutionGeneration(1);
    recordResolutionLatency(1, "kexp", 500, freshGen);
    expect(getResolutionLatencyStateSnapshot().get(1)!.count).toBe(1);
  });

  it("stale sample does not appear in slow-station report", () => {
    const staleGen = captureResolutionGeneration(1);
    clearResolutionLatencyState(1);
    // In-flight slow sample with stale generation.
    recordResolutionLatency(1, "slow", SLOW_THRESHOLD_MS + 10_000, staleGen);
    expect(getSlowResolutionStations()).toHaveLength(0);
  });

  it("multiple unenrolls accumulate generation bumps", () => {
    clearResolutionLatencyState(1);
    clearResolutionLatencyState(1);
    const gen = captureResolutionGeneration(1);
    // Only samples with gen === 2 land.
    recordResolutionLatency(1, "kexp", 500, 0); // stale (gen 0)
    recordResolutionLatency(1, "kexp", 500, 1); // stale (gen 1)
    expect(getResolutionLatencyStateSnapshot().has(1)).toBe(false);
    recordResolutionLatency(1, "kexp", 500, gen); // fresh
    expect(getResolutionLatencyStateSnapshot().get(1)!.count).toBe(1);
  });

  it("simulates the async race: work starts, station unenrolled, work completes — sample dropped", async () => {
    // Simulate: logSpinIfChangedInner captures generation at work-start.
    const capturedGen = captureResolutionGeneration(1);

    // Simulate async resolution delay — station is unenrolled in the meantime.
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        clearResolutionLatencyState(1); // unenroll during resolution
        resolve();
      });
    });

    // Resolution completes and tries to record — must be a no-op.
    recordResolutionLatency(1, "kexp", SLOW_THRESHOLD_MS + 5_000, capturedGen);

    expect(getResolutionLatencyStateSnapshot().has(1)).toBe(false);
    expect(getSlowResolutionStations()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getSlowResolutionStations — empty / fast stations
// ---------------------------------------------------------------------------

describe("getSlowResolutionStations — empty / fast stations", () => {
  it("returns empty array when nothing is tracked", () => {
    expect(getSlowResolutionStations()).toEqual([]);
  });

  it("returns empty array when all stations are fast", () => {
    record(1, "kexp", 200);
    record(1, "kexp", 300);
    expect(getSlowResolutionStations()).toEqual([]);
  });
});

describe("getSlowResolutionStations — slow stations", () => {
  it("returns a station whose median exceeds the threshold", () => {
    // Record 3 samples: all above threshold
    for (let i = 0; i < 3; i++) {
      record(1, "slow-station", SLOW_THRESHOLD_MS + 5_000);
    }
    const slow = getSlowResolutionStations();
    expect(slow).toHaveLength(1);
    expect(slow[0]!.stationId).toBe(1);
    expect(slow[0]!.slug).toBe("slow-station");
    expect(slow[0]!.medianMs).toBeGreaterThan(SLOW_THRESHOLD_MS);
    expect(slow[0]!.slow).toBe(true);
  });

  it("does not return a station whose median is exactly at the threshold (must exceed)", () => {
    for (let i = 0; i < 3; i++) {
      record(1, "borderline", SLOW_THRESHOLD_MS);
    }
    expect(getSlowResolutionStations()).toEqual([]);
  });

  it("excludes fast stations even when a slow station is present", () => {
    record(1, "fast", 200);
    record(1, "fast", 300);

    for (let i = 0; i < 3; i++) record(2, "slow", SLOW_THRESHOLD_MS + 10_000);

    const slow = getSlowResolutionStations();
    expect(slow).toHaveLength(1);
    expect(slow[0]!.stationId).toBe(2);
  });

  it("sorts by medianMs descending (slowest first)", () => {
    // Station 1: median ~20s
    for (let i = 0; i < 3; i++) record(1, "medium-slow", 20_000);
    // Station 2: median ~35s
    for (let i = 0; i < 3; i++) record(2, "very-slow", 35_000);

    const slow = getSlowResolutionStations();
    expect(slow).toHaveLength(2);
    expect(slow[0]!.stationId).toBe(2); // very-slow first
    expect(slow[1]!.stationId).toBe(1);
  });

  it("computes correct median for an odd number of samples", () => {
    // Sorted: [10000, 20000, 30000] → median = 20000
    record(1, "s", 30_000);
    record(1, "s", 10_000);
    record(1, "s", 20_000);
    const slow = getSlowResolutionStations();
    expect(slow[0]!.medianMs).toBe(20_000);
  });

  it("computes correct median for an even number of samples", () => {
    // Sorted: [16000, 20000] → median = 18000
    record(1, "s", 16_000);
    record(1, "s", 20_000);
    const slow = getSlowResolutionStations();
    expect(slow[0]!.medianMs).toBe(18_000);
  });

  it("returns p95Ms >= medianMs", () => {
    for (let i = 0; i < 20; i++) {
      record(1, "s", 16_000 + i * 1_000);
    }
    const slow = getSlowResolutionStations();
    expect(slow[0]!.p95Ms).toBeGreaterThanOrEqual(slow[0]!.medianMs);
  });

  it("returns maxMs as the largest sample", () => {
    record(1, "s", 16_000);
    record(1, "s", 60_000);
    record(1, "s", 20_000);
    const slow = getSlowResolutionStations();
    expect(slow[0]!.maxMs).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// getAllResolutionLatencyStations
// ---------------------------------------------------------------------------

describe("getAllResolutionLatencyStations", () => {
  it("includes both fast and slow stations", () => {
    record(1, "fast", 200);
    for (let i = 0; i < 3; i++) record(2, "slow", 20_000);

    const all = getAllResolutionLatencyStations();
    expect(all).toHaveLength(2);
  });

  it("returns empty array when nothing is tracked", () => {
    expect(getAllResolutionLatencyStations()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// clearResolutionLatencyState
// ---------------------------------------------------------------------------

describe("clearResolutionLatencyState", () => {
  it("removes state for a specific station", () => {
    record(1, "kexp", 500);
    record(2, "somafm", 500);
    clearResolutionLatencyState(1);
    expect(getResolutionLatencyStateSnapshot().has(1)).toBe(false);
    expect(getResolutionLatencyStateSnapshot().has(2)).toBe(true);
  });

  it("clears all state when called without arguments", () => {
    record(1, "kexp", 500);
    record(2, "somafm", 500);
    clearResolutionLatencyState();
    expect(getResolutionLatencyStateSnapshot().size).toBe(0);
  });

  it("clears all generation state too when called without arguments", () => {
    // After a full clear, generation resets so subsequent samples with gen=0 land.
    clearResolutionLatencyState(1); // bumps to 1
    clearResolutionLatencyState();  // resets everything
    const gen = captureResolutionGeneration(1); // should be 0 again
    expect(gen).toBe(0);
    recordResolutionLatency(1, "kexp", 500, 0);
    expect(getResolutionLatencyStateSnapshot().get(1)!.count).toBe(1);
  });
});
