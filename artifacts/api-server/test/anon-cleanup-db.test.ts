// @vitest-environment node
/**
 * Integration tests for the anonymous session expiry cleanup query.
 *
 * Seeds a mix of eligible and ineligible lore_users rows, runs the cleanup
 * function directly, and asserts only the correct rows are removed.
 *
 * Ineligible scenarios tested:
 *   A. Row is too recent (last_seen_at within 90 days)
 *   B. Row has library items
 *   C. Row has a Spotify account (legacy spotify_user_id)
 *   D. Row has a service_connections link (modern Spotify OAuth)
 *   E. Row is eligible (no Spotify, no library items, idle ≥ 90 days)
 *   F. Row with NULL last_seen_at (never touched) — also eligible
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  libraryItemsTable,
  serviceConnectionsTable,
  recordingsTable,
} from "@workspace/db";
import { runAnonCleanup } from "../src/lore/anonCleanup.js";

const run = randomUUID().slice(0, 8);

// ── Shared recording (needed for library_items FK) ───────────────────────────
const MBID = `anon-cleanup-${run}`;

// ── State ────────────────────────────────────────────────────────────────────
let dbAvailable = false;

/** Returns a Date that is `days` days ago. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
}

/** IDs inserted by this run — used for cleanup on teardown. */
const insertedUserIds: number[] = [];

async function insertUser(overrides: Partial<typeof loreUsersTable.$inferInsert> = {}): Promise<number> {
  const [u] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: `anon-cleanup-${run}-${randomUUID()}`, ...overrides })
    .returning({ id: loreUsersTable.id });
  insertedUserIds.push(u!.id);
  return u!.id;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Seed a recording so library_items FK is satisfied.
  await db
    .insert(recordingsTable)
    .values({ mbid: MBID, title: `Cleanup Test Track ${run}`, artist: `Artist ${run}` })
    .onConflictDoNothing();
});

afterAll(async () => {
  if (!dbAvailable) return;

  if (insertedUserIds.length > 0) {
    // library_items and service_connections must be deleted before lore_users
    // (they reference lore_users.id without ON DELETE CASCADE).
    await db
      .delete(libraryItemsTable)
      .where(inArray(libraryItemsTable.userId, insertedUserIds))
      .catch(() => {});
    await db
      .delete(serviceConnectionsTable)
      .where(inArray(serviceConnectionsTable.userId, insertedUserIds))
      .catch(() => {});
    await db
      .delete(loreUsersTable)
      .where(inArray(loreUsersTable.id, insertedUserIds))
      .catch(() => {});
  }

  await db
    .delete(recordingsTable)
    .where(eq(recordingsTable.mbid, MBID))
    .catch(() => {});
}, 90_000);

// ── Tests ────────────────────────────────────────────────────────────────────

describe("runAnonCleanup", () => {
  it("deletes eligible rows and leaves ineligible rows untouched", async () => {
    if (!dbAvailable) return;

    // Scenario A: too recent — should NOT be deleted.
    const recentId = await insertUser({ lastSeenAt: daysAgo(10) });

    // Scenario B: has library items — should NOT be deleted.
    const hasLibraryId = await insertUser({ lastSeenAt: daysAgo(100) });
    await db.insert(libraryItemsTable).values({
      userId: hasLibraryId,
      mbid: MBID,
      provenance: { kind: "keep" },
    });

    // Scenario C: has legacy Spotify user id — should NOT be deleted.
    const hasSpotifyLegacyId = await insertUser({
      lastSeenAt: daysAgo(100),
      spotifyUserId: `sp-legacy-${run}`,
    });

    // Scenario D: has a service_connections row — should NOT be deleted.
    const hasServiceConnId = await insertUser({ lastSeenAt: daysAgo(100) });
    await db.insert(serviceConnectionsTable).values({
      userId: hasServiceConnId,
      service: "spotify",
      externalUserId: `ext-${run}`,
      accessToken: "tok",
      refreshToken: "rtok",
      expiresAt: daysAgo(-3600), // future
    });

    // Scenario E: fully eligible (old, no Spotify, no library) — SHOULD be deleted.
    const eligibleId = await insertUser({ lastSeenAt: daysAgo(100) });

    // Scenario F: null last_seen_at (never touched) — SHOULD be deleted.
    const nullSeenId = await insertUser({ lastSeenAt: undefined });

    // Run the cleanup.
    const deleted = await runAnonCleanup();

    // At least 2 rows were deleted (E and F from this run).
    expect(deleted).toBeGreaterThanOrEqual(2);

    // Ineligible rows must still exist.
    for (const id of [recentId, hasLibraryId, hasSpotifyLegacyId, hasServiceConnId]) {
      const [row] = await db
        .select({ id: loreUsersTable.id })
        .from(loreUsersTable)
        .where(eq(loreUsersTable.id, id))
        .limit(1);
      expect(row, `user ${id} should still exist`).toBeDefined();
    }

    // Eligible rows must be gone.
    for (const id of [eligibleId, nullSeenId]) {
      const [row] = await db
        .select({ id: loreUsersTable.id })
        .from(loreUsersTable)
        .where(eq(loreUsersTable.id, id))
        .limit(1);
      expect(row, `user ${id} should have been deleted`).toBeUndefined();
      // Remove from cleanup list since they're already deleted.
      const idx = insertedUserIds.indexOf(id);
      if (idx !== -1) insertedUserIds.splice(idx, 1);
    }
  }, 90_000);
});
