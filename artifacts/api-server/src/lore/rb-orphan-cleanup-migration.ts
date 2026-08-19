import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Boot migration: delete orphaned icy_unsupported radio_browser_stations rows.
 *
 * Some stations were enrolled more than once (e.g. under different Radio
 * Browser UUIDs for the same station), leaving BOTH an `active` and an
 * `icy_unsupported` row pointing at the same stations.id. The stale
 * unsupported row inflates the health-page "unsupported" count and confuses
 * the fingerprint-scout eligibility pool (which requires ALL rows for a
 * station to be unsupported).
 *
 * Deletes every icy_unsupported row whose station_id also has an active row.
 * Rows with a NULL station_id are never touched (no station to be redundant
 * with). Idempotent — once the orphans are gone the DELETE matches nothing.
 */
export async function applyRbOrphanCleanupMigration(): Promise<void> {
  const result = await db.execute(sql`
    DELETE FROM radio_browser_stations u
    WHERE u.icy_status = 'icy_unsupported'
      AND u.station_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM radio_browser_stations a
        WHERE a.station_id = u.station_id
          AND a.icy_status = 'active'
          AND a.id <> u.id
      )
  `);
  const count = result.rowCount ?? 0;
  if (count > 0) {
    console.info(`[lore] rb orphan cleanup: deleted ${count} stale icy_unsupported rows`);
  }
}
