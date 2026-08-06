import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent index for time-bounded spin scans.
 *
 * The dial's ranged coarse-scan window (`GET /api/me/overlaps/runs?days=N`)
 * filters spins purely by `played_at >= now() - interval`. Existing indexes
 * all lead with mbid/station_id/show_id, so without a played_at-leading index
 * the 30-day path sequentially scans the ~1M-row spins table before grouping.
 * Safe to run on every boot — IF NOT EXISTS.
 */
export async function applySpinsPlayedAtIndexMigration(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS spins_played_at_idx
      ON spins (played_at)
  `);
}
