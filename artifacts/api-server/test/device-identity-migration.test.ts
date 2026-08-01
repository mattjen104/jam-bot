// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { applyDeviceIdentityMigration } from "../src/lore/device-identity-migration.js";
import { applyMigrationCompletionsMigration } from "../src/lore/migration-completions-migration.js";

/**
 * Integration tests for applyDeviceIdentityMigration.
 *
 * The entire function is gated by the completion ledger (DDL and DML are
 * interdependent — NOT NULL on device_key depends on the backfill UPDATEs).
 * These tests focus on step 8 (spotify_user_id → external_user_id copy) as
 * the observable DML proof, since device_key is NOT NULL after first run and
 * cannot be easily reset to NULL without dropping the constraint.
 *
 * "Exactly once" proof:
 *   1. Run migration → step 8 populates external_user_id.
 *   2. Ledger row present.
 *   3. Create a new service_connections row with external_user_id = NULL.
 *   4. Run migration again → external_user_id must remain NULL (DML gated).
 */

const run = randomUUID().slice(0, 8);
const LEDGER_KEY = "applyDeviceIdentityMigration";

let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
  } catch {
    return;
  }
  await applyMigrationCompletionsMigration();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  await db.execute(sql`DELETE FROM migration_completions WHERE name = ${LEDGER_KEY}`);
}, 10_000);

beforeEach(async () => {
  if (!dbAvailable) return;
  await db.execute(sql`DELETE FROM migration_completions WHERE name = ${LEDGER_KEY}`);
}, 10_000);

// ── helpers ───────────────────────────────────────────────────────────────────

/** Insert a minimal lore_users row and return its id. */
async function insertUser(opts: { deviceKey: string; spotifyUserId?: string }): Promise<number> {
  const rows = await db.execute(
    sql`INSERT INTO lore_users (device_key, spotify_user_id)
        VALUES (${opts.deviceKey}, ${opts.spotifyUserId ?? null})
        RETURNING id`,
  );
  return (rows.rows[0] as { id: number }).id;
}

/** Insert a service_connections row (service='spotify', external_user_id=NULL). */
async function insertSpotifyConnection(userId: number): Promise<number> {
  const rows = await db.execute(
    sql`INSERT INTO service_connections (user_id, service, access_token, refresh_token, expires_at)
        VALUES (${userId}, 'spotify', ${"tok-" + run}, ${"ref-" + run}, now() + interval '1 hour')
        RETURNING id`,
  );
  return (rows.rows[0] as { id: number }).id;
}

async function getExternalUserId(connId: number): Promise<string | null> {
  const rows = await db.execute(
    sql`SELECT external_user_id FROM service_connections WHERE id = ${connId}`,
  );
  return (
    (rows.rows[0] as { external_user_id: string | null } | undefined)?.external_user_id ?? null
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("applyDeviceIdentityMigration", () => {
  it(
    "copies spotify_user_id → external_user_id on first run (step 8)",
    { timeout: 30_000 },
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      const spotifyUserId = `sp-${run}-${randomUUID().slice(0, 6)}`;
      const userId = await insertUser({
        deviceKey: `dev-${randomUUID()}`,
        spotifyUserId,
      });
      const connId = await insertSpotifyConnection(userId);

      try {
        await applyDeviceIdentityMigration();

        // step 8 must have populated external_user_id from spotify_user_id.
        expect(await getExternalUserId(connId)).toBe(spotifyUserId);

        // Ledger row must exist.
        const ledger = await db.execute(
          sql`SELECT name FROM migration_completions WHERE name = ${LEDGER_KEY}`,
        );
        expect(ledger.rows.length).toBe(1);
      } finally {
        await db.execute(sql`DELETE FROM service_connections WHERE id = ${connId}`);
        await db.execute(sql`DELETE FROM lore_users WHERE id = ${userId}`);
      }
    },
  );

  it(
    "is idempotent: second call does not populate external_user_id (completion ledger gates DML)",
    { timeout: 60_000 },
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      // First call: runs step 8, inserts ledger row.
      const spotifyUserId1 = `sp-${run}-1-${randomUUID().slice(0, 6)}`;
      const userId1 = await insertUser({
        deviceKey: `dev-${randomUUID()}`,
        spotifyUserId: spotifyUserId1,
      });
      const connId1 = await insertSpotifyConnection(userId1);

      try {
        await applyDeviceIdentityMigration();
        expect(await getExternalUserId(connId1)).toBe(spotifyUserId1);

        // Ledger row is now present.
        const ledger = await db.execute(
          sql`SELECT name FROM migration_completions WHERE name = ${LEDGER_KEY}`,
        );
        expect(ledger.rows.length).toBe(1);

        // Create a second user + connection AFTER the first run.
        // If the second call ran step 8, external_user_id would be populated.
        // Since the ledger gates it, it must stay NULL.
        const spotifyUserId2 = `sp-${run}-2-${randomUUID().slice(0, 6)}`;
        const userId2 = await insertUser({
          deviceKey: `dev-${randomUUID()}`,
          spotifyUserId: spotifyUserId2,
        });
        const connId2 = await insertSpotifyConnection(userId2);

        try {
          // Second call — must be a no-op.
          await applyDeviceIdentityMigration();

          // external_user_id must remain NULL because step 8 did not run.
          expect(await getExternalUserId(connId2)).toBeNull();
        } finally {
          await db.execute(sql`DELETE FROM service_connections WHERE id = ${connId2}`);
          await db.execute(sql`DELETE FROM lore_users WHERE id = ${userId2}`);
        }
      } finally {
        await db.execute(sql`DELETE FROM service_connections WHERE id = ${connId1}`);
        await db.execute(sql`DELETE FROM lore_users WHERE id = ${userId1}`);
      }
    },
  );
});
