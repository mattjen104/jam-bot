import { describe, expect, it } from "vitest";
import { diagnoseInventoryStation, rankInventory, type InventoryInput } from "../src/lore/station-inventory.js";

const now = new Date("2025-01-10T12:00:00Z");
function row(overrides: Partial<InventoryInput> = {}): InventoryInput {
  return {
    id: 1, slug: "station", org: null, tags: null, sleepMode: false, eraGenreMode: false,
    nowPlayingSource: "radio_browser_icy", healthFailures: 0, lastAliveAt: null,
    icyStatus: null, icyLastSuccessAt: null, scheduleScrapedAt: null, upcomingShowCount: 0,
    latestObservedAt: null, qualityTier: null, sampleCount: null, qualityComputedAt: null, recomputeStatus: null, ...overrides,
  };
}

describe("station inventory diagnostics", () => {
  it("distinguishes missing, unpollable, empty, under-sampled, and failed quality", () => {
    expect(diagnoseInventoryStation(row()).unscoredReason).toBe("recompute_missing");
    const scored = { qualityComputedAt: now };
    expect(diagnoseInventoryStation(row({ qualityTier: "unscored", nowPlayingSource: null, ...scored })).unscoredReason).toBe("not_pollable");
    expect(diagnoseInventoryStation(row({ qualityTier: "unscored", sampleCount: 0, ...scored })).unscoredReason).toBe("no_observations");
    expect(diagnoseInventoryStation(row({ qualityTier: "unscored", sampleCount: 19, ...scored })).unscoredReason).toBe("insufficient_recent_samples");
    const firstFailure = diagnoseInventoryStation(row({ recomputeStatus: "failed" }));
    expect(firstFailure.qualityState).toBe("missing");
    expect(firstFailure.unscoredReason).toBe("recompute_failed");
    // A later failed attempt must retain and expose the prior completed score.
    const laterFailure = diagnoseInventoryStation(row({
      qualityTier: "proven", sampleCount: 50, qualityComputedAt: now,
      recomputeStatus: "failed",
    }));
    expect(laterFailure.qualityState).toBe("computed");
    expect(laterFailure.unscoredReason).toBeNull();
    expect(diagnoseInventoryStation(row({ qualityTier: "silent", sampleCount: 50, qualityComputedAt: now, lastAliveAt: now, latestObservedAt: now }), now).unscoredReason).toBeNull();
  });

  it("uses source-aware freshness and only calls stream health healthy with evidence", () => {
    expect(diagnoseInventoryStation(row({ latestObservedAt: new Date("2025-01-10T11:57:00Z") }), now).freshness).toBe("aging");
    expect(diagnoseInventoryStation(row(), now).streamHealth).toBe("unknown");
    expect(diagnoseInventoryStation(row({ icyStatus: "active", icyLastSuccessAt: now }), now).streamHealth).toBe("healthy");
    expect(diagnoseInventoryStation(row({ healthFailures: 3, lastAliveAt: now }), now).streamHealth).toBe("unhealthy");
  });

  it("reports schedule evidence and keeps actionable queues deterministic", () => {
    expect(diagnoseInventoryStation(row({ upcomingShowCount: 2 }), now).scheduleCoverage).toBe("covered");
    expect(diagnoseInventoryStation(row({ scheduleScrapedAt: new Date("2024-12-01T00:00:00Z") }), now).scheduleCoverage).toBe("stale");
    const ranked = rankInventory([
      row({ id: 3, qualityTier: "proven", sampleCount: 50, qualityComputedAt: now, lastAliveAt: now, upcomingShowCount: 1 }),
      row({ id: 2, qualityTier: "proven", sampleCount: 50, qualityComputedAt: now, latestObservedAt: new Date("2020-01-01"), lastAliveAt: now, upcomingShowCount: 1 }),
      row({ id: 1, org: "Review University", qualityTier: "proven", sampleCount: 50, qualityComputedAt: now }),
      row({ id: 4, qualityTier: "unscored", sampleCount: 0, qualityComputedAt: now, lastAliveAt: now }),
      row({ id: 5, qualityTier: "proven", sampleCount: 50, qualityComputedAt: now, lastAliveAt: now, scheduleScrapedAt: new Date("2024-12-01T00:00:00Z") }),
    ], now);
    expect(ranked.weakOrder.map((item) => item.id)).toEqual([2, 5, 4, 1]);
    expect(ranked.categoryOrder.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
    expect(ranked.weakRanks.get(3)).toBeUndefined();
    expect(ranked.categoryRanks.get(1)).toBe(1);
  });
});