// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, stationsTable } from "@workspace/db";
import { applyStationScheduleMigration } from "../src/lore/station-schedule-migration.js";
import { applyMigrationCompletionsMigration } from "../src/lore/migration-completions-migration.js";

/**
 * Integration tests for the DML portion of applyStationScheduleMigration.
 *
 * The DDL (CREATE TABLE / INDEX IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT
 * EXISTS) is idempotent and runs unconditionally on every boot. These tests
 * cover the ledger-gated DML:
 *
 *   - upcoming_show_count backfill UPDATE
 *   - invisible-character cleanup in scraped_shows (DELETE + UPDATE)
 *
 * "Exactly once" proof for upcoming_show_count:
 *   1. Seed a station with upcoming_show_count=0 and N scraped_shows rows.
 *   2. Run migration → upcoming_show_count is set to N, ledger row inserted.
 *   3. Manually reset upcoming_show_count to 0.
 *   4. Run migration again → upcoming_show_count must remain 0 (DML gated).
 *
 * "Exactly once" proof for invisible-char cleanup:
 *   1. Insert a scraped_shows row with a zero-width char in show_name.
 *   2. Run migration → show_name is cleaned, ledger row inserted.
 *   3. Insert another dirty row.
 *   4. Run migration again → dirty row must remain untouched (DML gated).
 */

const run = randomUUID().slice(0, 8);
const SLUG = `test-sched-dml-${run}`;
const LEDGER_KEY = "applyStationScheduleMigration";

let dbAvailable = false;
let stationId: number | undefined;

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await applyMigrationCompletionsMigration();
  // Ensure DDL (scraped_shows table + columns) exists before seeding test data.
  await applyStationScheduleMigration();

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG,
      name: `Test SchedDML ${run}`,
      streamUrl: "http://example.invalid/sched-dml",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !stationId) return;
  await db.execute(sql`DELETE FROM scraped_shows WHERE station_id = ${stationId}`);
  await db.execute(sql`DELETE FROM stations WHERE id = ${stationId}`);
  await db.execute(sql`DELETE FROM migration_completions WHERE name = ${LEDGER_KEY}`);
}, 30_000);

beforeEach(async () => {
  if (!dbAvailable || !stationId) return;
  // Clean test rows and reset ledger so each test exercises the full path.
  await db.execute(sql`DELETE FROM scraped_shows WHERE station_id = ${stationId}`);
  await db.execute(
    sql`UPDATE stations SET upcoming_show_count = 0 WHERE id = ${stationId}`,
  );
  await db.execute(sql`DELETE FROM migration_completions WHERE name = ${LEDGER_KEY}`);
}, 10_000);

// ── helpers ───────────────────────────────────────────────────────────────────

async function insertScrapedShow(showName: string, djName?: string): Promise<number> {
  const rows = await db.execute(
    sql`INSERT INTO scraped_shows (station_id, show_name, day_of_week, start_time, end_time, dj_name)
        VALUES (${stationId}, ${showName}, 'Mon', '09:00', '11:00', ${djName ?? null})
        RETURNING id`,
  );
  return (rows.rows[0] as { id: number }).id;
}

async function getUpcomingShowCount(): Promise<number> {
  const rows = await db.execute(
    sql`SELECT upcoming_show_count FROM stations WHERE id = ${stationId}`,
  );
  return (rows.rows[0] as { upcoming_show_count: number }).upcoming_show_count;
}

async function getShowName(id: number): Promise<string | null> {
  const rows = await db.execute(
    sql`SELECT show_name FROM scraped_shows WHERE id = ${id}`,
  );
  if (!rows.rows.length) return null;
  return (rows.rows[0] as { show_name: string }).show_name;
}

async function showExists(id: number): Promise<boolean> {
  const rows = await db.execute(sql`SELECT 1 FROM scraped_shows WHERE id = ${id}`);
  return rows.rows.length > 0;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("applyStationScheduleMigration — DML ledger gate", () => {
  it(
    "backfills upcoming_show_count from scraped_shows on first run",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // Seed two scraped_shows rows; station starts at 0.
      await insertScrapedShow(`ShowA-${run}`);
      await insertScrapedShow(`ShowB-${run}`);
      expect(await getUpcomingShowCount()).toBe(0);

      await applyStationScheduleMigration();

      expect(await getUpcomingShowCount()).toBe(2);

      const ledger = await db.execute(
        sql`SELECT name FROM migration_completions WHERE name = ${LEDGER_KEY}`,
      );
      expect(ledger.rows.length).toBe(1);
    },
  );

  it(
    "is idempotent: upcoming_show_count backfill does not run on second call (completion ledger)",
    { timeout: 60_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      await insertScrapedShow(`ShowC-${run}`);

      // First call: backfill runs → count = 1, ledger row inserted.
      await applyStationScheduleMigration();
      expect(await getUpcomingShowCount()).toBe(1);

      // Reset count to 0, then seed more shows.
      await db.execute(
        sql`UPDATE stations SET upcoming_show_count = 0 WHERE id = ${stationId}`,
      );
      await insertScrapedShow(`ShowD-${run}`);
      expect(await getUpcomingShowCount()).toBe(0);

      // Second call: ledger present → DML must be skipped.
      await applyStationScheduleMigration();

      // Count must remain 0 — the backfill UPDATE did not run.
      expect(await getUpcomingShowCount()).toBe(0);
    },
  );

  it(
    "cleans invisible characters from show_name on first run",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // U+200B (zero-width space) embedded in show_name.
      const dirtyName = `Morning\u200BJazz-${run}`;
      const cleanName = `Morning Jazz-${run}`;
      const showId = await insertScrapedShow(dirtyName);

      await applyStationScheduleMigration();

      // show_name must be rewritten with the invisible char replaced by a space.
      expect(await getShowName(showId)).toBe(cleanName);
    },
  );

  it(
    "is idempotent: invisible-char cleanup does not run on second call (completion ledger)",
    { timeout: 60_000 },
    async (ctx) => {
      if (!dbAvailable || !stationId) return ctx.skip();

      // First call: cleanup runs on any dirty rows (none here — just triggers ledger).
      await applyStationScheduleMigration();

      const ledger = await db.execute(
        sql`SELECT name FROM migration_completions WHERE name = ${LEDGER_KEY}`,
      );
      expect(ledger.rows.length).toBe(1);

      // Insert a dirty row AFTER the first run.
      const dirtyName = `Late\u200BNight-${run}`;
      const showId = await insertScrapedShow(dirtyName);

      // Second call: ledger present → cleanup DML must be skipped.
      await applyStationScheduleMigration();

      // The dirty row must remain unchanged because the cleanup did not run.
      expect(await showExists(showId)).toBe(true);
      expect(await getShowName(showId)).toBe(dirtyName);
    },
  );
});
