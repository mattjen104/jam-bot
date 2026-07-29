import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent migration that adds the `automation_class` column to `stations`
 * and seeds deterministic values for all stations whose class can be inferred
 * from existing signals without behavioral analysis.
 *
 * Seeding rules (applied only where automation_class IS NULL so manual
 * overrides are never clobbered):
 *
 *   'automated'  now_playing_source IN ('somafm','radio_paradise')
 *   'human'      now_playing_source IN ('spinitron_web','kexp_api','kcrw',
 *                                        'bbc_api','lot_radio_schedule','fip')
 *   'mixed'      has at least one scraped_shows row AND now_playing_source
 *                is radio_browser_icy (human during show slots, automated
 *                between them — boundary labelled at (station, hour-of-week)
 *                level by the behavioral analysis job)
 *
 * Everything else stays NULL (unknown longtail).
 */
export async function applyAutomationClassMigration(): Promise<void> {
  // 1. Add column (idempotent)
  await db.execute(sql`
    ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS automation_class text
  `);

  // 2. Seed 'automated' — known algorithmic playlist sources
  await db.execute(sql`
    UPDATE stations
    SET automation_class = 'automated'
    WHERE automation_class IS NULL
      AND now_playing_source IN ('somafm', 'radio_paradise')
  `);

  // 3. Seed 'human' — DJ-logged or verified human-programmed feeds
  await db.execute(sql`
    UPDATE stations
    SET automation_class = 'human'
    WHERE automation_class IS NULL
      AND now_playing_source IN (
        'spinitron_web',
        'kexp_api',
        'kcrw',
        'bbc_api',
        'lot_radio_schedule',
        'fip'
      )
  `);

  // 4. Seed 'mixed' — has a DJ schedule but polls via raw ICY
  //    (human during show hours, automated overnight)
  await db.execute(sql`
    UPDATE stations
    SET automation_class = 'mixed'
    WHERE automation_class IS NULL
      AND now_playing_source = 'radio_browser_icy'
      AND EXISTS (
        SELECT 1 FROM scraped_shows ss WHERE ss.station_id = stations.id
      )
  `);

  console.info("[migration] automation_class column: OK");
}
