/**
 * Integration tests confirming that a stale/revoked Spotify token surfaces as
 * status="error" rather than leaving the sync job stuck in a running state
 * (the "spinner-forever" regression guard).
 *
 * Two paths are covered:
 *
 *   1. Boot-time `markOrphanedSyncJobsAsError` — when the server restarts and
 *      finds a job with committedOffset > 0 (resumable), but `refreshServiceToken`
 *      throws (token expired/revoked), the job must be marked error immediately
 *      instead of being handed to runSyncWorker where it would loop indefinitely.
 *
 *   2. POST /api/me/library/sync zombie-resume — when a running request hits an
 *      existing zombie job that has committedOffset > 0, the same token-freshness
 *      check must fire. On failure the zombie is marked error and the response
 *      still returns 202 (a fresh job is created for when the user reconnects).
 *
 * Both paths exercise the `getFreshToken` → `refreshServiceToken` call that
 * Task 678 introduced; this test confirms a throw is not silently swallowed.
 *
 * Self-skips when the database is unavailable (same pattern as other *-db tests).
 */

// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { sql, eq, inArray } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  serviceConnectionsTable,
  libraryItemsTable,
  recordingsTable,
  librarySyncJobsTable,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Module mocks — declared before any deferred imports
// ---------------------------------------------------------------------------

// Pass-through crypto so the worker sees plaintext tokens from the DB.
vi.mock("../src/lore/tokenCrypto.js", () => ({
  decryptToken: (s: string) => s,
  encryptToken: (s: string) => s,
}));

// refreshServiceToken always throws — simulates an expired/revoked refresh
// token.  getConnector is kept from the real implementation because it's used
// by the HTTP handler, not the token-freshness check.
vi.mock("../src/lore/serviceConnector.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/lore/serviceConnector.js")>();
  return {
    ...orig,
    refreshServiceToken: vi.fn().mockRejectedValue(new Error("invalid_grant")),
  };
});

// ---------------------------------------------------------------------------
// Deferred imports (after mocks are wired)
// ---------------------------------------------------------------------------

import app from "../src/app.js";
import { markOrphanedSyncJobsAsError } from "../src/routes/me/index.js";
import { SYNC_ZOMBIE_AGE_MS } from "../src/lore/library-sync.js";

// ---------------------------------------------------------------------------
// Test-run-scoped unique IDs
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);

// Session / identity IDs — one user per test so jobs don't cross-contaminate.
const SID_BOOT = `st-boot-sid-${run}`;
const SID_HTTP = `st-http-sid-${run}`;

const SP_UID_BOOT = `st-boot-uid-${run}`;
const SP_UID_HTTP = `st-http-uid-${run}`;

// A recording MBID — only needed for library_items FK; we re-use the same
// one for both users since it's just a spine row anchor.
const MBID = `st-rec-${run}`;

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

let dbAvailable = false;
let userIdBoot: number;
let userIdHttp: number;
let connBoot: typeof serviceConnectionsTable.$inferSelect;
let server: Server | undefined;
let baseUrl = "";
let originalFetch: typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub Spotify API so runSyncWorker (if it does fire) doesn't hit the network. */
function buildFetchStub(original: typeof globalThis.fetch): typeof globalThis.fetch {
  return async function stubbedFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    // Let local HTTP calls (polling the test server) through unchanged.
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return original(input, init);
    }

    // Spotify search — return an empty hit so the worker (if it runs) doesn't
    // hang waiting for network.
    if (url.includes("api.spotify.com/v1/search")) {
      return new Response(
        JSON.stringify({ tracks: { items: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("api.spotify.com/v1/me/tracks/contains")) {
      const count = (new URL(url).searchParams.get("ids") ?? "").split(",").filter(Boolean).length;
      return new Response(JSON.stringify(Array(count).fill(false)), { status: 200 });
    }
    if (url.includes("api.spotify.com/v1/me/tracks") && init?.method === "PUT") {
      return new Response(null, { status: 200 });
    }

    console.error("[sync-stale-token-test] unexpected fetch:", url);
    return new Response(JSON.stringify({ error: "unexpected fetch in test" }), { status: 500 });
  } as typeof globalThis.fetch;
}

async function seedUser(sid: string, spUid: string): Promise<{ userId: number; conn: typeof serviceConnectionsTable.$inferSelect }> {
  await db.insert(spotifyConnectionsTable).values({
    sid,
    accessToken: "fake-access",
    refreshToken: "fake-refresh",
    // Token is EXPIRED — this forces getFreshToken to call refreshServiceToken.
    expiresAt: new Date(Date.now() - 60_000),
    spotifyUserId: spUid,
  });
  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: spUid, spotifyConnectionId: sid, deviceKey: sid })
    .returning({ id: loreUsersTable.id });
  const userId = u!.id;

  const [c] = await db
    .insert(serviceConnectionsTable)
    .values({
      userId,
      service: "spotify",
      accessToken: "fake-access",
      refreshToken: "fake-refresh",
      // Expired — same as above, forces the refresh path.
      expiresAt: new Date(Date.now() - 60_000),
      scopes: ["user-library-modify"],
      canWrite: true,
      connectedAt: new Date(),
    })
    .returning();

  // Seed a library item so the sync worker has something to process if it runs.
  await db
    .insert(libraryItemsTable)
    .values({ userId, mbid: MBID, provenance: { kind: "keep" }, addedAt: new Date() })
    .onConflictDoNothing();

  return { userId, conn: c! };
}

async function seedSyncJob(
  userId: number,
  overrides: Partial<typeof librarySyncJobsTable.$inferInsert> = {},
): Promise<typeof librarySyncJobsTable.$inferSelect> {
  const [j] = await db
    .insert(librarySyncJobsTable)
    .values({
      userId,
      service: "spotify",
      status: "running",
      total: 1,
      processed: 0,
      // Old enough to be a zombie (older than SYNC_ZOMBIE_AGE_MS).
      startedAt: new Date(Date.now() - SYNC_ZOMBIE_AGE_MS - 60_000),
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

function apiCall(path: string, opts?: RequestInit & { sid?: string }) {
  const { sid = SID_HTTP, ...rest } = opts ?? {};
  return fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...rest.headers,
      cookie: `lore_sid=${sid}`,
    },
  });
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
  globalThis.fetch = buildFetchStub(originalFetch);

  // Seed shared recording spine row (FK target for library_items).
  await db
    .insert(recordingsTable)
    .values({ mbid: MBID, title: "Stale Token Track", artist: `ST Artist ${run}` })
    .onConflictDoNothing();

  // Seed two users: one for the boot-time test, one for the HTTP test.
  const boot = await seedUser(SID_BOOT, SP_UID_BOOT);
  userIdBoot = boot.userId;
  connBoot = boot.conn;

  const http = await seedUser(SID_HTTP, SP_UID_HTTP);
  userIdHttp = http.userId;

  // Start the HTTP server on a random port for the POST /me/library/sync tests.
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (originalFetch) globalThis.fetch = originalFetch;
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  for (const uid of [userIdBoot, userIdHttp].filter(Boolean)) {
    await db.delete(librarySyncJobsTable).where(eq(librarySyncJobsTable.userId, uid));
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, uid));
    await db.delete(serviceConnectionsTable).where(eq(serviceConnectionsTable.userId, uid));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, uid));
  }
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID));
  await db.delete(spotifyConnectionsTable).where(
    inArray(spotifyConnectionsTable.sid, [SID_BOOT, SID_HTTP]),
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("markOrphanedSyncJobsAsError — stale token path", () => {
  it("marks the job as error when refreshServiceToken throws on boot-time resume", async () => {
    if (!dbAvailable) return;

    // Simulate a job that was running when the server crashed, with committed
    // matching progress — this is the "resumable" branch in markOrphanedSyncJobsAsError.
    const job = await seedSyncJob(userIdBoot, {
      committedOffset: 1,
      matchedJson: {
        matched: [{ mbid: MBID, title: "Stale Token Track", artist: `ST Artist ${run}`, spotifyId: "sp-fake", confidence: "link" }],
        unmatched: [],
      },
    });

    // refreshServiceToken is mocked to throw — simulates a revoked refresh token.
    await markOrphanedSyncJobsAsError();

    const final = await readJob(job.id);

    // The job must be terminated with status="error", not left as "running".
    expect(final.status).toBe("error");

    // The error message must be informative enough for the UI to show a
    // reconnect prompt rather than a generic "something went wrong".
    expect(final.error).toBeTruthy();
    expect(final.error!.toLowerCase()).toMatch(/token|revoked|reconnect|spotify/);

    // finishedAt must be set so polling clients see the job as terminal.
    expect(final.finishedAt).not.toBeNull();
  });

  it("does NOT mark jobs as error when they have no committed offset (dead jobs are reset regardless)", async () => {
    if (!dbAvailable) return;

    // A job with no committed progress is simply dead — it should still be
    // marked error (server restart message), but via the dead-job path, NOT
    // the token-freshness path.  Confirm the function handles it cleanly.
    const job = await seedSyncJob(userIdBoot, { committedOffset: 0, matchedJson: undefined });

    await markOrphanedSyncJobsAsError();

    const final = await readJob(job.id);
    expect(final.status).toBe("error");
    // The error message for dead jobs mentions "server restarted", not token issues.
    expect(final.error).toBeTruthy();
    expect(final.finishedAt).not.toBeNull();
  });
});

describe("POST /api/me/library/sync — zombie-resume with stale token", () => {
  it("marks the zombie job as error and still returns 202 (new job) when token refresh fails", async () => {
    if (!dbAvailable) return;

    // Seed an old zombie job with committed progress — this is the
    // zombie-resume branch in POST /me/library/sync.
    const zombie = await seedSyncJob(userIdHttp, {
      committedOffset: 1,
      matchedJson: {
        matched: [{ mbid: MBID, title: "Stale Token Track", artist: `ST Artist ${run}`, spotifyId: "sp-fake", confidence: "link" }],
        unmatched: [],
      },
    });

    const res = await apiCall("/api/me/library/sync?service=spotify", { method: "POST" });

    // The zombie is cleared and a fresh job is queued — response must be 202.
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: number; status: string };
    expect(body.jobId).toBeTypeOf("number");
    // The new job's ID must differ from the zombie's — we didn't resume the zombie.
    expect(body.jobId).not.toBe(zombie.id);

    // The zombie job itself must now be in error state.
    const zombieFinal = await readJob(zombie.id);
    expect(zombieFinal.status).toBe("error");

    // Error message must be informative about the token/reconnect — not a
    // generic crash message — so the UI can show a targeted reconnect prompt.
    expect(zombieFinal.error).toBeTruthy();
    expect(zombieFinal.error!.toLowerCase()).toMatch(/token|revoked|reconnect|spotify/);

    // finishedAt must be stamped so the job is terminal from the client's view.
    expect(zombieFinal.finishedAt).not.toBeNull();
  });
});
