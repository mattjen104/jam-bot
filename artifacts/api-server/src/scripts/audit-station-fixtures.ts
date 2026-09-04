import {
  auditStationFixtures,
  cleanupStationFixtures,
} from "../lore/station-fixture-audit.js";

/* eslint-disable no-console -- command-line audit output is the script's interface */
const rows = await auditStationFixtures();
console.table(rows);

if (process.argv.includes("--apply")) {
  const deleted = await cleanupStationFixtures(rows.map((row) => row.id));
  console.info(`Deleted ${deleted} unmistakable station fixture row(s).`);
} else {
  console.info("Read-only audit. Re-run with --apply to delete exactly these rows.");
}
