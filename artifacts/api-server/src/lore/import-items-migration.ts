import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the `import_items` per-track resolution audit table.
 *
 * One row per track per import job: stores the raw artist/title, the resolved
 * MBID (or null for unresolved), the resolution tier, and a normalised
 * confidence score for Tier 3 fuzzy-match hits.
 *
 * Indexes:
 *   import_items_job_idx       — job-scoped queries (unresolved review, retry pass)
 *   import_items_user_mbid_idx — fuzzy-match flag lookup in the library GET
 *
 * Uses independent try/catch blocks per step so a failure on one doesn't
 * prevent subsequent steps from running — all errors are collected and re-thrown
 * together so the caller (`runMigration`) records a single structured failure.
 */
export async function applyImportItemsMigration(): Promise<void> {
  const stepErrors: Array<{ step: string; err: unknown }> = [];

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS import_items (
        id              serial       PRIMARY KEY,
        job_id          integer      NOT NULL REFERENCES library_import_jobs(id),
        user_id         integer      NOT NULL REFERENCES lore_users(id),
        raw_artist      text         NOT NULL,
        raw_title       text         NOT NULL,
        raw_release     text,
        source_ref      text,
        isrc            text,
        recording_mbid  text,
        resolution_tier text,
        confidence      real,
        added_at        timestamp    NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    stepErrors.push({ step: "create_import_items", err });
  }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS import_items_job_idx
        ON import_items (job_id)
    `);
  } catch (err) {
    stepErrors.push({ step: "import_items_job_idx", err });
  }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS import_items_user_mbid_idx
        ON import_items (user_id, recording_mbid)
    `);
  } catch (err) {
    stepErrors.push({ step: "import_items_user_mbid_idx", err });
  }

  if (stepErrors.length > 0) {
    const detail = stepErrors
      .map(({ step, err }) => `${step}: ${err instanceof Error ? err.message : String(err)}`)
      .join("; ");
    throw new Error(`partial failure — ${detail}`);
  }
}
