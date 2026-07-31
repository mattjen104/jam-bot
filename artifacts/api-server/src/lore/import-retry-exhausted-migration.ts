import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the retry-exhaustion feature on `library_import_jobs`:
 * - Adds `retry_attempts` (integer, default 0): counts consecutive off-peak
 *   retry passes that resolved zero new tracks for a source job's un-cached
 *   entries. Reset to 0 when a retry pass resolves at least one track.
 * - Adds `retry_exhausted` (boolean, default false): set true once
 *   `retry_attempts` reaches PHASE3_MAX_RETRY_ATTEMPTS. Exhausted jobs are
 *   skipped by the off-peak scheduler to prevent perpetual nightly job pile-up
 *   when MusicBrainz is persistently degraded.
 *
 * Uses two independent try/catch blocks so a failure on the first column does
 * not prevent the second from being applied.
 */
export async function applyImportRetryExhaustedMigration(): Promise<void> {
  const stepErrors: Array<{ step: string; err: unknown }> = [];

  try {
    await db.execute(sql`
      ALTER TABLE library_import_jobs
        ADD COLUMN IF NOT EXISTS retry_attempts integer NOT NULL DEFAULT 0
    `);
  } catch (err) {
    stepErrors.push({ step: "retry_attempts", err });
  }

  try {
    await db.execute(sql`
      ALTER TABLE library_import_jobs
        ADD COLUMN IF NOT EXISTS retry_exhausted boolean NOT NULL DEFAULT false
    `);
  } catch (err) {
    stepErrors.push({ step: "retry_exhausted", err });
  }

  if (stepErrors.length > 0) {
    const detail = stepErrors
      .map(({ step, err }) => `${step}: ${err instanceof Error ? err.message : String(err)}`)
      .join("; ");
    throw new Error(`partial failure — ${detail}`);
  }
}
