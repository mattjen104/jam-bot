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
 */

export interface MigrationFailure {
  name: string;
  error: string;
  failedAt: string; // ISO-8601
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
