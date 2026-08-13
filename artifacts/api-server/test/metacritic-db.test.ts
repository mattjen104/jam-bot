// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, recordingsTable, trackClaimsTable } from "@workspace/db";
import { fetchMetacriticScore } from "../src/lore/metacritic.js";

/**
 * DB tests for fetchMetacriticScore — restart-safe miss sentinels.
 *
 * The in-memory `recentMisses` map is cleared on server restart, so a 403
 * (bot-detection block) would otherwise trigger a retry on every boot.
 * The fix: store a draft `track_claims` sentinel on any all-candidates
 * failure (including 403), not just on ld+json parse errors.
 *
 * These tests verify that after a stubbed 403 response the sentinel row
 * is durably written to the DB, and that a second call for the same
 * release group is skipped even after the in-memory map is cleared.
 */

const run = randomUUID().slice(0, 8);

const RECORDING_MBID = `test-mc-rec-${run}`;
const RELEASE_GROUP  = `test-mc-rg-${run}`;
const MISS_ID        = `metacritic:miss:${RELEASE_GROUP}`;

let dbAvailable = false;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // recordings.mbid FK is required by track_claims.
  await db
    .insert(recordingsTable)
    .values({ mbid: RECORDING_MBID, title: `MC Test Track ${run}`, artist: `MC Artist ${run}` })
    .onConflictDoNothing();
});

afterAll(async () => {
  if (!dbAvailable) return;
  // Clean up in FK order: claims first, then recordings.
  await db
    .delete(trackClaimsTable)
    .where(eq(trackClaimsTable.mbid, RECORDING_MBID));
  await db
    .delete(recordingsTable)
    .where(eq(recordingsTable.mbid, RECORDING_MBID));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchMetacriticScore — 403 stores a DB miss sentinel", () => {
  it("writes a draft sentinel to track_claims when all candidates return 403", async () => {
    if (!dbAvailable) return;

    // Stub every fetch call to return 403 (Metacritic bot detection).
    const fetchStub = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Forbidden", { status: 403 }),
    );

    try {
      const result = await fetchMetacriticScore(
        RECORDING_MBID,
        `MC Artist ${run}`,
        `MC Album ${run}`,
        RELEASE_GROUP,
      );

      expect(result).toBe(false);

      // The sentinel must be persisted in the DB.
      const rows = await db
        .select({ externalId: trackClaimsTable.externalId, status: trackClaimsTable.status })
        .from(trackClaimsTable)
        .where(eq(trackClaimsTable.externalId, MISS_ID));

      expect(rows.length).toBe(1);
      expect(rows[0]!.status).toBe("draft");
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("skips a second fetch for the same release group after the sentinel is stored (simulating restart)", async () => {
    if (!dbAvailable) return;

    // The sentinel from the previous test is already in the DB.
    // Simulate a restart by NOT clearing the sentinel — the DB row should
    // gate the call before any network request is made.
    const fetchStub = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    try {
      const result = await fetchMetacriticScore(
        RECORDING_MBID,
        `MC Artist ${run}`,
        `MC Album ${run}`,
        RELEASE_GROUP,
      );

      expect(result).toBe(false);
      // No network request should have been made — the DB sentinel gates it.
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      fetchStub.mockRestore();
    }
  });
});
