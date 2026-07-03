import type { Request } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  type LoreUser,
} from "@workspace/db";

const SID_COOKIE = "lore_sid";

export function sidFromRequest(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  const sid = cookies?.[SID_COOKIE];
  return typeof sid === "string" && sid.length > 0 ? sid : null;
}

/**
 * Resolve the Lore user identity from the `lore_sid` cookie.
 * Returns null when no session cookie is present or the sid has no
 * linked lore_users row (i.e. the user connected Spotify but the
 * upsert hasn't fired yet — very transient; return 401).
 */
export async function getUserFromSession(
  req: Request,
): Promise<LoreUser | null> {
  const sid = sidFromRequest(req);
  if (!sid) return null;

  const [user] = await db
    .select()
    .from(loreUsersTable)
    .where(eq(loreUsersTable.spotifyConnectionId, sid))
    .limit(1);

  return user ?? null;
}

/**
 * Upsert a lore_users row keyed by Spotify user id, pointing it at the
 * current session sid.  Called from the Spotify OAuth callback so that
 * every connected listener automatically gets a persistent identity.
 */
export async function upsertLoreUserForSid(
  spotifyUserId: string,
  sid: string,
): Promise<LoreUser> {
  const [row] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId, spotifyConnectionId: sid })
    .onConflictDoUpdate({
      target: loreUsersTable.spotifyUserId,
      set: { spotifyConnectionId: sid },
    })
    .returning();
  return row!;
}

/**
 * Verify the `lore_sid` cookie still maps to a live spotify_connections row
 * (i.e. the user hasn't logged out of Spotify Connect).  Used by the
 * requireUser middleware to guard all /me/* endpoints.
 */
export async function sessionIsLive(sid: string): Promise<boolean> {
  const [row] = await db
    .select({ sid: spotifyConnectionsTable.sid })
    .from(spotifyConnectionsTable)
    .where(eq(spotifyConnectionsTable.sid, sid))
    .limit(1);
  return !!row;
}
