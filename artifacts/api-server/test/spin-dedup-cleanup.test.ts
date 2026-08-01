// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray, sql, eq } from "drizzle-orm";
import { db, stationsTable, spinsTable } from "@workspace/db";
import { applySpinDedupCleanup } from "../src/lore/spin-dedup-cleanup.js";
import { applyMigrationCompletionsMigration } from "../src/lore/migration-completions-migration.js";

/**
 * Integration tests for applySpinDedupCleanup.
 *
 * Each test seeds its own isolated rows (unique station slug per run, unique
 * artist/title per test) and cleans up after itself.  Between tests the
 * completion-ledger row is deleted so each test can exercise the full migration
 * path.
 *
 * Tests skip gracefully when no DB is reachable (CI without Postgres).
 */

const run = randomUUID().slice(0, 8);
const SLUG = `test-sdc-${run}`;

let dbAvailable = false;
let stationId: number | undefined;

// ── Shared setup / teardown ──────────────────────────────────────────────────

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Ensure the migration_completions table exists before any test runs.
  await applyMigrationCompletionsMigration();

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG,
      name: `Test SpinDedupCleanup ${run}`,
      streamUrl: "http://example.invalid/sdc",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !stationId) return;
  // Clean up all spins written by this test run, then the station row.
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, [stationId]));
  await db.delete(stationsTable).where(inArray(stationsTable.id, [stationId]));
  // Remove the completion ledger row so it doesn't bleed into unrelated suites.
  await db.execute(
    sql`DELETE FROM migration_completions WHERE name = 'applySpinDedupCleanup'`,
  );
}, 30_000);

/** Remove the completion-ledger row before each test so the full migration path runs. */
beforeEach(async () => {
  if (!dbAvailable) return;
  await db.execute(
    sql`DELETE FROM migration_completions WHERE name = 'applySpinDedupCleanup'`,
  );
}, 10_000);

// ── Helper ───────────────────────────────────────────────────────────────────

async function insertSpin(opts: {
  rawArtist: string;
  rawTitle: string;
  playedAt: Date;
  source?: string;
}): Promise<number> {
  const [row] = await db
    .insert(spinsTable)
    .values({
      stationId: stationId!,
      mbid: null,
      confidence: "text",
      rawArtist: opts.rawArtist,
      rawTitle: opts.rawTitle,
      playedAt: opts.playedAt,
      source: opts.source ?? "spinitron",
    })
    .returning({ id: spinsTable.id });
  return row!.id;
}

async function spinExists(id: number): Promise<boolean> {
  const rows = await db
    .select({ id: spinsTable.id })
    .from(spinsTable)
    .where(eq(spinsTable.id, id));
  return rows.length > 0;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("applySpinDedupCleanup", () => {
  it("removes a duplicate and keeps only the root spin", { timeout: 30_000 }, async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    const ARTIST = `RootOnly-${run}-${randomUUID().slice(0, 4)}`;
    const TITLE = `Song-${randomUUID().slice(0, 4)}`;
    const base = new Date("2024-01-10T12:00:00Z");

    // Root spin at t=0, duplicate at t=60s (within 120 s window).
    const rootId = await insertSpin({ rawArtist: ARTIST, rawTitle: TITLE, playedAt: base });
    const dupId = await insertSpin({
      rawArtist: ARTIST,
      rawTitle: TITLE,
      playedAt: new Date(base.getTime() + 60_000),
    });

    await applySpinDedupCleanup();

    expect(await spinExists(rootId)).toBe(true);
    expect(await spinExists(dupId)).toBe(false);
  });

  it("collapses an A→B→C chain to A (B and C removed)", { timeout: 30_000 }, async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    const ARTIST = `Chain-${run}-${randomUUID().slice(0, 4)}`;
    const TITLE = `ChainSong-${randomUUID().slice(0, 4)}`;
    const base = new Date("2024-01-10T13:00:00Z");

    // A at t=0, B at t=100s (dup of A), C at t=190s (dup of B, within 120 s of B
    // but outside 120 s of A — tests transitive keeper resolution).
    const aId = await insertSpin({ rawArtist: ARTIST, rawTitle: TITLE, playedAt: base });
    const bId = await insertSpin({
      rawArtist: ARTIST,
      rawTitle: TITLE,
      playedAt: new Date(base.getTime() + 100_000),
    });
    const cId = await insertSpin({
      rawArtist: ARTIST,
      rawTitle: TITLE,
      playedAt: new Date(base.getTime() + 190_000),
    });

    await applySpinDedupCleanup();

    expect(await spinExists(aId)).toBe(true);
    expect(await spinExists(bId)).toBe(false);
    expect(await spinExists(cId)).toBe(false);
  });

  it("remaps a pending_keeps row on a dup spin to the keeper, then removes the dup", { timeout: 30_000 }, async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    // pending_keeps requires a real lore_users row.  Use device_key as identity.
    const deviceKey = `sdc-dev-${randomUUID()}`;
    const userRows = await db.execute(
      sql`INSERT INTO lore_users (device_key) VALUES (${deviceKey}) RETURNING id`,
    );
    const userId = (userRows.rows[0] as { id: number }).id;

    try {
      const ARTIST = `PKRemap-${run}-${randomUUID().slice(0, 4)}`;
      const TITLE = `PKSong-${randomUUID().slice(0, 4)}`;
      const base = new Date("2024-01-10T14:00:00Z");

      const rootId = await insertSpin({ rawArtist: ARTIST, rawTitle: TITLE, playedAt: base });
      const dupId = await insertSpin({
        rawArtist: ARTIST,
        rawTitle: TITLE,
        playedAt: new Date(base.getTime() + 50_000),
      });

      // Attach a pending_keep to the dup spin.
      await db.execute(
        sql`INSERT INTO pending_keeps (user_id, spin_id) VALUES (${userId}, ${dupId})`,
      );

      await applySpinDedupCleanup();

      // Dup spin should be gone.
      expect(await spinExists(dupId)).toBe(false);
      // Root spin must still exist.
      expect(await spinExists(rootId)).toBe(true);

      // The pending_keep must now reference the keeper (root), not the deleted dup.
      const keeps = await db.execute(
        sql`SELECT spin_id FROM pending_keeps WHERE user_id = ${userId}`,
      );
      const spinIds = (keeps.rows as Array<{ spin_id: number }>).map((r) => r.spin_id);
      expect(spinIds).toContain(rootId);
      expect(spinIds).not.toContain(dupId);
    } finally {
      // Clean up the test user row (pending_keeps cascades).
      await db.execute(sql`DELETE FROM lore_users WHERE id = ${userId}`);
    }
  });

  it("does NOT delete a source='manual' spin inside the 120 s window of another spin", { timeout: 30_000 }, async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    const ARTIST = `ManualSrc-${run}-${randomUUID().slice(0, 4)}`;
    const TITLE = `ManualSong-${randomUUID().slice(0, 4)}`;
    const base = new Date("2024-01-10T15:00:00Z");

    // A live-polled root spin...
    const liveId = await insertSpin({
      rawArtist: ARTIST,
      rawTitle: TITLE,
      playedAt: base,
      source: "spinitron",
    });

    // ...and a manual spin with the same normalised sig, 60 s later.
    // This must NOT be treated as a duplicate because source='manual'.
    const manualId = await insertSpin({
      rawArtist: ARTIST,
      rawTitle: TITLE,
      playedAt: new Date(base.getTime() + 60_000),
      source: "manual",
    });

    await applySpinDedupCleanup();

    expect(await spinExists(liveId)).toBe(true);
    expect(await spinExists(manualId)).toBe(true); // must survive
  });

  it("does NOT delete a source='backfill' spin inside the 120 s window", { timeout: 30_000 }, async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    const ARTIST = `BackfillSrc-${run}-${randomUUID().slice(0, 4)}`;
    const TITLE = `BackfillSong-${randomUUID().slice(0, 4)}`;
    const base = new Date("2024-01-10T16:00:00Z");

    const liveId = await insertSpin({
      rawArtist: ARTIST,
      rawTitle: TITLE,
      playedAt: base,
      source: "kexp",
    });
    const backfillId = await insertSpin({
      rawArtist: ARTIST,
      rawTitle: TITLE,
      playedAt: new Date(base.getTime() + 30_000),
      source: "backfill",
    });

    await applySpinDedupCleanup();

    expect(await spinExists(liveId)).toBe(true);
    expect(await spinExists(backfillId)).toBe(true); // must survive
  });

  it("is idempotent: calling it a second time is a no-op (completion ledger)", { timeout: 60_000 }, async (ctx) => {
    if (!dbAvailable || !stationId) return ctx.skip();

    const ARTIST = `Idem-${run}-${randomUUID().slice(0, 4)}`;
    const TITLE = `IdemSong-${randomUUID().slice(0, 4)}`;
    const base = new Date("2024-01-10T17:00:00Z");

    const rootId = await insertSpin({ rawArtist: ARTIST, rawTitle: TITLE, playedAt: base });
    const dupId = await insertSpin({
      rawArtist: ARTIST,
      rawTitle: TITLE,
      playedAt: new Date(base.getTime() + 45_000),
    });

    // First call: does the work, inserts completion row.
    await applySpinDedupCleanup();
    expect(await spinExists(rootId)).toBe(true);
    expect(await spinExists(dupId)).toBe(false);

    // Verify the completion row was persisted.
    const ledger = await db.execute(
      sql`SELECT name FROM migration_completions WHERE name = 'applySpinDedupCleanup'`,
    );
    expect(ledger.rows.length).toBe(1);

    // Second call: completion row exists → instant skip, no DB changes.
    // We assert this by inserting a new dup pair AFTER the first run; if the
    // second call ran the cleanup it would remove the dup, but since it bails
    // out at the ledger check the dup must still be present.
    const afterRootId = await insertSpin({
      rawArtist: ARTIST,
      rawTitle: TITLE,
      playedAt: new Date(base.getTime() + 200_000), // far enough from root — new "root"
    });
    const afterDupId = await insertSpin({
      rawArtist: ARTIST,
      rawTitle: TITLE,
      playedAt: new Date(base.getTime() + 230_000), // dup of afterRoot — would be deleted if cleanup ran
    });

    await applySpinDedupCleanup(); // second call — must be a no-op

    // Both spins inserted after the first run must still be present because
    // the second call returned immediately without touching spins.
    expect(await spinExists(afterRootId)).toBe(true);
    expect(await spinExists(afterDupId)).toBe(true);
  });
});
