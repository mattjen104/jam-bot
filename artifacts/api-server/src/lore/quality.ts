import { and, eq, gte } from "drizzle-orm";
import { db, stationsTable, spinsTable, stationQualityTable } from "@workspace/db";
import { detectAdSignal } from "./ads.js";

export type QualityTier = "proven" | "promising" | "raw" | "silent" | "unscored";

const WINDOW_DAYS = 7;
const MIN_SAMPLES = 20;

/**
 * Heuristic: does a rawArtist + rawTitle pair look like a real track rather
 * than ALL-CAPS filler, a station ID, or promo copy?
 *
 * Rules (all must pass):
 *  1. Both fields must be non-empty with at least 2 non-space characters.
 *  2. The combined text must not be entirely uppercase + punctuation (a common
 *     ICY filler pattern: "STATION ID", "COMMERCIAL BREAK", etc.).
 *  3. Not flagged as an ad by the existing ad-detection heuristic.
 */
function isTrackShaped(
  rawArtist: string | null,
  rawTitle: string | null,
): boolean {
  const artist = rawArtist?.trim() ?? "";
  const title = rawTitle?.trim() ?? "";
  if (artist.length < 2 || title.length < 2) return false;
  const combined = `${artist} ${title}`;
  if (combined.length > 4 && /^[A-Z0-9\s\-.,'"!&/()+]+$/.test(combined))
    return false;
  if (detectAdSignal(rawArtist, rawTitle)) return false;
  return true;
}

/** Assign a quality tier from the four computed metrics + sample count. */
function assignTier(
  sampleCount: number,
  mbidResolutionRate: number,
  trackShaped: number,
  metadataYield: number,
): QualityTier {
  if (sampleCount < MIN_SAMPLES) return "unscored";
  if (mbidResolutionRate >= 0.4) return "proven";
  if (trackShaped >= 0.5) return "promising";
  if (metadataYield >= 0.2) return "raw";
  return "silent";
}

export interface StationQualityMetrics {
  metadataYield: number | null;
  trackShaped: number | null;
  mbidResolutionRate: number | null;
  musicShare: number | null;
  sampleCount: number;
  qualityTier: QualityTier;
}

export interface QualityRecomputeSummary extends Record<QualityTier, number> {
  failures: Array<{ stationId: number; error: string }>;
}

/**
 * Compute the four rolling quality metrics for a single station from the last
 * 7 days of logged spins. Pure function of existing DB data — no polling
 * overhead, no external calls.
 *
 * Returns `sampleCount: 0, qualityTier: "unscored"` when the station has no
 * spins in the window. Never throws.
 */
export async function computeStationQuality(
  stationId: number,
): Promise<StationQualityMetrics> {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const spins = await db
    .select({
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      mbid: spinsTable.mbid,
    })
    .from(spinsTable)
    .where(
      and(
        eq(spinsTable.stationId, stationId),
        gte(spinsTable.playedAt, cutoff),
      ),
    );

  const total = spins.length;

  if (total === 0) {
    return {
      metadataYield: null,
      trackShaped: null,
      mbidResolutionRate: null,
      musicShare: null,
      sampleCount: 0,
      qualityTier: "unscored",
    };
  }

  let withMetadata = 0;
  let trackShapedCount = 0;
  let trackShapedWithMbid = 0;
  let notAdCount = 0;

  for (const spin of spins) {
    const hasMetadata = !!(spin.rawArtist?.trim() && spin.rawTitle?.trim());
    if (hasMetadata) withMetadata++;

    const shaped = isTrackShaped(spin.rawArtist, spin.rawTitle);
    if (shaped) {
      trackShapedCount++;
      if (spin.mbid) trackShapedWithMbid++;
    }

    if (!detectAdSignal(spin.rawArtist, spin.rawTitle)) notAdCount++;
  }

  const metadataYield = withMetadata / total;
  const trackShaped =
    withMetadata > 0 ? trackShapedCount / withMetadata : 0;
  const mbidResolutionRate =
    trackShapedCount > 0 ? trackShapedWithMbid / trackShapedCount : 0;
  const musicShare = notAdCount / total;

  const qualityTier = assignTier(
    total,
    mbidResolutionRate,
    trackShaped,
    metadataYield,
  );

  return {
    metadataYield,
    trackShaped,
    mbidResolutionRate,
    musicShare,
    sampleCount: total,
    qualityTier,
  };
}

/**
 * Recompute quality scores for every active station and upsert into
 * `station_quality`. A failure on one station is logged and skipped — it never
 * aborts the batch. Returns a tier count summary.
 */
export async function recomputeAllQualityScores(): Promise<
  QualityRecomputeSummary
> {
  const summary: QualityRecomputeSummary = {
    proven: 0,
    promising: 0,
    raw: 0,
    silent: 0,
    unscored: 0,
    failures: [],
  };

  let stations: Array<{ id: number }>;
  try {
    stations = await db
      .select({ id: stationsTable.id })
      .from(stationsTable)
      .where(eq(stationsTable.active, true));
  } catch (err) {
    console.error("[lore:quality] could not load stations", err);
    // A zeroed summary is indistinguishable from a successful empty batch to
    // the admin endpoint and scheduler. Propagate so both paths report it.
    throw err;
  }

  for (const station of stations) {
    let lastError: unknown;
    // A single retry covers transient DB/pool faults without hiding a durable
    // failure behind the next nightly run.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const q = await computeStationQuality(station.id);
        const now = new Date();

        await db
          .insert(stationQualityTable)
          .values({
            stationId: station.id,
            metadataYield: q.metadataYield,
            trackShaped: q.trackShaped,
            mbidResolutionRate: q.mbidResolutionRate,
            musicShare: q.musicShare,
            sampleCount: q.sampleCount,
            qualityTier: q.qualityTier,
            computedAt: now,
            recomputeStatus: "ok",
            recomputeError: null,
            recomputeFailedAt: null,
          })
          .onConflictDoUpdate({
            target: stationQualityTable.stationId,
            set: {
              metadataYield: q.metadataYield,
              trackShaped: q.trackShaped,
              mbidResolutionRate: q.mbidResolutionRate,
              musicShare: q.musicShare,
              sampleCount: q.sampleCount,
              qualityTier: q.qualityTier,
              computedAt: now,
              recomputeStatus: "ok",
              recomputeError: null,
              recomputeFailedAt: null,
            },
          });

        summary[q.qualityTier]++;
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError !== undefined) {
      const error = lastError instanceof Error ? lastError.message : String(lastError);
      summary.failures.push({ stationId: station.id, error });
      // Insert permits a failure to be visible even where no prior quality row
       // exists. A first failure must not fabricate the old default
       // unscored/zero score; later failures update only attempt status and
       // therefore retain the last successful measurement.
      try {
        await db.insert(stationQualityTable).values({
          stationId: station.id,
          metadataYield: null,
          trackShaped: null,
          mbidResolutionRate: null,
          musicShare: null,
          sampleCount: null,
          qualityTier: null,
          computedAt: null,
          recomputeStatus: "failed",
          recomputeError: error.slice(0, 1000),
          recomputeFailedAt: new Date(),
        }).onConflictDoUpdate({
          target: stationQualityTable.stationId,
          set: {
            recomputeStatus: "failed",
            recomputeError: error.slice(0, 1000),
            recomputeFailedAt: new Date(),
          },
        });
      } catch (statusErr) {
        console.error("[lore:quality] could not persist recompute failure", station.id, statusErr);
      }
      console.error("[lore:quality] recompute failed after retry", station.id, lastError);
    }
  }

  return summary;
}

/** Start the nightly quality-recompute scheduler.
 *
 * Schedule:
 *  - First run: 60 s after boot (initial population; never slows startup).
 *  - Subsequent runs: aligned to 02:00 UTC each night (off-peak).
 *
 * Never throws.
 */
export function startQualityRecomputeJob(): void {
  const BOOT_DELAY = 60_000;

  /** Returns milliseconds until the next 02:00 UTC (always > 0). */
  function msUntilNextRun(): number {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(2, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
  }

  const runOnce = async () => {
    console.info("[lore:quality] starting quality recompute");
    try {
      const summary = await recomputeAllQualityScores();
      console.info("[lore:quality] recompute complete", summary);
    } catch (err) {
      console.error("[lore:quality] recompute failed", err);
    }
  };

  const scheduleNext = () => {
    const delay = msUntilNextRun();
    console.info(
      `[lore:quality] next recompute in ${Math.round(delay / 3600_000 * 10) / 10}h (02:00 UTC)`,
    );
    setTimeout(() => {
      void runOnce().then(scheduleNext);
    }, delay);
  };

  // Boot run: 60s delay, then align subsequent runs to 02:00 UTC.
  setTimeout(() => {
    void runOnce().then(scheduleNext);
  }, BOOT_DELAY);
}
