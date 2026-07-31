import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the import buffer persistence feature:
 * - Adds `buffer_json` (jsonb) to `library_import_jobs` so the fetched track
 *   list survives server restarts and a resumed import can skip re-fetching.
 * - Adds `resumed_from` (integer) to `library_import_jobs` so the worker can
 *   record which prior job's buffer was reused (complete-buffer resume path)
 *   and the frontend can show "Resuming from previous session…" instead of
 *   "Fetching your library…".
 *
 * Uses two independent try/catch blocks so that a failure on the first column
 * does not prevent the second column from being applied.  If either step fails,
 * the collected errors are thrown at the end so the caller (`runMigration`) can
 * record and log the failure — ensuring no misleading "ok" status is emitted.
 */
export async function applyImportBufferMigration(): Promise<void> {
  const stepErrors: Array<{ step: string; err: unknown }> = [];

  try {
    await db.execute(sql`
      ALTER TABLE library_import_jobs
        ADD COLUMN IF NOT EXISTS buffer_json jsonb
    `);
  } catch (err) {
    stepErrors.push({ step: "buffer_json", err });
  }

  try {
    await db.execute(sql`
      ALTER TABLE library_import_jobs
        ADD COLUMN IF NOT EXISTS resumed_from integer
    `);
  } catch (err) {
    stepErrors.push({ step: "resumed_from", err });
  }

  if (stepErrors.length > 0) {
    const detail = stepErrors
      .map(({ step, err }) => `${step}: ${err instanceof Error ? err.message : String(err)}`)
      .join("; ");
    throw new Error(`partial failure — ${detail}`);
  }
}
