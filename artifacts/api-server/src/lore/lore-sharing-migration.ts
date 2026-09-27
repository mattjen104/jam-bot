import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function applyLoreSharingMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lore_sharing_handoffs (
      token_hash text PRIMARY KEY,
      workspace_id text NOT NULL,
      channel_id text NOT NULL,
      slack_user_id text NOT NULL,
      owner_label text NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lore_sharing_handoffs_expiry_idx
      ON lore_sharing_handoffs (expires_at)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lore_sharing_grants (
      id serial PRIMARY KEY,
      workspace_id text NOT NULL,
      channel_id text NOT NULL,
      slack_user_id text NOT NULL,
      owner_label text NOT NULL,
      user_id integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS lore_sharing_grants_active_scope_uq
      ON lore_sharing_grants (workspace_id, channel_id)
      WHERE revoked_at IS NULL
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lore_sharing_grants_user_idx
      ON lore_sharing_grants (user_id, revoked_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lore_sharing_grants_slack_scope_idx
      ON lore_sharing_grants (workspace_id, channel_id, slack_user_id, revoked_at)
  `);
}