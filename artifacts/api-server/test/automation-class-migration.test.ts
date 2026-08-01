// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, stationsTable } from "@workspace/db";
import { applyAutomationClassMigration } from "../src/lore/automation-class-migration.js";
import { applyMigrationCompletionsMigration } from "../src/lore/migration-completions-migration.js";

/**
 * Integration tests for applyAutomationClassMigration.
 *
 * Verifies that the seeding UPDATEs run exactly once. Each test proves the
 * "exactly once" property by:
 *   1. Running the migration and confirming the expected classification was set.
 *   2. Leaving the completion-ledger row in place.
 *   3. Resetting the station's automation_class back to NULL.
 *   4. Running the migration a second time and confirming the class is still
 *      NULL — proving the DML was gated by the ledger.
 */

const run = randomUUID().slice(0, 8);
const SLUG_AUTOMATED = `test-acm-auto-${run}`;
const SLUG_HUMAN = `test-acm-human-${run}`;
const SLUG_MIXED_NTS = `test-acm-nts-${run}`;

let dbAvailable = false;
let automatedStationId: number | undefined;
let humanStationId: number | undefined;
let ntsStationId: number | undefined;

const LEDGER_KEY = "applyAutomationClassMigration";

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await applyMigrationCompletionsMigration();

  const [auto] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG_AUTOMATED,
      name: `Test AutoClass Automated ${run}`,
      streamUrl: "http://example.invalid/acm-auto",
      stationClass: "community",
      nowPlayingSource: "somafm",
    })
    .returning({ id: stationsTable.id });
  automatedStationId = auto!.id;

  const [human] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG_HUMAN,
      name: `Test AutoClass Human ${run}`,
      streamUrl: "http://example.invalid/acm-human",
      stationClass: "community",
      nowPlayingSource: "kexp_api",
    })
    .returning({ id: stationsTable.id });
  humanStationId = human!.id;

  const [nts] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG_MIXED_NTS,
      name: `Test AutoClass NTS ${run}`,
      streamUrl: "http://example.invalid/acm-nts",
      stationClass: "community",
      nowPlayingSource: "nts_live",
    })
    .returning({ id: stationsTable.id });
  ntsStationId = nts!.id;
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  const ids = [automatedStationId, humanStationId, ntsStationId].filter(
    (id): id is number => id !== undefined,
  );
  if (ids.length) {
    for (const id of ids) {
      await db.execute(sql`DELETE FROM stations WHERE id = ${id}`);
    }
  }
  await db.execute(sql`DELETE FROM migration_completions WHERE name = ${LEDGER_KEY}`);
}, 30_000);

/** Reset ledger before each test so the full migration path runs. */
beforeEach(async () => {
  if (!dbAvailable) return;
  // Reset automation_class on all test stations so each test starts clean.
  await db.execute(
    sql`UPDATE stations SET automation_class = NULL WHERE slug LIKE ${"test-acm-%" + run}`,
  );
  await db.execute(sql`DELETE FROM migration_completions WHERE name = ${LEDGER_KEY}`);
}, 10_000);

// ── helpers ─────────────────────────────────────────────────────────────────

async function getAutomationClass(stationId: number): Promise<string | null> {
  const rows = await db.execute(
    sql`SELECT automation_class FROM stations WHERE id = ${stationId}`,
  );
  return ((rows.rows[0] as { automation_class: string | null } | undefined)?.automation_class) ?? null;
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("applyAutomationClassMigration", () => {
  it(
    "seeds 'automated' for somafm source on first run",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !automatedStationId) return ctx.skip();

      await applyAutomationClassMigration();

      expect(await getAutomationClass(automatedStationId)).toBe("automated");

      // Ledger row must exist.
      const ledger = await db.execute(
        sql`SELECT name FROM migration_completions WHERE name = ${LEDGER_KEY}`,
      );
      expect(ledger.rows.length).toBe(1);
    },
  );

  it(
    "seeds 'human' for kexp_api source on first run",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !humanStationId) return ctx.skip();

      await applyAutomationClassMigration();

      expect(await getAutomationClass(humanStationId)).toBe("human");
    },
  );

  it(
    "seeds 'mixed' for nts_live source on first run",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !ntsStationId) return ctx.skip();

      await applyAutomationClassMigration();

      expect(await getAutomationClass(ntsStationId)).toBe("mixed");
    },
  );

  it(
    "is idempotent: second call is a no-op (completion ledger gates DML)",
    { timeout: 60_000 },
    async (ctx) => {
      if (!dbAvailable || !automatedStationId) return ctx.skip();

      // First call: seeding UPDATEs run, ledger row inserted.
      await applyAutomationClassMigration();
      expect(await getAutomationClass(automatedStationId)).toBe("automated");

      // Simulate a scenario where automation_class was reset to NULL after the
      // first run (e.g. a manual admin action). On a plain re-run without a
      // ledger the UPDATE would re-classify it — but the ledger must prevent it.
      await db.execute(
        sql`UPDATE stations SET automation_class = NULL WHERE id = ${automatedStationId}`,
      );
      expect(await getAutomationClass(automatedStationId)).toBeNull();

      // Second call: ledger row present → DML must be skipped entirely.
      await applyAutomationClassMigration();

      // automation_class must remain NULL because the UPDATE did not run.
      expect(await getAutomationClass(automatedStationId)).toBeNull();
    },
  );
});
