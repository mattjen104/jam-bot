import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL + data migration for the device-identity decoupling.
 *
 * What this does:
 *   1. Adds `device_key` (opaque UUID, the new lore_sid value) to lore_users.
 *   2. Populates `device_key` for existing rows:
 *      - Users whose `spotify_connection_id` still exists in spotify_connections
 *        get `device_key = spotify_connection_id` so their live cookie continues
 *        to work without interruption (zero session breakage for active users).
 *      - All other rows get a fresh gen_random_uuid().
 *   3. Makes `device_key` NOT NULL and adds a unique index.
 *   4. Makes `spotify_user_id` nullable (now a legacy/recovery field, not PK).
 *   5. Adds `last_seen_at`, `email`, `email_verified_at` to lore_users.
 *   6. Adds `external_user_id` to service_connections (recovery anchor).
 *   7. Creates a partial unique index on (service, external_user_id) for
 *      non-null values — the recovery lookup key.
 *   8. Data migration: copies spotify_user_id → external_user_id on existing
 *      service_connections rows for service='spotify'.
 *
 * Safe to run on every boot — every statement uses IF (NOT) EXISTS or is a
 * conditional UPDATE that is a no-op when already applied.
 */
export async function applyDeviceIdentityMigration(): Promise<void> {
  // ── Step 1: add device_key as nullable first (can't set NOT NULL on a
    //   populated table until after back-fill).
    await db.execute(sql`
      ALTER TABLE lore_users
        ADD COLUMN IF NOT EXISTS device_key text
    `);

    // ── Step 2a: users with a live spotify_connections row keep their existing
    //   sid as device_key so their cookie continues working after the deploy.
    await db.execute(sql`
      UPDATE lore_users lu
        SET device_key = lu.spotify_connection_id
        FROM spotify_connections sc
        WHERE lu.device_key IS NULL
          AND lu.spotify_connection_id IS NOT NULL
          AND sc.sid = lu.spotify_connection_id
    `);

    // ── Step 2b: all remaining rows (no connection or connection deleted)
    //   get a fresh opaque UUID.
    await db.execute(sql`
      UPDATE lore_users
        SET device_key = gen_random_uuid()::text
        WHERE device_key IS NULL
    `);

    // ── Step 3: enforce NOT NULL now that every row has a value.
    //   ALTER COLUMN … SET NOT NULL is a no-op when the constraint is already
    //   present, so this is safe to re-run.
    await db.execute(sql`
      ALTER TABLE lore_users
        ALTER COLUMN device_key SET NOT NULL
    `);

    // ── Step 4: unique index on device_key.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS lore_users_device_key_idx
        ON lore_users (device_key)
    `);

    // ── Step 5: make spotify_user_id nullable — it is now a recovery/legacy
    //   field, not the primary identity anchor.
    await db.execute(sql`
      ALTER TABLE lore_users
        ALTER COLUMN spotify_user_id DROP NOT NULL
    `);

    // ── Step 6: optional listener-facing columns.
    await db.execute(sql`
      ALTER TABLE lore_users
        ADD COLUMN IF NOT EXISTS last_seen_at timestamptz
    `);
    await db.execute(sql`
      ALTER TABLE lore_users
        ADD COLUMN IF NOT EXISTS email text
    `);
    await db.execute(sql`
      ALTER TABLE lore_users
        ADD COLUMN IF NOT EXISTS email_verified_at timestamptz
    `);

    // ── Step 7: add external_user_id recovery anchor to service_connections.
    await db.execute(sql`
      ALTER TABLE service_connections
        ADD COLUMN IF NOT EXISTS external_user_id text
    `);

    // Partial unique index: a given (service, external_user_id) pair must
    // resolve to exactly one Lore user. NULL rows excluded — connections not
    // yet back-filled don't conflict with each other.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS service_connections_service_external_idx
        ON service_connections (service, external_user_id)
        WHERE external_user_id IS NOT NULL
    `);

    // ── Step 8: data migration — copy spotify_user_id → external_user_id on
    //   existing service_connections rows for service='spotify'.
    //   Conditional WHERE makes this a no-op on re-runs.
    await db.execute(sql`
      UPDATE service_connections sc
        SET external_user_id = lu.spotify_user_id
        FROM lore_users lu
        WHERE sc.user_id            = lu.id
          AND sc.service            = 'spotify'
          AND lu.spotify_user_id    IS NOT NULL
          AND sc.external_user_id   IS NULL
    `);

}
