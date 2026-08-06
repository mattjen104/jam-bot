/**
 * CLI runner for the KEXP duration backfill.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx run-kexp-duration-backfill.ts
 *
 * Idempotent — safe to re-run; the completion ledger skips it if already done.
 * Expected run time: ≈5 minutes for 274 recordings at 1 req/sec.
 *
 * Prints KEXP MBID-resolved duration coverage before and after the run.
 */

import { db } from "../lib/db/src/index.js";
import { sql } from "drizzle-orm";
import { runKexpDurationBackfill } from "../artifacts/api-server/src/lore/kexp-duration-backfill.js";

// ---------------------------------------------------------------------------
// Coverage query helper
// ---------------------------------------------------------------------------

interface CoverageRow {
  mbid_spins: string;
  mbid_spins_with_duration: string;
  mbid_pct_with_duration: string;
}

async function kexpCoverage(): Promise<{ mbidSpins: number; withDuration: number; pct: string }> {
  const result = await db.execute<CoverageRow>(sql`
    SELECT
      COUNT(s.id) FILTER (WHERE s.mbid IS NOT NULL)                        AS mbid_spins,
      COUNT(r.duration_ms) FILTER (WHERE s.mbid IS NOT NULL)               AS mbid_spins_with_duration,
      ROUND(
        100.0 * COUNT(r.duration_ms) FILTER (WHERE s.mbid IS NOT NULL)
             / NULLIF(COUNT(s.id) FILTER (WHERE s.mbid IS NOT NULL), 0),
        1
      )::text                                                              AS mbid_pct_with_duration
    FROM spins s
    JOIN stations st ON st.id = s.station_id
    LEFT JOIN recordings r ON r.mbid = s.mbid
    WHERE lower(st.name) LIKE '%kexp%'
  `);

  const row = result.rows[0];
  return {
    mbidSpins: Number(row?.mbid_spins ?? 0),
    withDuration: Number(row?.mbid_spins_with_duration ?? 0),
    pct: row?.mbid_pct_with_duration ?? "0",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=== KEXP Duration Backfill ===\n");

// Before coverage
const before = await kexpCoverage();
console.log("Coverage BEFORE backfill:");
console.log(`  KEXP MBID-resolved spins : ${before.mbidSpins.toLocaleString()}`);
console.log(`  Spins with duration_ms   : ${before.withDuration.toLocaleString()}`);
console.log(`  Coverage                 : ${before.pct}%\n`);

// Run backfill
const report = await runKexpDurationBackfill();

if (report.skippedAlreadyDone) {
  console.log("Backfill already complete — nothing to do.");
} else {
  console.log("Backfill complete.");
  console.log(`  MBIDs queried : ${report.mbidsQueried}`);
  console.log(`  Updated       : ${report.mbidsUpdated}`);
  console.log(`  No MB length  : ${report.mbidsNoLength}`);
  console.log(`  Failed        : ${report.mbidsFailed}\n`);
}

// After coverage
const after = await kexpCoverage();
console.log("Coverage AFTER backfill:");
console.log(`  KEXP MBID-resolved spins : ${after.mbidSpins.toLocaleString()}`);
console.log(`  Spins with duration_ms   : ${after.withDuration.toLocaleString()}`);
console.log(`  Coverage                 : ${after.pct}%\n`);

if (!report.skippedAlreadyDone) {
  const gained = after.withDuration - before.withDuration;
  console.log(`Coverage change: ${before.pct}% → ${after.pct}% (+${gained.toLocaleString()} spins with duration)`);
}

if (report.mbidsFailed > 0) {
  console.warn("\nWARNING: Some MBIDs failed — re-running will retry them (completion ledger records success only).");
  process.exit(1);
}
