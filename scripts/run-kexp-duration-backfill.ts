/**
 * CLI runner for the KEXP duration backfill.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx run-kexp-duration-backfill.ts
 *
 * Idempotent — safe to re-run; the completion ledger skips it if already done.
 * Expected run time: ≈5 minutes for 274 recordings at 1 req/sec.
 */

import { runKexpDurationBackfill } from "../artifacts/api-server/src/lore/kexp-duration-backfill.js";

const report = await runKexpDurationBackfill();

if (report.skippedAlreadyDone) {
  console.log("Backfill already complete — nothing to do.");
  process.exit(0);
}

console.log([
  "KEXP duration backfill complete.",
  `  MBIDs queried : ${report.mbidsQueried}`,
  `  Updated       : ${report.mbidsUpdated}`,
  `  No MB length  : ${report.mbidsNoLength}`,
  `  Failed        : ${report.mbidsFailed}`,
].join("\n"));

if (report.mbidsFailed > 0) {
  console.warn("Some MBIDs failed — re-running will retry them (completion ledger records success only).");
  process.exit(1);
}
