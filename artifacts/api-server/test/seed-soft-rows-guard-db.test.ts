/**
 * Integration tests: seedSpotifySoftRows duplicate-guard
 *
 * Confirms that:
 *   1. When a real-Spotify-ID row (22-char alphanumeric spotifyId) already
 *      exists in spotify_library_items for a given user+artist+title,
 *      seedSpotifySoftRows skips inserting a synthesised-key soft row for
 *      the same track — leaving exactly one row behind.
 *
 *   2. When no real-ID row exists yet, seedSpotifySoftRows DOES insert the
 *      synthesised-key row.
 *
 * Self-skips when no real DB is available or when the spotify_library_items
 * table is not present in the schema (matches the pattern in
 * phase3-promote-db.test.ts).
 */

// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyLibraryItemsTable,
} from "@workspace/db";

// ── Module mocks (same boilerplate as the other me-router db tests) ───────────

vi.mock("../src/lore/tokenCrypto.js", () => ({
  decryptToken: (s: string) => s,
  encryptToken: (s: string) => s,
}));

vi.mock("../src/lore/serviceConnector.js", () => ({
  getConnector: vi.fn().mockReturnValue({ importLibrary: vi.fn() }),
  getFreshServiceToken: vi.fn(),
  refreshServiceToken: vi.fn(),
}));

vi.mock("../src/lore/resolve.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/lore/resolve.js")>();
  return { ...orig, resolveToMbid: vi.fn() };
});

vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...orig,
    createMbResolver: vi.fn().mockReturnValue({
      resolveByIsrc: vi.fn(),
      resolveByText: vi.fn(),
    }),
  };
});

vi.mock("../src/lore/userSession.js", () => ({
  getUserFromSession: vi.fn(),
  sidFromRequest: vi.fn(),
  upsertLoreUserForSid: vi.fn(),
}));
vi.mock("../src/lore/spotifyConnect.js", () => ({
  fetchProfile: vi.fn(),
  resolveSpotifyTrack: vi.fn(),
  trackIdFromUri: vi.fn(),
}));
vi.mock("../src/lore/for-you.js", () => ({
  getForYouStations: vi.fn(),
  getForYouBlogs: vi.fn(),
}));

// ── Deferred import (after mocks are registered) ──────────────────────────────

import { seedSpotifySoftRows } from "../src/routes/me/index.js";

// ── Test-run isolation ────────────────────────────────────────────────────────

const run = randomUUID().slice(0, 8);

// A valid 22-char alphanumeric Spotify track ID (real ID).
const REAL_SPOTIFY_ID = `SpotifyRealId${run}`.slice(0, 22).padEnd(22, "A");

// Synthesised fallback key format: "artist\u001ftitle" — never 22 alphanumeric chars.
const ARTIST = `SoftGuardArtist ${run}`;
const TITLE  = `SoftGuardTitle ${run}`;
const SYNTH_KEY = `${ARTIST}\u001f${TITLE}`;

let dbAvailable = false;
let softTableAvailable = false;

let userId: number;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  try {
    await db.execute(sql`select 1 from spotify_library_items limit 0`);
    softTableAvailable = true;
  } catch {
    softTableAvailable = false;
    return;
  }

  const [u] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: randomUUID() })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;
});

afterAll(async () => {
  if (!dbAvailable || !softTableAvailable) return;
  await db
    .delete(spotifyLibraryItemsTable)
    .where(eq(spotifyLibraryItemsTable.userId, userId));
  await db
    .delete(loreUsersTable)
    .where(eq(loreUsersTable.id, userId));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("seedSpotifySoftRows — synthesised-key duplicate guard", () => {
  it(
    "skips inserting a synthesised-key row when a real-Spotify-ID row already exists for the same user+artist+title",
    async () => {
      if (!dbAvailable || !softTableAvailable) return;

      // Pre-seed a row with a real 22-char Spotify ID for this user+artist+title.
      await db
        .insert(spotifyLibraryItemsTable)
        .values({
          userId,
          spotifyId: REAL_SPOTIFY_ID,
          title: TITLE,
          artist: ARTIST,
          addedAt: new Date(),
          mbid: null,
        })
        .onConflictDoNothing();

      // Now call seedSpotifySoftRows with a synthesised-key entry for the same track.
      await seedSpotifySoftRows(userId, "fake-token", [
        { artist: ARTIST, title: TITLE, externalId: SYNTH_KEY },
      ]);

      // Only one row should exist — the original real-ID row.
      const rows = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.artist, ARTIST),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.spotifyId).toBe(REAL_SPOTIFY_ID);

      // Clean up for the next test.
      await db
        .delete(spotifyLibraryItemsTable)
        .where(eq(spotifyLibraryItemsTable.userId, userId));
    },
    15_000,
  );

  it(
    "inserts a synthesised-key row when no real-Spotify-ID row exists yet for the same user+artist+title",
    async () => {
      if (!dbAvailable || !softTableAvailable) return;

      // Confirm the table is clean for this user before the test.
      const before = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(eq(spotifyLibraryItemsTable.userId, userId));
      expect(before).toHaveLength(0);

      // Call seedSpotifySoftRows with a synthesised-key entry — no real-ID row exists.
      await seedSpotifySoftRows(userId, "fake-token", [
        { artist: ARTIST, title: TITLE, externalId: SYNTH_KEY },
      ]);

      const rows = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.artist, ARTIST),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.spotifyId).toBe(SYNTH_KEY);
    },
    15_000,
  );
});
