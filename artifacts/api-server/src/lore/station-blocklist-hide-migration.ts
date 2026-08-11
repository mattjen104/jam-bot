import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Boot migration: hide stations whose names match an entry in
 * RADIO_BROWSER_NAME_BLOCKLIST, plus curated stations with no viable
 * now-playing source.
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
 * CHMR and CISM restore procedure
 * ────────────────────────────────
 * These stations are hidden only while `now_playing_source IS NULL`. Once a
 * working now-playing source is confirmed, the restore sequence is:
 *
 *   1. Configure the source (admin API, survives restarts):
 *        PATCH /api/admin/stations/:id/now-playing-source
 *        Body: { nowPlayingSource, nowPlayingConfig, streamUrl? }
 *
 *   2. Unhide (immediately enrolls the appropriate poller):
 *        PATCH /api/admin/stations/:id/flags
 *        Body: { hidden: false }
 *
 * This migration is then a permanent no-op for those stations so the restore
 * survives server restarts. The seed upsert likewise uses COALESCE so its
 * null nowPlayingSource does not overwrite a configured one.
 *
 * @see artifacts/api-server/src/lore/radio-browser.ts (RADIO_BROWSER_NAME_BLOCKLIST)
 * @see artifacts/api-server/src/lore/seed.ts (seedStations — COALESCE guard)
 * @see artifacts/api-server/src/routes/lore/admin.ts (PATCH .../now-playing-source)
 */
export async function applyStationBlocklistHideMigration(): Promise<void> {
  const result = await db.execute<{ rowcount: string }>(sql`
    UPDATE stations
    SET hidden = true
    WHERE hidden = false
      AND (
        LOWER(name) LIKE '%exclusively %'
        OR LOWER(name) LIKE '%epic lounge%'
        -- Only hide CHMR/CISM while they still lack a now-playing source.
        -- Once an operator has configured one (via PATCH .../now-playing-source)
        -- and unhidden the station, this predicate becomes false and the
        -- migration is a permanent no-op — the restore survives restarts.
        OR (slug IN ('chmr', 'cism') AND now_playing_source IS NULL)
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
