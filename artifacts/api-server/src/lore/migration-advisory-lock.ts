import { sql, type SQL } from "drizzle-orm";

/**
 * Advisory-lock keys serializing boot migrations across concurrent callers.
 *
 * Why: a migration transaction that holds more than one lock — e.g. a SELECT
 * (AccessShare) followed by ALTER TABLE (AccessExclusive) on the same table,
 * or DDL touching two tables — can deadlock (Postgres 40P01) when parallel
 * test workers or concurrent production boots run it simultaneously.
 * Taking `pg_advisory_xact_lock` as the FIRST statement of the transaction
 * makes concurrent callers queue instead of deadlocking.
 *
 * Keys are arbitrary but must be stable and unique per migration.
 * (`replay-resolution-migration.ts` owns 7_233_141_497n.)
 */
export const MIGRATION_LOCK_KEYS = {
  geniusFragment: 7_233_141_498n,
  deviceIdentity: 7_233_141_499n,
  automationClass: 7_233_141_500n,
  stationSchedule: 7_233_141_501n,
  attendance: 7_233_141_502n,
} as const;

/**
 * SQL acquiring a transaction-scoped advisory lock. Must be executed as the
 * first statement inside a transaction; the lock releases automatically at
 * commit/rollback.
 */
export function acquireMigrationLock(key: bigint): SQL {
  return sql`SELECT pg_advisory_xact_lock(${key})`;
}
