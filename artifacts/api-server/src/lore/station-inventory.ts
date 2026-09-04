import { isPollable } from "./adapters.js";
import { classifyFreshness } from "./freshness.js";
import { categoryDiagnostic } from "../routes/lore/shared.js";

export type InventoryInput = {
  id: number; slug: string; org: string | null; tags: string[] | null;
  sleepMode: boolean; eraGenreMode: boolean; nowPlayingSource: string | null;
  healthFailures: number; lastAliveAt: Date | null; icyStatus: string | null;
  icyLastSuccessAt: Date | null; scheduleScrapedAt: Date | null;
  upcomingShowCount: number; latestObservedAt: Date | null;
  qualityTier: string | null; sampleCount: number | null;
  qualityComputedAt: Date | null;
  recomputeStatus: string | null;
};

/** Pure station-inventory diagnosis and stable action-queue ranking. */
export function diagnoseInventoryStation<T extends InventoryInput>(row: T, now = new Date()) {
  const pollable = isPollable(row.nowPlayingSource);
  const freshness = row.latestObservedAt
    ? classifyFreshness(row.nowPlayingSource, row.latestObservedAt, now)
    : "none" as const;
  const streamHealth = row.icyStatus === "error" || row.icyStatus === "icy_unsupported" || row.healthFailures >= 3
    ? "unhealthy" as const
    : row.lastAliveAt || row.icyLastSuccessAt ? "healthy" as const : "unknown" as const;
  const scheduleCoverage = row.upcomingShowCount > 0
    ? "covered" as const
    : row.scheduleScrapedAt && now.getTime() - row.scheduleScrapedAt.getTime() > 14 * 24 * 60 * 60 * 1000
      ? "stale" as const : "missing" as const;
  // computedAt records a completed scoring pass. A failed first attempt has
  // neither it nor a tier/sample and is missing, not a computed "unscored".
  const qualityState = row.qualityTier === null || row.qualityComputedAt === null
    ? "missing" as const : "computed" as const;
  let unscoredReason: "not_pollable" | "no_observations" | "insufficient_recent_samples" | "recompute_missing" | "recompute_failed" | "stale_evidence" | null = null;
  if (qualityState === "missing") {
    if (row.recomputeStatus === "failed") unscoredReason = "recompute_failed";
    else if (!pollable) unscoredReason = "not_pollable";
    else if (row.sampleCount === 0) unscoredReason = "no_observations";
    else unscoredReason = "recompute_missing";
  } else if (row.qualityTier === "unscored") {
    if (!pollable) unscoredReason = "not_pollable";
    else if ((row.sampleCount ?? 0) === 0) unscoredReason = "no_observations";
    else if (freshness === "stale") unscoredReason = "stale_evidence";
    else unscoredReason = "insufficient_recent_samples";
  }
  const category = categoryDiagnostic(row);
  return { ...row, pollable, freshness, streamHealth, scheduleCoverage, qualityState,
    unscoredReason, category: category.category, categoryEvidence: category.evidence };
}

export function rankInventory<T extends InventoryInput>(rows: T[], now = new Date()) {
  const diagnostics = rows.map((row) => diagnoseInventoryStation(row, now));
  const weakTail = diagnostics.filter((row) =>
    row.recomputeStatus === "failed" || !row.pollable || row.qualityState === "missing" ||
    row.qualityTier === "unscored" || row.freshness === "stale" ||
    row.streamHealth === "unhealthy" || row.scheduleCoverage !== "covered");
  const weakOrder = [...weakTail].sort((a, b) =>
    Number(b.recomputeStatus === "failed") - Number(a.recomputeStatus === "failed") ||
    Number(b.streamHealth === "unhealthy") - Number(a.streamHealth === "unhealthy") ||
    Number(b.freshness === "stale") - Number(a.freshness === "stale") ||
    Number(b.scheduleCoverage === "stale") - Number(a.scheduleCoverage === "stale") ||
    Number(b.scheduleCoverage === "missing") - Number(a.scheduleCoverage === "missing") ||
    Number(a.pollable) - Number(b.pollable) ||
    (a.sampleCount ?? -1) - (b.sampleCount ?? -1) || a.id - b.id);
  const categoryOrder = diagnostics.filter((row) =>
    row.categoryEvidence === "fallback_suspicious_org" || row.categoryEvidence === "fallback_missing_evidence")
    .sort((a, b) => Number(b.categoryEvidence === "fallback_suspicious_org") - Number(a.categoryEvidence === "fallback_suspicious_org") || a.id - b.id);
  const weakRanks = new Map(weakOrder.map((row, index) => [row.id, index + 1]));
  const categoryRanks = new Map(categoryOrder.map((row, index) => [row.id, index + 1]));
  return { diagnostics, weakOrder, categoryOrder, weakRanks, categoryRanks };
}