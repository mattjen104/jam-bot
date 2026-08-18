import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { acquireMigrationLock, MIGRATION_LOCK_KEYS } from "./migration-advisory-lock.js";

/**
 * Idempotent DDL for the release-date premiere feature:
 * - `recordings.release_date` — full first-release date in MusicBrainz's
 *   partial-ISO form (`YYYY` / `YYYY-MM` / `YYYY-MM-DD`), so the Dial's
 *   First tier can sight premieres (first play on/before the release date)
 *   instead of truncating to a year at parse time.
 * - `recordings.release_date_checked_at` — sentinel mirroring
 *   `year_checked_at`: set on definitive MB answers (date found or genuine
 *   "no date"), left unset on 5xx/network so rows retry on the next tick.
 *
 * The column-missing check gates the ALTER so re-runs never take an
 * AccessExclusive lock on recordings (which would stall concurrent test
 * workers); the ALTER itself runs inside an advisory-locked transaction so
 * concurrent boots serialize instead of deadlocking. The completion ledger
 * records the migration so the health surface can show it ran.
 */
export async function applyReleaseDateMigration(): Promise<void> {
  const columnCheck = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'recordings'
      AND column_name IN ('release_date', 'release_date_checked_at')
  `);
  if ((columnCheck.rows?.length ?? 0) >= 2) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(acquireMigrationLock(MIGRATION_LOCK_KEYS.releaseDate));
    await tx.execute(sql`
      ALTER TABLE recordings ADD COLUMN IF NOT EXISTS release_date text
    `);
    await tx.execute(sql`
      ALTER TABLE recordings ADD COLUMN IF NOT EXISTS release_date_checked_at timestamp
    `);
    await tx.execute(sql`
      INSERT INTO migration_completions (name)
      VALUES ('applyReleaseDateMigration')
      ON CONFLICT (name) DO NOTHING
    `);
  });
}
