import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { loreUsersTable } from "./lore";

/** Short-lived bearer handoffs; only SHA-256 token hashes are persisted. */
export const loreSharingHandoffsTable = pgTable(
  "lore_sharing_handoffs",
  {
    tokenHash: text("token_hash").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    channelId: text("channel_id").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    ownerLabel: text("owner_label").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lore_sharing_handoffs_expiry_idx").on(table.expiresAt)],
);

/** A single active personal library grant per Slack workspace + channel. */
export const loreSharingGrantsTable = pgTable(
  "lore_sharing_grants",
  {
    id: serial("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    channelId: text("channel_id").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    ownerLabel: text("owner_label").notNull(),
    userId: integer("user_id").notNull().references(() => loreUsersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("lore_sharing_grants_active_scope_uq")
      .on(table.workspaceId, table.channelId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("lore_sharing_grants_user_idx").on(table.userId, table.revokedAt),
    index("lore_sharing_grants_slack_scope_idx").on(
      table.workspaceId,
      table.channelId,
      table.slackUserId,
      table.revokedAt,
    ),
  ],
);

export type LoreSharingHandoff = typeof loreSharingHandoffsTable.$inferSelect;
export type LoreSharingGrant = typeof loreSharingGrantsTable.$inferSelect;