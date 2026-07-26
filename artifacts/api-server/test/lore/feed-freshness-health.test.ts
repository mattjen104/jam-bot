/**
 * Unit tests for feed-freshness-health.ts
 *
 * The module is pure in-memory so no DB or network setup is needed.
 * Each test file gets a fresh module state via clearFeedFreshnessState().
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordFeedFreshnessResult,
  getFeedFreshnessStaleStations,
  clearFeedFreshnessState,
  getFeedFreshnessStateSnapshot,
} from "../../src/lore/feed-freshness-health.js";

const POLL_MS = 600_000; // 10 min (mirrors bbc_api)
const THRESHOLD_MS = 2 * POLL_MS; // 20 min

const t0 = new Date("2024-01-01T12:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);

beforeEach(() => {
  clearFeedFreshnessState();
});

// ---------------------------------------------------------------------------
// recordFeedFreshnessResult
// ---------------------------------------------------------------------------

describe("recordFeedFreshnessResult — success", () => {
  it("does not warn on a success with no prior state", () => {
    const result = recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    expect(result.shouldWarn).toBe(false);
  });

  it("records lastSpinAt on success", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    const snap = getFeedFreshnessStateSnapshot().get(1)!;
    expect(snap.lastSpinAt).toEqual(t0);
    expect(snap.consecutiveEmpties).toBe(0);
  });

  it("resets consecutiveEmpties and warnedAt on success after empties", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(POLL_MS));
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(POLL_MS * 2 + 1));
    // Now success — should reset
    const result = recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, after(POLL_MS * 3));
    expect(result.shouldWarn).toBe(false);
    const snap = getFeedFreshnessStateSnapshot().get(1)!;
    expect(snap.consecutiveEmpties).toBe(0);
    expect(snap.warnedAt).toBeNull();
  });
});

describe("recordFeedFreshnessResult — empty, no prior success", () => {
  it("does not warn when there has never been a success", () => {
    const r1 = recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, t0);
    expect(r1.shouldWarn).toBe(false);
    const r2 = recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(THRESHOLD_MS + 1));
    expect(r2.shouldWarn).toBe(false);
  });
});

describe("recordFeedFreshnessResult — silence below threshold", () => {
  it("does not warn when silent time is within 2× poll interval", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    // One tick after 1× poll interval — not yet at threshold
    const r = recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(POLL_MS));
    expect(r.shouldWarn).toBe(false);
  });

  it("does not warn when silent time is 1 ms below threshold", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    const r = recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(THRESHOLD_MS - 1));
    expect(r.shouldWarn).toBe(false);
  });
});

describe("recordFeedFreshnessResult — silence above threshold", () => {
  it("warns once when silence first crosses 2× poll interval", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    const r = recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(THRESHOLD_MS + 1));
    expect(r.shouldWarn).toBe(true);
    if (r.shouldWarn) {
      expect(r.lastSpinAt).toEqual(t0);
      expect(r.staleSinceMs).toBeGreaterThan(THRESHOLD_MS);
    }
  });

  it("does not warn again on subsequent empties in the same silent run", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    // First cross
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(THRESHOLD_MS + 1));
    // Second tick — still silent, should NOT warn again
    const r2 = recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(THRESHOLD_MS + POLL_MS));
    expect(r2.shouldWarn).toBe(false);
  });

  it("warns again after recovery then a new silent run", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    // Silent run 1 — warn fires
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(THRESHOLD_MS + 1));
    // Recovery
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, after(THRESHOLD_MS + POLL_MS));
    // Silent run 2 — should warn again
    const r = recordFeedFreshnessResult(
      1, "bbc-6music", "bbc_api", "empty", POLL_MS,
      after(THRESHOLD_MS + POLL_MS + THRESHOLD_MS + 1),
    );
    expect(r.shouldWarn).toBe(true);
  });

  it("tracks state independently per station", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    recordFeedFreshnessResult(2, "soma-groovesalad", "somafm", "success", POLL_MS, t0);
    // Station 1 goes silent
    const r1 = recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(THRESHOLD_MS + 1));
    // Station 2 still healthy
    const r2 = recordFeedFreshnessResult(2, "soma-groovesalad", "somafm", "success", POLL_MS, after(THRESHOLD_MS + 1));
    expect(r1.shouldWarn).toBe(true);
    expect(r2.shouldWarn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getFeedFreshnessStaleStations
// ---------------------------------------------------------------------------

describe("getFeedFreshnessStaleStations", () => {
  it("returns empty array when nothing is tracked", () => {
    expect(getFeedFreshnessStaleStations()).toEqual([]);
  });

  it("returns empty array when all stations are healthy", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    expect(getFeedFreshnessStaleStations(2, after(POLL_MS))).toEqual([]);
  });

  it("returns empty array for stations that never had a success", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, t0);
    expect(getFeedFreshnessStaleStations(2, after(THRESHOLD_MS + 1))).toEqual([]);
  });

  it("returns stale entry when silence exceeds threshold", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(POLL_MS));

    const now = after(THRESHOLD_MS + 1);
    const stale = getFeedFreshnessStaleStations(2, now);
    expect(stale).toHaveLength(1);
    expect(stale[0]!.stationId).toBe(1);
    expect(stale[0]!.slug).toBe("bbc-6music");
    expect(stale[0]!.source).toBe("bbc_api");
    expect(stale[0]!.staleSinceMs).toBeGreaterThan(THRESHOLD_MS);
    expect(stale[0]!.thresholdMs).toBe(THRESHOLD_MS);
  });

  it("excludes a station that recovered (lastSpinAt newer than lastEmptyAt)", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(POLL_MS));
    // Recovery
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, after(THRESHOLD_MS));

    const stale = getFeedFreshnessStaleStations(2, after(THRESHOLD_MS + POLL_MS));
    expect(stale).toHaveLength(0);
  });

  it("sorts by staleSinceMs descending (longest silent first)", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    recordFeedFreshnessResult(2, "soma-groovesalad", "somafm", "success", POLL_MS, after(POLL_MS));

    // Station 1 has been silent longer
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "empty", POLL_MS, after(POLL_MS));
    recordFeedFreshnessResult(2, "soma-groovesalad", "somafm", "empty", POLL_MS, after(POLL_MS * 2));

    const now = after(THRESHOLD_MS * 2);
    const stale = getFeedFreshnessStaleStations(2, now);
    expect(stale).toHaveLength(2);
    expect(stale[0]!.staleSinceMs).toBeGreaterThanOrEqual(stale[1]!.staleSinceMs);
  });
});

// ---------------------------------------------------------------------------
// clearFeedFreshnessState
// ---------------------------------------------------------------------------

describe("clearFeedFreshnessState", () => {
  it("removes state for a specific station", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    recordFeedFreshnessResult(2, "soma-groovesalad", "somafm", "success", POLL_MS, t0);
    clearFeedFreshnessState(1);
    expect(getFeedFreshnessStateSnapshot().has(1)).toBe(false);
    expect(getFeedFreshnessStateSnapshot().has(2)).toBe(true);
  });

  it("clears all state when called without arguments", () => {
    recordFeedFreshnessResult(1, "bbc-6music", "bbc_api", "success", POLL_MS, t0);
    recordFeedFreshnessResult(2, "soma-groovesalad", "somafm", "success", POLL_MS, t0);
    clearFeedFreshnessState();
    expect(getFeedFreshnessStateSnapshot().size).toBe(0);
  });
});
