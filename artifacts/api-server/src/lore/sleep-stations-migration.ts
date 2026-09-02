import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Boot migration: maintain the legacy ambient-pool flag.
 *
 * Musical ambient channels remain accessible through the Ambient category.
 * Non-music sleep aids, nature sounds, and white-noise utilities remain
 * soft-hidden but are removed from the ambient pool.
 *
 * Musical patterns matched (case-insensitive substring or exact slug):
 *   - SomaFM Drone Zone / Groove Salad / Space Station — matched by channel
 *     name whenever the row's name also mentions SomaFM (covers every
 *     naming/bitrate variant), plus exact slug fallbacks.
 *
 * Idempotent:
 *   - ADD COLUMN IF NOT EXISTS silently skips if already present.
 *   - Utility rows are always hidden and removed from sleep_mode.
 *   - Musical ambient rows are always hidden and added to sleep_mode.
 *
 * @see artifacts/api-server/src/lore/radio-browser.ts
 */
export async function applySleepStationsMigration(): Promise<void> {
  // Step 1: ensure the column exists (DDL).
  await db.execute(sql`
    ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS sleep_mode boolean NOT NULL DEFAULT false
  `);

  // Step 2: remove non-music utility rows from the ambient pool while keeping
  // them soft-hidden so historical station/spin data remains intact.
  await db.execute(sql`
    UPDATE stations
    SET
      sleep_mode = false,
      hidden     = true
    WHERE (
      LOWER(name) LIKE '%white noise%'
      OR LOWER(name) LIKE '%rain sound%'
      OR LOWER(name) LIKE '%sleep sound%'
      OR LOWER(name) LIKE '%sleep radio%'
      OR LOWER(name) LIKE '%baby sleep%'
      OR LOWER(name) LIKE '%deep sleep%'
      OR LOWER(name) LIKE '%sleeping pill%'
      OR LOWER(name) LIKE '%music for sleep%'
      OR LOWER(name) LIKE '%positively sleep%'
      OR LOWER(name) LIKE '%nature radio sleep%'
      OR LOWER(name) LIKE '%nature radio rain%'
    )
  `);

  // Step 3: keep musical ambient channels in the legacy ambient pool.
  const result = await db.execute<{ rowcount: string }>(sql`
    UPDATE stations
    SET
      sleep_mode = true,
      hidden     = true
    WHERE (
      (
        LOWER(name) LIKE '%somafm%'
        AND (
          LOWER(name) LIKE '%drone zone%'
          OR LOWER(name) LIKE '%groove salad%'
          OR LOWER(name) LIKE '%space station%'
        )
      )
      OR slug IN (
        'somafm-drone-zone',
        'somafm-dronezone',
        'drone-zone',
        'somafm-groove-salad',
        'somafm-groovesalad',
        'groove-salad',
        'somafm-space-station',
        'somafm-spacestation',
        'space-station'
      )
    )
  `);
  const affected = (result as { rowCount?: number }).rowCount ?? 0;
  console.info(
    JSON.stringify({
      severity: "info",
      migration: "applySleepStationsMigration",
      affectedRows: affected,
    }),
  );
}
