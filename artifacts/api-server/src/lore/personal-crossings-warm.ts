import { db, crossingsCacheTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { schedulePersonalCrossingsRecompute } from "../routes/me/crossings.js";

// ---------------------------------------------------------------------------
// Personal-crossings boot warm job
//
// Purpose: before the first user request arrives, kick off background
// recomputes for any user whose L2 (Postgres) cache row is already stale or
// absent from the crossings_cache table.  This ensures that new sign-ups and
// accounts whose cache was purged (e.g. after a server restart) get warm data
// without triggering an 8–17 s inline compute on the first request.
//
// Strategy:
//   - Read distinct userId values from crossings_cache where builtAt is older
//     than the 30-minute TTL (or the row is missing — such users will be
//     encountered on first login, not here, since they have no row at all).
//   - Schedule a background recompute for each stale userId via
//     schedulePersonalCrossingsRecompute, which deduplicates concurrent calls.
//   - Throttle to one user every THROTTLE_MS to avoid a DB spike at boot.
// ---------------------------------------------------------------------------

/** Match the TTL in crossings.ts (30 min). */
const CROSSINGS_CACHE_TTL_MS = 30 * 60 * 1000;

/** Gap between queuing successive user recomputes to prevent boot DB spikes. */
const THROTTLE_MS = 500;

/** Delay before the warm job begins, letting migrations and seeders finish first. */
const BOOT_DELAY_MS = 60 * 1000; // 60 seconds

let started = false;

async function runWarmPass(): Promise<void> {
  const staleCutoff = new Date(Date.now() - CROSSINGS_CACHE_TTL_MS);

  let staleUserIds: number[];
  try {
    const rows = await db
      .select({ userId: crossingsCacheTable.userId })
      .from(crossingsCacheTable)
      .where(sql`${crossingsCacheTable.builtAt} < ${staleCutoff}`);
    staleUserIds = rows.map((r) => r.userId);
  } catch (err) {
    console.error("[personal-crossings-warm] failed to query stale cache rows — skipping", err);
    return;
  }

  if (staleUserIds.length === 0) {
    console.info("[personal-crossings-warm] no stale rows found — nothing to warm");
    return;
  }

  console.info(
    `[personal-crossings-warm] scheduling recomputes for ${staleUserIds.length} stale user(s)`,
  );

  for (let i = 0; i < staleUserIds.length; i++) {
    const userId = staleUserIds[i]!;
    schedulePersonalCrossingsRecompute(userId);
    // Throttle: pause between each schedule call to spread DB load.
    if (i < staleUserIds.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, THROTTLE_MS));
    }
  }

  console.info("[personal-crossings-warm] all stale recomputes queued");
}

/**
 * Warm stale personal-crossings cache entries at boot.
 *
 * Fires once after BOOT_DELAY_MS so migrations and pollers have settled.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function warmPersonalCrossingsAtBoot(): void {
  if (started) return;
  started = true;

  console.info(
    `[personal-crossings-warm] scheduled — first run in ${BOOT_DELAY_MS / 1000}s`,
  );

  setTimeout(() => void runWarmPass(), BOOT_DELAY_MS);
}
