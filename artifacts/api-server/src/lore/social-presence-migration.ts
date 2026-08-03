import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Add the anonymous active-listener participation preference. */
export async function applySocialPresenceMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE lore_users
      ADD COLUMN IF NOT EXISTS social_participation boolean NOT NULL DEFAULT true
  `);
}