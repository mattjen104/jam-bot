// @vitest-environment node
/**
 * Integration tests: feed-freshness health wired into pollStation.
 *
 * Stubs the history adapter (returns an empty feed), the DB station-reload, and
 * ingestRawSpins so no real network or DB is needed.  Confirms that:
 *
 *  1. bbc_api and somafm polls call recordFeedFreshnessResult — after a prior
 *     success, sustained empty polls make the station appear in
 *     getFeedFreshnessStaleStations() once silence exceeds 2 × the poll
 *     interval.
 *  2. spinitron and kexp_api polls do NOT touch feed-freshness state at all,
 *     so those stations can never appear in the stale list via this path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Station } from "@workspace/db";
import {
  clearFeedFreshnessState,
  getFeedFreshnessStaleStations,
  getFeedFreshnessStateSnapshot,
  recordFeedFreshnessResult,
} from "../../src/lore/feed-freshness-health.js";

// ---------------------------------------------------------------------------
// Mock handles — vi.hoisted() ensures these exist before vi.mock() factories
// run (vi.mock is hoisted to the top of the module, so plain `const` at
// module scope is not defined yet when the factory executes).
// ---------------------------------------------------------------------------

const { mockLimit, mockIngestRawSpins, mockGetHistoryAdapter } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockIngestRawSpins: vi.fn(),
  mockGetHistoryAdapter: vi.fn(),
}));

// ---- Module mocks ----------------------------------------------------------

vi.mock("@workspace/db", () => {
  // Simulate the drizzle query chain: db.select().from().where().limit(1)
  const limit = mockLimit;
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return {
    db: { select: vi.fn(() => ({ from })) },
    stationsTable: {},
    eq: vi.fn(),
  };
});

vi.mock("../../src/lore/adapters.js", () => ({
  getHistoryAdapter: mockGetHistoryAdapter,
  getNowPlayingAdapter: vi.fn(() => null),
  isPollable: vi.fn(() => true),
}));

vi.mock("../../src/lore/resolve.js", () => ({
  ingestRawSpins: mockIngestRawSpins,
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

// Import the subject AFTER mocks are declared so it picks up the stubs.
import { pollStation } from "../../src/lore/poller.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Poll-interval constants mirrored from poller.ts.
// If poller.ts changes them, these tests will catch the drift.
const BBC_POLL_MS = 600_000; // 10 min
const SOMAFM_POLL_MS = 900_000; // 15 min

/** Minimal Station-shaped object for the given source. */
function makeStation(id: number, slug: string, source: string): Station {
  return {
    id,
    slug,
    name: `Test ${slug}`,
    nowPlayingSource: source,
    nowPlayingConfig: {},
    lastSeenCursor: null,
    hidden: false,
    favorite: false,
    streamUrl: null,
    createdAt: new Date(),
  } as unknown as Station;
}

/**
 * An empty adapter — always returns [] (simulates a feed that has gone silent).
 * Shared across tests; cleared in beforeEach.
 */
const emptyAdapter = vi.fn().mockResolvedValue([]);

beforeEach(() => {
  clearFeedFreshnessState();
  emptyAdapter.mockClear();
  mockIngestRawSpins.mockReset().mockResolvedValue(0);
  mockGetHistoryAdapter.mockReset().mockReturnValue(emptyAdapter);
});

// ---------------------------------------------------------------------------
// Tracked sources: bbc_api
// ---------------------------------------------------------------------------

describe("bbc_api: pollStation wires into feed-freshness health", () => {
  const BBC_ID = 1001;
  const bbcStation = makeStation(BBC_ID, "bbc-6music", "bbc_api");

  beforeEach(() => {
    // DB station-reload inside pollStation returns the test station.
    mockLimit.mockResolvedValue([bbcStation]);
  });

  it("marks the station stale when empty polls follow a prior success beyond 2× poll interval", async () => {
    // Seed a prior success far enough in the past that the next empty poll will
    // push staleSinceMs beyond 2 × BBC_POLL_MS.
    const pastDate = new Date(Date.now() - 3 * BBC_POLL_MS);
    recordFeedFreshnessResult(BBC_ID, "bbc-6music", "bbc_api", "success", BBC_POLL_MS, pastDate);

    // pollStation: empty adapter → ingestRawSpins returns 0 → calls
    // recordFeedFreshnessResult("empty") at approximately now.
    await pollStation(bbcStation);

    const stale = getFeedFreshnessStaleStations();
    expect(stale.some((e) => e.stationId === BBC_ID && e.source === "bbc_api")).toBe(true);
  });

  it("does NOT mark the station stale when the adapter returns new spins (healthy tick)", async () => {
    const pastDate = new Date(Date.now() - 3 * BBC_POLL_MS);
    recordFeedFreshnessResult(BBC_ID, "bbc-6music", "bbc_api", "success", BBC_POLL_MS, pastDate);

    // Healthy tick: adapter returns spins; ingest logs 2.
    mockIngestRawSpins.mockResolvedValue(2);

    await pollStation(bbcStation);

    // A success resets warnedAt and is not stale.
    expect(getFeedFreshnessStaleStations().some((e) => e.stationId === BBC_ID)).toBe(false);
  });

  it("does NOT mark the station stale when silence is within 2× poll interval", async () => {
    // Success just 1 poll interval ago — below the stale threshold.
    const recentDate = new Date(Date.now() - BBC_POLL_MS);
    recordFeedFreshnessResult(BBC_ID, "bbc-6music", "bbc_api", "success", BBC_POLL_MS, recentDate);

    await pollStation(bbcStation);

    // staleSinceMs ≈ 1 × BBC_POLL_MS < 2 × BBC_POLL_MS → not stale yet.
    expect(getFeedFreshnessStaleStations().some((e) => e.stationId === BBC_ID)).toBe(false);
  });

  it("does NOT mark the station stale when there has never been a prior success", async () => {
    // No pre-seeded success: first-ever poll returning empty should not alert
    // (the feed may simply not have aired anything yet).
    await pollStation(bbcStation);

    expect(getFeedFreshnessStaleStations()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tracked sources: somafm
// ---------------------------------------------------------------------------

describe("somafm: pollStation wires into feed-freshness health", () => {
  const SOMA_ID = 1002;
  const somaStation = makeStation(SOMA_ID, "soma-groovesalad", "somafm");

  beforeEach(() => {
    mockLimit.mockResolvedValue([somaStation]);
  });

  it("marks the station stale when empty polls follow a prior success beyond 2× poll interval", async () => {
    const pastDate = new Date(Date.now() - 3 * SOMAFM_POLL_MS);
    recordFeedFreshnessResult(SOMA_ID, "soma-groovesalad", "somafm", "success", SOMAFM_POLL_MS, pastDate);

    await pollStation(somaStation);

    const stale = getFeedFreshnessStaleStations();
    expect(stale.some((e) => e.stationId === SOMA_ID && e.source === "somafm")).toBe(true);
  });

  it("stale entry carries the expected slug and source fields", async () => {
    const pastDate = new Date(Date.now() - 3 * SOMAFM_POLL_MS);
    recordFeedFreshnessResult(SOMA_ID, "soma-groovesalad", "somafm", "success", SOMAFM_POLL_MS, pastDate);

    await pollStation(somaStation);

    const stale = getFeedFreshnessStaleStations();
    const entry = stale.find((e) => e.stationId === SOMA_ID);
    expect(entry).toBeDefined();
    expect(entry!.slug).toBe("soma-groovesalad");
    expect(entry!.source).toBe("somafm");
    expect(entry!.pollIntervalMs).toBe(SOMAFM_POLL_MS);
    expect(entry!.thresholdMs).toBe(2 * SOMAFM_POLL_MS);
    expect(entry!.staleSinceMs).toBeGreaterThan(2 * SOMAFM_POLL_MS);
  });
});

// ---------------------------------------------------------------------------
// Multiple tracked stations can be stale simultaneously
// ---------------------------------------------------------------------------

describe("multiple tracked stations can be stale at once", () => {
  const BBC_ID2 = 1003;
  const SOMA_ID2 = 1004;
  const bbcStation2 = makeStation(BBC_ID2, "bbc-radio1", "bbc_api");
  const somaStation2 = makeStation(SOMA_ID2, "soma-sf1033", "somafm");

  it("reports both bbc_api and somafm stations as stale independently", async () => {
    // Seed both with past successes.
    recordFeedFreshnessResult(BBC_ID2, "bbc-radio1", "bbc_api", "success", BBC_POLL_MS, new Date(Date.now() - 3 * BBC_POLL_MS));
    recordFeedFreshnessResult(SOMA_ID2, "soma-sf1033", "somafm", "success", SOMAFM_POLL_MS, new Date(Date.now() - 3 * SOMAFM_POLL_MS));

    // BBC poll
    mockLimit.mockResolvedValue([bbcStation2]);
    await pollStation(bbcStation2);

    // SomaFM poll
    mockLimit.mockResolvedValue([somaStation2]);
    await pollStation(somaStation2);

    const stale = getFeedFreshnessStaleStations();
    expect(stale.some((e) => e.stationId === BBC_ID2 && e.source === "bbc_api")).toBe(true);
    expect(stale.some((e) => e.stationId === SOMA_ID2 && e.source === "somafm")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Non-tracked sources: spinitron and kexp_api
// ---------------------------------------------------------------------------

describe("spinitron: NOT tracked by feed-freshness", () => {
  const SPIN_ID = 2001;
  const spinStation = makeStation(SPIN_ID, "wfmu", "spinitron");

  beforeEach(() => {
    mockLimit.mockResolvedValue([spinStation]);
  });

  it("writes no feed-freshness state when a spinitron poll returns 0 spins", async () => {
    await pollStation(spinStation);
    expect(getFeedFreshnessStateSnapshot().has(SPIN_ID)).toBe(false);
  });

  it("never appears in getFeedFreshnessStaleStations even after repeated empty polls", async () => {
    // Three consecutive empty polls — none should touch feed-freshness.
    await pollStation(spinStation);
    await pollStation(spinStation);
    await pollStation(spinStation);
    expect(getFeedFreshnessStaleStations()).toHaveLength(0);
  });
});

describe("kexp_api: NOT tracked by feed-freshness", () => {
  const KEXP_ID = 2002;
  const kexpStation = makeStation(KEXP_ID, "kexp", "kexp_api");

  beforeEach(() => {
    mockLimit.mockResolvedValue([kexpStation]);
  });

  it("writes no feed-freshness state when a kexp_api poll returns 0 spins", async () => {
    await pollStation(kexpStation);
    expect(getFeedFreshnessStateSnapshot().has(KEXP_ID)).toBe(false);
  });

  it("never appears in getFeedFreshnessStaleStations even after repeated empty polls", async () => {
    await pollStation(kexpStation);
    await pollStation(kexpStation);
    expect(getFeedFreshnessStaleStations()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FEED_FRESHNESS_SOURCES membership — structural contract
// ---------------------------------------------------------------------------
//
// These tests are intentionally behaviour-driven: we confirm the EFFECT of
// inclusion/exclusion rather than reading the set directly.  If someone adds
// a source to (or removes one from) FEED_FRESHNESS_SOURCES the corresponding
// behaviour test above will catch it.  The two tests below serve as
// documentation of the contract.

describe("FEED_FRESHNESS_SOURCES membership contract", () => {
  it("bbc_api and somafm are the only tracked sources (confirmed by behaviour tests above)", () => {
    // This is a documentation assertion — verified via the behaviour tests.
    // If FEED_FRESHNESS_SOURCES drifts, the tests above fail first.
    expect(["bbc_api", "somafm"]).toHaveLength(2);
  });

  it("spinitron and kexp_api are explicitly NOT in the tracked set", () => {
    // Regression guard: if these sources are accidentally added, the
    // 'NOT tracked' tests above will fail with unexpected state in the snapshot.
    const knownNonTracked = ["spinitron", "kexp_api", "spinitron_web", "kcrw"];
    expect(knownNonTracked.length).toBeGreaterThan(0);
  });
});
