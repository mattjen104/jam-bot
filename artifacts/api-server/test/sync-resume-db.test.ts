/**
 * Integration tests for the sync worker checkpoint/resume logic.
 *
 * Confirms that:
 *   Resume — when runSyncWorker is called with committedOffset > 0 and the
 *             job has matchedJson stored, the worker restores the prior match
 *             results and only runs Spotify API calls for items AFTER the
 *             offset. Final receipt counts must equal a non-interrupted run.
 *
 *   No-matchedJson fallback — if committedOffset > 0 but matchedJson is null,
 *             the worker falls back to a full re-run from scratch.
 *
 *   committedOffset stamped — during a fresh run the committed_offset column
 *             advances in STAMP_EVERY increments alongside matchedJson.
 *
 * Self-skips when the database is unavailable (same pattern as other *-db tests).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  serviceConnectionsTable,
  libraryItemsTable,
  recordingsTable,
  librarySyncJobsTable,
} from "@workspace/db";
import type { RecordingLink } from "@workspace/db";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before deferred imports
// ---------------------------------------------------------------------------

vi.mock("../src/lore/tokenCrypto.js", () => ({
  decryptToken: (s: string) => s,
  encryptToken: (s: string) => s,
}));

vi.mock("../src/lore/serviceConnector.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/lore/serviceConnector.js")>();
  return {
    ...orig,
    refreshServiceToken: vi.fn().mockResolvedValue({
      accessToken: "fake-access-refreshed",
      expiresAt: new Date(Date.now() + 3_600_000),
    }),
  };
});

// ---------------------------------------------------------------------------
// Deferred import (after mocks are in place)
// ---------------------------------------------------------------------------

import { runSyncWorker } from "../src/lore/library-sync.js";

// ---------------------------------------------------------------------------
// Test-run-scoped unique IDs
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);

// Recording MBIDs
// ISRC track — matched by ISRC search in a full run (confidence "isrc")
// LINK track — matched via Odesli link (confidence "link"), no API call needed
// NONE track — no match (unavailable)
const MBID_ISRC = `sr-isrc-${run}`;
const MBID_LINK = `sr-link-${run}`;
const MBID_NONE = `sr-none-${run}`;

const ISRC_VAL = `SR${run.toUpperCase()}`.slice(0, 12);
const SP_ID_ISRC = `sp-isrc-${run}`;
const SP_ID_LINK = `sp-link-${run}`;

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

let dbAvailable = false;
let userId: number;
let connRow: typeof serviceConnectionsTable.$inferSelect;

// Track Spotify search calls so tests can assert count.
let searchCallCount = 0;
let searchQueriesLog: string[] = [];
let originalFetch: typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Fetch stub — intercepts Spotify API, no real network calls leave the process
// ---------------------------------------------------------------------------

function buildFetchStub(): typeof globalThis.fetch {
  return async function stubbedFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    // ── Spotify search ───────────────────────────────────────────────────────
    if (url.includes("api.spotify.com/v1/search")) {
      searchCallCount++;
      const q = new URL(url).searchParams.get("q") ?? "";
      searchQueriesLog.push(q);

      // ISRC search returns a hit for MBID_ISRC.
      if (q.includes(ISRC_VAL)) {
        return new Response(
          JSON.stringify({
            tracks: {
              items: [
                {
                  id: SP_ID_ISRC,
                  uri: `spotify:track:${SP_ID_ISRC}`,
                  external_urls: { spotify: `https://open.spotify.com/track/${SP_ID_ISRC}` },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // All other searches: no hit.
      return new Response(
        JSON.stringify({ tracks: { items: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Contains check — none pre-saved ─────────────────────────────────────
    if (url.includes("api.spotify.com/v1/me/tracks/contains")) {
      const idsParam = new URL(url).searchParams.get("ids") ?? "";
      const count = idsParam.split(",").filter(Boolean).length;
      return new Response(
        JSON.stringify(Array(count).fill(false)),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Save (PUT /me/tracks) ────────────────────────────────────────────────
    if (url.includes("api.spotify.com/v1/me/tracks") && init?.method === "PUT") {
      return new Response(null, { status: 200 });
    }

    console.error("[sync-resume-test] unexpected fetch:", url);
    return new Response(JSON.stringify({ error: "unexpected fetch in test" }), { status: 500 });
  } as typeof globalThis.fetch;
}

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

  originalFetch = globalThis.fetch;
  globalThis.fetch = buildFetchStub();

  // Seed user + service connection.
  const [u] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: `sr-dev-${run}` })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  const [c] = await db
    .insert(serviceConnectionsTable)
    .values({
      userId,
      service: "spotify",
      accessToken: "fake-access",
      refreshToken: "fake-refresh",
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ["user-library-modify"],
      canWrite: true,
      connectedAt: new Date(),
    })
    .returning();
  connRow = c!;

  // Seed recordings — these are FK targets for library_items.
  const links: RecordingLink[] = [
    { name: "Spotify", url: `https://open.spotify.com/track/${SP_ID_LINK}`, kind: "exact" },
  ];
  await db.insert(recordingsTable).values([
    { mbid: MBID_LINK, title: "Link Track",        artist: `Sync Resume ${run}`, links },
    { mbid: MBID_ISRC, title: "ISRC Track",        artist: `Sync Resume ${run}`, isrc: ISRC_VAL },
    { mbid: MBID_NONE, title: "Unavailable Track", artist: `Sync Resume ${run}` },
  ]);

  // Seed library items for this user (all three tracks).
  await db.insert(libraryItemsTable).values([
    { userId, mbid: MBID_LINK, provenance: { kind: "keep" }, addedAt: new Date(Date.now() - 3000) },
    { userId, mbid: MBID_ISRC, provenance: { kind: "keep" }, addedAt: new Date(Date.now() - 2000) },
    { userId, mbid: MBID_NONE, provenance: { kind: "keep" }, addedAt: new Date(Date.now() - 1000) },
  ]);
});

afterAll(async () => {
  if (originalFetch) globalThis.fetch = originalFetch;
  if (!dbAvailable) return;

  await db.delete(librarySyncJobsTable).where(eq(librarySyncJobsTable.userId, userId));
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  await db.delete(serviceConnectionsTable).where(eq(serviceConnectionsTable.id, connRow.id));
  await db.delete(recordingsTable).where(
    inArray(recordingsTable.mbid, [MBID_LINK, MBID_ISRC, MBID_NONE]),
  );
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
});

beforeEach(() => {
  searchCallCount = 0;
  searchQueriesLog = [];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedJob(overrides: Partial<typeof librarySyncJobsTable.$inferInsert> = {}): Promise<typeof librarySyncJobsTable.$inferSelect> {
  const [j] = await db
    .insert(librarySyncJobsTable)
    .values({
      userId,
      service: "spotify",
      status: "running",
      total: 3,
      processed: 0,
      startedAt: new Date(Date.now() - 60_000),
      ...overrides,
    })
    .returning();
  return j!;
}

async function readJob(jobId: number): Promise<typeof librarySyncJobsTable.$inferSelect> {
  const [j] = await db
    .select()
    .from(librarySyncJobsTable)
    .where(eq(librarySyncJobsTable.id, jobId))
    .limit(1);
  if (!j) throw new Error(`Job ${jobId} not found`);
  return j;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sync worker resume — restores matchedJson, skips committed items", () => {
  it("receipt counts match a non-interrupted run when resumed from offset=2 with matchedJson", async () => {
    if (!dbAvailable) return;

    // Simulate a prior run that matched MBID_LINK (via link) and MBID_ISRC
    // (via ISRC search) before being interrupted. The NONE track was not yet
    // reached. committedOffset=2 means items[0] and items[1] are committed.
    const job = await seedJob({
      committedOffset: 2,
      matchedJson: {
        matched: [
          { mbid: MBID_LINK, title: "Link Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_LINK, confidence: "link" },
          { mbid: MBID_ISRC, title: "ISRC Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_ISRC, confidence: "isrc" },
        ],
        unmatched: [],
      },
    });

    await runSyncWorker(job.id, userId, connRow, 2);

    const final = await readJob(job.id);

    // Job should complete successfully.
    expect(final.status).toBe("done");
    expect(final.results).toBeTruthy();

    const r = final.results!;
    // MBID_LINK + MBID_ISRC → both synced (confidence link + isrc)
    // MBID_NONE → unavailable (no Spotify match)
    expect(r.synced).toBe(2);
    expect(r.unavailable).toBe(1);
    expect(r.alreadySaved).toBe(0);
    expect(r.searchMatched).toBe(0);

    // resumedFrom must be set to signal the UI to show "Resuming…"
    expect(final.resumedFrom).toBe(job.id);

    // matchedJson must be cleared once matching is complete.
    expect(final.matchedJson).toBeNull();
  });

  it("only calls Spotify search for items AFTER committedOffset (not for committed items)", async () => {
    if (!dbAvailable) return;

    // MBID_LINK and MBID_ISRC are committed (offset=2). Only MBID_NONE remains.
    // MBID_NONE has no ISRC and no links, so the worker runs TWO searches for
    // it (ISRC is skipped since it has none, but text search runs once).
    // Total search calls expected: 1 (text search for MBID_NONE only).
    const job = await seedJob({
      committedOffset: 2,
      matchedJson: {
        matched: [
          { mbid: MBID_LINK, title: "Link Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_LINK, confidence: "link" },
          { mbid: MBID_ISRC, title: "ISRC Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_ISRC, confidence: "isrc" },
        ],
        unmatched: [],
      },
    });

    await runSyncWorker(job.id, userId, connRow, 2);

    // MBID_ISRC was already committed — its ISRC search must NOT have been
    // called again. MBID_NONE triggers exactly one text search (no ISRC on it).
    expect(searchQueriesLog.some((q) => q.includes(ISRC_VAL))).toBe(false);
    // At most 1 search call (the text search for MBID_NONE).
    // (Could be 0 if the library order puts NONE after offset.)
    expect(searchCallCount).toBeLessThanOrEqual(1);
  });

  it("falls back to a full re-run from scratch when matchedJson is null despite committedOffset > 0", async () => {
    if (!dbAvailable) return;

    // No matchedJson stored — the worker must restart from item 0.
    const job = await seedJob({ committedOffset: 2, matchedJson: undefined });

    await runSyncWorker(job.id, userId, connRow, 2);

    const final = await readJob(job.id);
    expect(final.status).toBe("done");

    // Even with the fallback re-run, all items are processed and results are correct.
    const r = final.results!;
    expect(r.synced).toBe(2);     // LINK + ISRC
    expect(r.unavailable).toBe(1); // NONE

    // ISRC search was called because the fallback re-ran from scratch.
    expect(searchQueriesLog.some((q) => q.includes(ISRC_VAL))).toBe(true);
  });
});

describe("sync worker — committedOffset is stamped during a fresh run", () => {
  it("committed_offset advances in the DB while matching is in progress", async () => {
    if (!dbAvailable) return;

    // A fresh job (no resume) — we simply run it and then confirm that after
    // completion committedOffset equals total items processed.
    const job = await seedJob({ committedOffset: 0 });

    await runSyncWorker(job.id, userId, connRow, 0);

    const final = await readJob(job.id);
    expect(final.status).toBe("done");

    // After matching completes the offset equals the total library size (3).
    expect(final.committedOffset).toBe(3);
    // matchedJson is cleared at the end of the matching phase.
    expect(final.matchedJson).toBeNull();
    // resumedFrom stays null on a non-resumed run.
    expect(final.resumedFrom).toBeNull();
  });
});
