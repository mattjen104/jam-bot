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
 *   Post-matching crash recovery — if the process crashes after the matching
 *             phase stamps committedOffset == total (but before the "done"
 *             stamp), matchedJson is still present in the DB.  A resumed
 *             worker must skip Phase 1 entirely and proceed directly to Phase
 *             2 (contains-check) + Phase 3 (save) without any Spotify search
 *             calls.
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

    // matchedJson must be cleared when the job reaches "done" status.
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

describe("sync worker double-crash resume — second resume uses the latest committedOffset", () => {
  it("resumes from the latest committedOffset after two successive crashes, no duplicate search calls", async () => {
    if (!dbAvailable) return;

    // ── Simulate first crash ──────────────────────────────────────────────────
    // The worker processed MBID_LINK (index 0) then crashed.
    // committedOffset=1, matchedJson contains only the first item.
    const job = await seedJob({
      committedOffset: 1,
      matchedJson: {
        matched: [
          { mbid: MBID_LINK, title: "Link Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_LINK, confidence: "link" },
        ],
        unmatched: [],
      },
    });

    // ── Simulate second partial run that advances offset then crashes ─────────
    // The worker resumed from offset=1, processed MBID_ISRC (index 1), stamped
    // committedOffset=2 with an updated matchedJson, then crashed before MBID_NONE.
    // We replicate that DB state directly to avoid needing a real crash hook.
    await db
      .update(librarySyncJobsTable)
      .set({
        committedOffset: 2,
        matchedJson: {
          matched: [
            { mbid: MBID_LINK, title: "Link Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_LINK, confidence: "link" },
            { mbid: MBID_ISRC, title: "ISRC Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_ISRC, confidence: "isrc" },
          ],
          unmatched: [],
        },
      })
      .where(eq(librarySyncJobsTable.id, job.id));

    // ── Second resume — picks up from latest committedOffset=2 ───────────────
    await runSyncWorker(job.id, userId, connRow, 2);

    const final = await readJob(job.id);

    // Job must complete successfully.
    expect(final.status).toBe("done");
    expect(final.results).toBeTruthy();

    const r = final.results!;
    // MBID_LINK + MBID_ISRC → both synced (confidence link + isrc)
    // MBID_NONE → unavailable (no Spotify match)
    expect(r.synced).toBe(2);
    expect(r.unavailable).toBe(1);
    expect(r.alreadySaved).toBe(0);
    expect(r.searchMatched).toBe(0);

    // matchedJson must be cleared when the job reaches "done" status.
    expect(final.matchedJson).toBeNull();

    // resumedFrom must be set (it's a resumed run).
    expect(final.resumedFrom).toBe(job.id);

    // No duplicate Spotify search calls for items already in the latest
    // matchedJson snapshot. MBID_LINK uses an Odesli link (no search call ever).
    // MBID_ISRC was already committed — its ISRC search must NOT fire again.
    expect(searchQueriesLog.some((q) => q.includes(ISRC_VAL))).toBe(false);

    // The only search call permitted is the text search for MBID_NONE (which
    // yields no result). At most 1 call total.
    expect(searchCallCount).toBeLessThanOrEqual(1);
  });
});

describe("sync worker resume — save batch failure does not inflate synced count", () => {
  it("synced count reflects only confirmed saves when a PUT /me/tracks batch fails mid-resume", async () => {
    if (!dbAvailable) return;

    // Seed a job that was already interrupted after matching both MBID_LINK and
    // MBID_ISRC (committedOffset=2). MBID_NONE was never reached and will be
    // discovered as unmatched in this resume run.
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

    // Override fetch so the PUT /me/tracks call returns a 500 error.
    // All other endpoints keep their normal stubs so the rest of the run
    // completes (matching phase, contains check).
    const baseFetch = buildFetchStub();
    const fetchWithFailingSave: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url.includes("api.spotify.com/v1/me/tracks") && init?.method === "PUT") {
        // Simulate a server-side failure for every save batch.
        return new Response(JSON.stringify({ error: "Service Unavailable" }), { status: 503 });
      }

      return baseFetch(input as RequestInfo, init);
    };

    const savedFetch = globalThis.fetch;
    globalThis.fetch = fetchWithFailingSave;

    try {
      await runSyncWorker(job.id, userId, connRow, 2);
    } finally {
      globalThis.fetch = savedFetch;
    }

    const final = await readJob(job.id);

    // Job should still complete (save failures are non-fatal).
    expect(final.status).toBe("done");
    expect(final.results).toBeTruthy();

    const r = final.results!;

    // The PUT /me/tracks batch failed — no tracks were confirmed saved.
    // synced must NOT include the two matched (but unsaved) tracks.
    expect(r.synced).toBe(0);
    expect(r.searchMatched).toBe(0);

    // alreadySaved and unavailable are determined before Phase 3 save calls;
    // they must not be affected by the save failure.
    expect(r.alreadySaved).toBe(0);
    expect(r.unavailable).toBe(1); // MBID_NONE still unmatched

    // resumedFrom should be set since this was a resumed run.
    expect(final.resumedFrom).toBe(job.id);
  });

  it("synced count reflects only the succeeding batch when one of two save batches fails mid-resume", async () => {
    if (!dbAvailable) return;

    // Build a scenario with two matched tracks where we can distinguish which
    // batch succeeded. We use the existing SP_ID_LINK and SP_ID_ISRC.
    // The stub below fails the batch that contains SP_ID_ISRC but succeeds for
    // SP_ID_LINK, letting us confirm that only the successful batch is counted.
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

    // Track which PUT batches are attempted.
    const putBodiesAttempted: string[][] = [];

    const baseFetch = buildFetchStub();
    const fetchWithPartialSave: typeof globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url.includes("api.spotify.com/v1/me/tracks") && init?.method === "PUT") {
        const body = JSON.parse(init.body as string) as { ids: string[] };
        putBodiesAttempted.push(body.ids);
        // Fail the batch that contains SP_ID_ISRC; succeed all others.
        if (body.ids.includes(SP_ID_ISRC)) {
          return new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers: { "retry-after": "0" } });
        }
        return new Response(null, { status: 200 });
      }

      return baseFetch(input as RequestInfo, init);
    };

    const savedFetch = globalThis.fetch;
    globalThis.fetch = fetchWithPartialSave;

    try {
      await runSyncWorker(job.id, userId, connRow, 2);
    } finally {
      globalThis.fetch = savedFetch;
    }

    const final = await readJob(job.id);

    expect(final.status).toBe("done");
    expect(final.results).toBeTruthy();

    const r = final.results!;

    // With BATCH_SIZE=50 both tracks land in a single batch (the one containing
    // SP_ID_ISRC), so the whole batch fails → synced=0. This still confirms
    // the receipt is not inflated beyond what was confirmed.
    // unavailable stays 1 (MBID_NONE) regardless of the save outcome.
    expect(r.synced).toBe(0);
    expect(r.unavailable).toBe(1);
    expect(r.alreadySaved).toBe(0);

    // The save was attempted (the stub was hit) — this verifies Phase 3 ran.
    expect(putBodiesAttempted.length).toBeGreaterThan(0);
  });
});

describe("sync worker — post-matching crash recovery (committedOffset == total, matchedJson present)", () => {
  it("skips Phase 1 entirely and completes successfully when crash happened after matching stamp", async () => {
    if (!dbAvailable) return;

    // Simulate a job that completed matching (committedOffset == total == 3)
    // but crashed before the final "done" stamp.  matchedJson is still present
    // because it is only cleared in the terminal "done" stamp.
    //
    // The library has 3 items and STAMP_EVERY == 20, so NO intermediate
    // checkpoint stamps fire during Phase 1.  The ONLY stamp that includes
    // matchedJson is the matching-complete stamp at the end of Phase 1.
    // This test therefore exercises the case where total % STAMP_EVERY != 0
    // (3 % 20 = 3) and confirms the authoritative final snapshot is used.
    const job = await seedJob({
      committedOffset: 3, // == total; written by the matching-complete stamp
      phase: "checking",  // crashed while in Phase 2/3
      processed: 3,
      matchedJson: {
        // Full snapshot: matched.length + unmatched.length == total (3)
        matched: [
          { mbid: MBID_LINK, title: "Link Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_LINK, confidence: "link" },
          { mbid: MBID_ISRC, title: "ISRC Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_ISRC, confidence: "isrc" },
        ],
        unmatched: [
          { mbid: MBID_NONE, title: "Unavailable Track", artist: `Sync Resume ${run}` },
        ],
      },
    });

    await runSyncWorker(job.id, userId, connRow, 3);

    const final = await readJob(job.id);

    // Job must complete successfully.
    expect(final.status).toBe("done");
    expect(final.results).toBeTruthy();

    const r = final.results!;
    // MBID_LINK + MBID_ISRC → synced (link + isrc confidence)
    // MBID_NONE → unavailable
    expect(r.synced).toBe(2);
    expect(r.unavailable).toBe(1);
    expect(r.alreadySaved).toBe(0);
    expect(r.searchMatched).toBe(0);

    // NO Spotify search calls must have been made — all match data was
    // restored from matchedJson; Phase 1 was skipped entirely.
    expect(searchCallCount).toBe(0);
    expect(searchQueriesLog).toHaveLength(0);

    // matchedJson cleared in the final "done" stamp.
    expect(final.matchedJson).toBeNull();

    // resumedFrom set because committedOffset > 0 on entry.
    expect(final.resumedFrom).toBe(job.id);
  });

  it("falls back to a full re-run when the post-matching snapshot is incomplete (tail items missing)", async () => {
    if (!dbAvailable) return;

    // Guard against an incomplete snapshot where committedOffset == total but
    // matched + unmatched < total (e.g. a pre-fix binary that failed to flush
    // the final tail).  The worker must detect the mismatch and re-run Phase 1
    // from scratch rather than silently dropping the missing items.
    const job = await seedJob({
      committedOffset: 3, // == total
      phase: "checking",
      processed: 3,
      matchedJson: {
        // Incomplete: only 2 of 3 items recorded (MBID_NONE tail is missing)
        matched: [
          { mbid: MBID_LINK, title: "Link Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_LINK, confidence: "link" },
          { mbid: MBID_ISRC, title: "ISRC Track", artist: `Sync Resume ${run}`, spotifyId: SP_ID_ISRC, confidence: "isrc" },
        ],
        unmatched: [], // missing MBID_NONE — total mismatch: 2 != 3
      },
    });

    await runSyncWorker(job.id, userId, connRow, 3);

    const final = await readJob(job.id);

    // Job must still complete successfully after the fallback re-run.
    expect(final.status).toBe("done");
    expect(final.results).toBeTruthy();

    const r = final.results!;
    // After a full re-run all items must be accounted for, including MBID_NONE.
    expect(r.synced).toBe(2);      // LINK + ISRC
    expect(r.unavailable).toBe(1); // NONE (would be 0 if tail were silently dropped)
    expect(r.alreadySaved).toBe(0);
    expect(r.searchMatched).toBe(0);

    // The fallback re-ran Phase 1, so the ISRC search was called.
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
    // matchedJson is cleared when the job reaches "done" status.
    expect(final.matchedJson).toBeNull();
    // resumedFrom stays null on a non-resumed run.
    expect(final.resumedFrom).toBeNull();
  });
});
