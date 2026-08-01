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
 *                                        'bbc_api','lot_radio_schedule','fip',
 *                                        'radiojar')
 *   'mixed'      now_playing_source = 'nts_live'
 *             OR (now_playing_source = 'radio_browser_icy' AND has at least
 *                one scraped_shows row — human during show slots, automated
 *                between them)
 *
 * Everything else stays NULL (unknown longtail).
 *
 * Classification matters: DialView.tsx suppresses the Tier-2 fallback DJ slot
 * only when automationClass is explicitly 'automated' or 'mixed'. Stations that
 * stay NULL are treated as human, so any station that could surface a stale
 * djName during an automated period must be classified here.
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

  // 5. Seed 'mixed' — NTS Live (two channels). NTS publishes full weekly
  //    schedules with named hosts; the schedule scraper populates scraped_shows
  //    for both channels. Between shows NTS may broadcast automated fill, so
  //    'mixed' is correct — it prevents a past DJ's name surfacing as a
  //    phantom Tier-2 slot during unscheduled/overnight periods.
  //    Applied unconditionally (not gated on scraped_shows) so the
  //    classification is correct even before the schedule scraper has run.
  await db.execute(sql`
    UPDATE stations
    SET automation_class = 'mixed'
    WHERE automation_class IS NULL
      AND now_playing_source = 'nts_live'
  `);

  // 6. Seed 'human' — Radiojar community/indie stations (Radio AlHara,
  //    Lookout.FM). These are human-programmed stations with no known
  //    automated-rotation mode; they carry no schedule scraper and therefore
  //    pose no phantom-DJ-slot risk, but explicit classification keeps the
  //    automationClass surface honest.
  await db.execute(sql`
    UPDATE stations
    SET automation_class = 'human'
    WHERE automation_class IS NULL
      AND now_playing_source = 'radiojar'
  `);

  console.info("[migration] automation_class column: OK");
}
