import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * One-shot boot migration: hide stations whose names match an entry in
 * RADIO_BROWSER_NAME_BLOCKLIST.
 *
 * The ingest-time guard in radio-browser.ts already rejects new stations that
 * match the blocklist, but stations added before the blocklist was introduced
 * are still present with hidden=false.  This migration retroactively sets
 * hidden=true on those rows so they disappear from all listener-facing surfaces
 * (GET /stations, now-playing, crossings, pickers) without deleting them.
 *
 * Idempotent — rows that are already hidden are not touched; running again on
 * re-deploy is a no-op.
 *
 * If the blocklist in radio-browser.ts gains new entries in the future, extend
 * this migration (or add a new sibling migration) with the matching LIKE
 * predicates so the retroactive hide covers them too.
 *
 * @see artifacts/api-server/src/lore/radio-browser.ts (RADIO_BROWSER_NAME_BLOCKLIST)
 */
export async function applyStationBlocklistHideMigration(): Promise<void> {
  const result = await db.execute<{ rowcount: string }>(sql`
    UPDATE stations
    SET hidden = true
    WHERE hidden = false
      AND (
        LOWER(name) LIKE '%exclusively %'
        OR LOWER(name) LIKE '%epic lounge%'
      )
  `);
  const affected = (result as { rowCount?: number }).rowCount ?? 0;
  console.info(
    JSON.stringify({
      severity: "info",
      migration: "applyStationBlocklistHideMigration",
      affectedRows: affected,
    }),
  );
}
