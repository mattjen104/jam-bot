// @vitest-environment node
/**
 * Integration test: unenrollStationPoller clears resolution-latency state.
 *
 * Confirms that a station's ring-buffer samples are removed when it is
 * unenrolled, so the admin endpoint never surfaces stale slow-station data
 * for a station that has since been hidden or removed.
 *
 * Uses the same mock pattern as feed-freshness-poller.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordResolutionLatency,
  captureResolutionGeneration,
  getSlowResolutionStations,
  clearResolutionLatencyState,
  getResolutionLatencyStateSnapshot,
  SLOW_THRESHOLD_MS,
} from "../../src/lore/resolution-latency-health.js";

// ---------------------------------------------------------------------------
// Mock handles — vi.hoisted() so they exist before vi.mock() factories run.
// ---------------------------------------------------------------------------

const { mockLimit } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
}));

// ---- Module mocks ----------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const limit = mockLimit;
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return {
    ...actual,
    db: { select: vi.fn(() => ({ from })) },
    stationsTable: {},
    eq: vi.fn(),
  };
});

vi.mock("../../src/lore/adapters.js", () => ({
  getHistoryAdapter: vi.fn(() => null),
  getNowPlayingAdapter: vi.fn(() => null),
  fetchSpinitronWebWithOutcome: vi.fn(),
  hasSpinitronAuthentication: vi.fn(() => false),
  isPollable: vi.fn(() => true),
}));

vi.mock("../../src/lore/poller-health.js", () => ({
  startPollerHeartbeat: vi.fn(),
  stopPollerHeartbeat: vi.fn(),
  markPollerRosterEnrolled: vi.fn(),
  registerPollerStation: vi.fn(),
  unregisterPollerStation: vi.fn(),
  recordPollerAttempt: vi.fn(),
  recordPollerCompletion: vi.fn(),
}));

vi.mock("../../src/lore/resolve.js", () => ({
  ingestRawSpins: vi.fn().mockResolvedValue(0),
  logSpinIfChanged: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../src/lore/spinitron-web-health.js", () => ({
  recordSpinitronWebResult: vi.fn(() => ({ shouldWarn: false })),
  clearSpinitronWebState: vi.fn(),
}));

vi.mock("../../src/lore/host-multiplex.js", () => ({
  initHostMultiplex: vi.fn(),
  tryJoinHostGroup: vi.fn(() => false),
  queueHostProbe: vi.fn(),
  backfillHostProbes: vi.fn(),
  stopHostMultiplex: vi.fn(),
  getStationMultiplexTier: vi.fn(() => null),
  leaveHostGroups: vi.fn(),
}));

vi.mock("../../src/lore/icy-watcher.js", () => ({
  IcyWatcher: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

// Import the subject AFTER mocks are declared.
import { unenrollStationPoller } from "../../src/lore/poller.js";

/** Record a sample using the current (fresh) generation for the station. */
function record(stationId: number, slug: string, ms: number): void {
  const gen = captureResolutionGeneration(stationId);
  recordResolutionLatency(stationId, slug, ms, gen);
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  clearResolutionLatencyState();
});

// ---------------------------------------------------------------------------
// unenrollStationPoller clears latency state
// ---------------------------------------------------------------------------

describe("unenrollStationPoller clears resolution-latency state", () => {
  const STATION_ID = 9901;

  it("removes ring-buffer state for the unenrolled station", () => {
    // Seed some slow samples so the station would appear in the health report.
    for (let i = 0; i < 5; i++) {
      record(STATION_ID, "slow-station", SLOW_THRESHOLD_MS + 5_000);
    }
    expect(getResolutionLatencyStateSnapshot().has(STATION_ID)).toBe(true);

    unenrollStationPoller(STATION_ID);

    expect(getResolutionLatencyStateSnapshot().has(STATION_ID)).toBe(false);
  });

  it("removes the station from getSlowResolutionStations after unenroll", () => {
    for (let i = 0; i < 5; i++) {
      record(STATION_ID, "slow-station", SLOW_THRESHOLD_MS + 5_000);
    }
    expect(getSlowResolutionStations()).toHaveLength(1);

    unenrollStationPoller(STATION_ID);

    expect(getSlowResolutionStations()).toHaveLength(0);
  });

  it("does not clear latency state for other stations when unenrolling one", () => {
    const OTHER_ID = 9902;
    for (let i = 0; i < 3; i++) {
      record(STATION_ID, "slow-a", SLOW_THRESHOLD_MS + 5_000);
      record(OTHER_ID, "slow-b", SLOW_THRESHOLD_MS + 5_000);
    }

    unenrollStationPoller(STATION_ID);

    expect(getResolutionLatencyStateSnapshot().has(STATION_ID)).toBe(false);
    expect(getResolutionLatencyStateSnapshot().has(OTHER_ID)).toBe(true);
  });

  it("is a no-op for a station that has no latency samples yet", () => {
    // Should not throw.
    expect(() => unenrollStationPoller(STATION_ID)).not.toThrow();
    expect(getResolutionLatencyStateSnapshot().has(STATION_ID)).toBe(false);
  });

  it("queue-race: generation captured before enqueue is dropped when station is unenrolled before the callback runs", async () => {
    // This is the specific queue-race the generation guard must cover.
    //
    // Timeline:
    //   t0: logSpinIfChanged called — generation G captured BEFORE enqueueStationWork
    //   t1: work is queued (sits behind a slow prior resolution)
    //   t2: station is unenrolled — generation bumps to G+1
    //   t3: prior resolution finishes, queued callback starts
    //   t4: callback tries to record with generation G — must be DROPPED
    //
    // We mirror exactly what logSpinIfChanged now does: capture generation
    // synchronously before scheduling, then simulate the unenroll happening
    // while the queued work is waiting, then complete the work.

    // t0: generation captured at queue time (before enqueueStationWork)
    const queuedGeneration = captureResolutionGeneration(STATION_ID);

    // t1–t2: yield to simulate prior work holding the chain, then unenroll
    await Promise.resolve();
    unenrollStationPoller(STATION_ID); // bumps generation to G+1

    // t3–t4: queued callback runs, tries to record with the pre-unenroll generation
    recordResolutionLatency(
      STATION_ID,
      "slow-station",
      SLOW_THRESHOLD_MS + 5_000,
      queuedGeneration, // stale — captured before unenroll
    );

    // Sample must be dropped — the unenrolled station must not reappear.
    expect(getResolutionLatencyStateSnapshot().has(STATION_ID)).toBe(false);
    expect(getSlowResolutionStations()).toHaveLength(0);
  });
});
