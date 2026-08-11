import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Boot migration: add sleep_mode column and classify matching stations.
 *
 * Sleep stations are ambient/utility channels that do not belong in the normal
 * public dial but remain accessible via GET /api/stations?mode=sleep.
 *
 * Patterns matched (case-insensitive substring or exact slug):
 *   - "white noise", "rain sound", "sleep sound", "sleep radio",
 *     "baby sleep", "deep sleep", "sleeping pill", "music for sleep",
 *     "positively sleep", "nature radio sleep", "nature radio rain"
 *                                          — utility ambient stations
 *   - SomaFM Drone Zone / Groove Salad / Space Station — matched by channel
 *     name whenever the row's name also mentions SomaFM (covers every
 *     naming/bitrate variant), plus exact slug fallbacks.
 *
 * Idempotent:
 *   - ADD COLUMN IF NOT EXISTS silently skips if already present.
 *   - The UPDATE sets sleep_mode and hidden regardless of current values, so
 *     re-running on a station that was already hidden for another reason still
 *     marks it as a sleep station without changing its other flags.
 *
 * @see artifacts/api-server/src/lore/radio-browser.ts (SLEEP_STATION_PATTERNS)
 */
export async function applySleepStationsMigration(): Promise<void> {
  // Step 1: ensure the column exists (DDL).
  await db.execute(sql`
    ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS sleep_mode boolean NOT NULL DEFAULT false
  `);

  // Step 2: mark matching rows as sleep stations (always hidden, sleep_mode=true).
  const result = await db.execute<{ rowcount: string }>(sql`
    UPDATE stations
    SET
      sleep_mode = true,
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
      OR (
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
