/**
 * Boot-migration registry.
 *
 * Provides two helpers:
 *
 *   runMigration(name, fn)
 *     Runs `fn`, catches any thrown error, emits a structured log entry, and
 *     records the failure in the in-process registry.  The server continues
 *     booting regardless of failure — schema errors surface via /health/migrations
 *     before bad traffic reaches the affected routes.
 *
 *   recordMigrationFailure(name, err)
 *     Lower-level helper for multi-step migrations (like applyImportBufferMigration)
 *     that manage their own sub-step try/catches but still want failures tracked.
 *
 *   getMigrationFailures()
 *     Returns a snapshot of every failed migration for the health route.
 *
 *   getMigrationCompletions()
 *     Reads the persistent `migration_completions` ledger from the DB and
 *     returns every completed migration row.  Returns an empty array if the
 *     table does not yet exist (i.e. before the ledger migration has run).
 */

export interface MigrationFailure {
  name: string;
  error: string;
  failedAt: string; // ISO-8601
}

export interface MigrationCompletion {
  name: string;
  completedAt: string; // ISO-8601
}

const _failures: MigrationFailure[] = [];

/** Record a structured migration failure and write a structured log line. */
export function recordMigrationFailure(name: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const failedAt = new Date().toISOString();
  _failures.push({ name, error: message, failedAt });
  // Structured log — severity, migration name, and message are top-level keys
  // so log-aggregation tools can filter/alert on severity=error + migration=*.
  console.error(
    JSON.stringify({ severity: "error", migration: name, error: message, failedAt }),
  );
}

/**
 * Run a boot migration and handle any failure without crashing the server.
 * On success emits a structured info log; on failure emits a structured error
 * log and records the failure in the registry.
 */
export async function runMigration(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
    console.info(JSON.stringify({ severity: "info", migration: name, status: "ok" }));
  } catch (err) {
    recordMigrationFailure(name, err);
  }
}

/** Snapshot of all migrations that failed during this boot. */
export function getMigrationFailures(): readonly MigrationFailure[] {
  return [..._failures];
}

/**
 * Read the persistent `migration_completions` ledger from the database.
 *
 * Returns every row that has been committed by a one-shot boot migration.
 * If the ledger table does not yet exist (i.e. the DDL migration itself has
 * not run), returns an empty array so callers degrade gracefully.
 */
export async function getMigrationCompletions(): Promise<MigrationCompletion[]> {
  // Import lazily to keep the module free of side-effects at load time.
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  try {
    const rows = await db.execute<{ name: string; completed_at: string }>(sql`
      SELECT name, completed_at FROM migration_completions ORDER BY completed_at
    `);
    return rows.rows.map((r) => ({
      name: r.name,
      completedAt: new Date(r.completed_at).toISOString(),
    }));
  } catch {
    // Most likely the table does not exist yet.
    return [];
  }
}
