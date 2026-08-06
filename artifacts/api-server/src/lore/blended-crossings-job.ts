import {
  hasActiveSocialUsers,
  refreshBlendedCrossingsCache,
} from "../routes/me/crossings.js";

// ---------------------------------------------------------------------------
// Blended-crossings background warm job
//
// Purpose: keep the L1 (in-memory) and L2 (Postgres) blended-crossings caches
// perpetually fresh so that no request ever has to run the two heavy aggregate
// queries inline.
//
// Strategy:
//   - Recompute every WARM_INTERVAL_MS (50 s), which is comfortably below the
//     L1/L2 TTL of 60 s, so a cached entry is always available.
//   - Before each recompute, check whether any social users are currently
//     active.  If not, skip the work — no users means no blended result to
//     serve, and running the heavy queries is wasteful.
//   - The interval runs as long as the process lives; it does not re-align to
//     a wall-clock schedule (unlike the daily lifetime-crossings job) because
//     blended crossings need to stay fresh continuously rather than just once
//     per day.
//
// The refreshBlendedCrossingsCache() call never throws (errors are logged
// internally), so this scheduler is fire-and-forget safe.
// ---------------------------------------------------------------------------

/** How often to recompute the blended view. Must be < BLENDED_CROSSINGS_CACHE_TTL_MS (60 s). */
const WARM_INTERVAL_MS = 50 * 1000; // 50 seconds

/** Delay before the first run to let the server warm up and avoid boot contention. */
const BOOT_DELAY_MS = 30 * 1000; // 30 seconds

let running = false;

async function runWarmPass(): Promise<void> {
  // Guard against overlapping runs if a compute takes longer than the interval.
  if (running) {
    console.info("[blended-crossings-warm] previous pass still running — skipping tick");
    return;
  }
  running = true;
  try {
    const active = await hasActiveSocialUsers().catch((err) => {
      console.warn("[blended-crossings-warm] active-user check failed — skipping pass", err);
      return false;
    });
    if (!active) {
      // No users to blend; skip the heavy queries entirely.
      return;
    }
    await refreshBlendedCrossingsCache();
  } finally {
    running = false;
  }
}

/**
 * Start the blended-crossings warm job.
 *
 * Fires once after BOOT_DELAY_MS, then on a fixed WARM_INTERVAL_MS interval.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
let started = false;
export function startBlendedCrossingsWarmJob(): void {
  if (started) return;
  started = true;

  console.info(
    `[blended-crossings-warm] scheduler starting — first run in ${BOOT_DELAY_MS / 1000}s, ` +
    `then every ${WARM_INTERVAL_MS / 1000}s`,
  );

  setTimeout(() => {
    void runWarmPass();
    setInterval(() => void runWarmPass(), WARM_INTERVAL_MS);
  }, BOOT_DELAY_MS);
}
