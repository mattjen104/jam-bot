import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Durable singleton snapshot for the in-process now-playing scheduler. */
export async function applyPollerHealthMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lore_poller_health (
      key                       text        PRIMARY KEY,
      owner_id                  text        NOT NULL,
      process_started_at        timestamptz NOT NULL,
      heartbeat_at             timestamptz NOT NULL,
      active                    boolean     NOT NULL DEFAULT false,
      expected_station_count    integer     NOT NULL DEFAULT 0,
      enrolled_station_count    integer     NOT NULL DEFAULT 0,
      cycle_started_at          timestamptz NOT NULL,
      last_cycle_completed_at   timestamptz,
      attempted_station_count   integer     NOT NULL DEFAULT 0,
      successful_station_count  integer     NOT NULL DEFAULT 0,
      recovery_state            text        NOT NULL DEFAULT 'healthy',
      last_stall_detected_at     timestamptz,
      last_recovered_at          timestamptz,
      updated_at                timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Upgrade a table created by an earlier build of this migration.
  await db.execute(sql`
    ALTER TABLE lore_poller_health
      ADD COLUMN IF NOT EXISTS owner_id text
  `);
  await db.execute(sql`
    UPDATE lore_poller_health
    SET owner_id = 'legacy'
    WHERE owner_id IS NULL
  `);
  await db.execute(sql`
    ALTER TABLE lore_poller_health
      ALTER COLUMN owner_id SET NOT NULL
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lore_operator_alert_outbox (
      id             bigserial   PRIMARY KEY,
      alert_key      text        NOT NULL UNIQUE,
      owner_id       text        NOT NULL,
      kind           text        NOT NULL,
      occurred_at    timestamptz NOT NULL,
      payload        jsonb       NOT NULL,
      status         text        NOT NULL DEFAULT 'pending',
      attempts       integer     NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      delivered_at   timestamptz,
      last_error     text,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    ALTER TABLE lore_operator_alert_outbox
      ADD COLUMN IF NOT EXISTS owner_id text
  `);
  await db.execute(sql`
    UPDATE lore_operator_alert_outbox
    SET owner_id = 'legacy'
    WHERE owner_id IS NULL
  `);
  await db.execute(sql`
    ALTER TABLE lore_operator_alert_outbox
      ALTER COLUMN owner_id SET NOT NULL
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lore_operator_alert_outbox_pending_idx
    ON lore_operator_alert_outbox (next_attempt_at)
    WHERE status = 'pending'
  `);
}