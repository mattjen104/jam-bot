import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  serviceConnectionsTable,
  libraryItemsTable,
  pendingKeepsTable,
  type LoreUser,
} from "@workspace/db";

export const SID_COOKIE = "lore_sid";

/**
 * Cookie lifetime: 2 years. Clearing localStorage alone must not lose the
 * library — the HttpOnly cookie is the durable identity anchor.
 */
export const SID_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365 * 2;

/** Standard options for the lore_sid identity cookie. */
export function cookieSidOpts() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SID_MAX_AGE_MS,
  };
}

export function sidFromRequest(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  const sid = cookies?.[SID_COOKIE];
  return typeof sid === "string" && sid.length > 0 ? sid : null;
}

/**
 * Resolve the Lore user identity from the `lore_sid` cookie.
 *
 * The cookie value is now the `deviceKey` — an opaque UUID that maps directly
 * to a `lore_users.device_key` row with no Spotify dependency.
 * Updates `lastSeenAt` on every successful hit (fire-and-forget).
 */
export async function getUserFromSession(
  req: Request,
): Promise<LoreUser | null> {
  const deviceKey = sidFromRequest(req);
  if (!deviceKey) return null;

  const [user] = await db
    .select()
    .from(loreUsersTable)
    .where(eq(loreUsersTable.deviceKey, deviceKey))
    .limit(1);

  if (!user) return null;

  // Fire-and-forget: keep lastSeenAt fresh without blocking the handler.
  db.update(loreUsersTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(loreUsersTable.id, user.id))
    .catch(() => {});

  return user;
}

/**
 * Look up or create an anonymous lore_users row for the given deviceKey.
 *
 * If no row exists for the `deviceKey`, inserts a fresh anonymous user.
 * Handles the race where two concurrent requests both try to insert the same
 * deviceKey (onConflictDoNothing + re-select).
 */
export async function getOrCreateAnonymousUser(
  deviceKey: string,
): Promise<LoreUser> {
  const [existing] = await db
    .select()
    .from(loreUsersTable)
    .where(eq(loreUsersTable.deviceKey, deviceKey))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(loreUsersTable)
    .values({ deviceKey })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Race: another request inserted it first — re-fetch.
  const [race] = await db
    .select()
    .from(loreUsersTable)
    .where(eq(loreUsersTable.deviceKey, deviceKey))
    .limit(1);
  return race!;
}

/**
 * Attempt to recover a prior library by matching `(service, externalUserId)`
 * in service_connections.
 *
 * Scenarios:
 *   A. Match found, different user → re-point the cookie at the recovered user;
 *      delete the throwaway anonymous row when it has zero library data.
 *   B. Match found, same user → no-op (idempotent re-connect).
 *   C. No match → the anonymous user is the canonical identity; the caller
 *      should upsert the service_connections row against this user.
 *
 * Returns `{ user, recovered }`:
 *   - `user` is the definitive LoreUser after recovery.
 *   - `recovered` is true only in scenario A.
 *
 * The caller is responsible for setting the new cookie value when recovered=true.
 */
export async function recoverUserByServiceId(
  service: string,
  externalUserId: string,
  anonymousUserId: number,
): Promise<{ user: LoreUser; recovered: boolean }> {
  const [match] = await db
    .select({ userId: serviceConnectionsTable.userId })
    .from(serviceConnectionsTable)
    .where(
      and(
        eq(serviceConnectionsTable.service, service),
        eq(serviceConnectionsTable.externalUserId, externalUserId),
      ),
    )
    .limit(1);

  // Scenario B or C.
  if (!match || match.userId === anonymousUserId) {
    const [anon] = await db
      .select()
      .from(loreUsersTable)
      .where(eq(loreUsersTable.id, anonymousUserId))
      .limit(1);
    return { user: anon!, recovered: false };
  }

  // Scenario A: recovered a prior user.
  const recoveredUserId = match.userId;
  const [recoveredUser] = await db
    .select()
    .from(loreUsersTable)
    .where(eq(loreUsersTable.id, recoveredUserId))
    .limit(1);

  if (!recoveredUser) {
    // Shouldn't happen but be defensive.
    const [anon] = await db
      .select()
      .from(loreUsersTable)
      .where(eq(loreUsersTable.id, anonymousUserId))
      .limit(1);
    return { user: anon!, recovered: false };
  }

  // Check whether the throwaway anonymous row has any library data.
  const [libCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, anonymousUserId));
  const [pendingCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pendingKeepsTable)
    .where(eq(pendingKeepsTable.userId, anonymousUserId));

  const isEmpty =
    (libCount?.n ?? 0) === 0 && (pendingCount?.n ?? 0) === 0;

  if (isEmpty) {
    // Safe to delete the ephemeral anonymous row.
    await db
      .delete(loreUsersTable)
      .where(eq(loreUsersTable.id, anonymousUserId))
      .catch(() => {});
  }

  return { user: recoveredUser, recovered: true };
}
