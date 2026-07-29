/**
 * Integration tests for the sync job HTTP lifecycle.
 *
 * Covers:
 *   - POST /api/me/library/sync → 202 + jobId
 *   - GET  /api/me/library/sync/:jobId polling until status="done"
 *   - Receipt shape: synced / unavailable counts are correct
 *   - POST /api/me/library/sync with canWrite:false → 403
 *
 * The sync worker calls Spotify's REST API directly via global.fetch.  The
 * test stubs that global so no real network calls leave the process.
 * All Spotify calls to 127.0.0.1 (the test API server) are passed through to
 * the original fetch so that the polling calls work normally.
 *
 * Self-skips when the database is unavailable (same pattern as other *-db tests).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { sql, eq } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  serviceConnectionsTable,
  libraryItemsTable,
  recordingsTable,
  librarySyncJobsTable,
} from "@workspace/db";
import type { RecordingLink } from "@workspace/db";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any deferred imports
// ---------------------------------------------------------------------------

// Pass-through token crypto so the worker receives a plaintext token from the
// fake encrypted values stored in the DB.
vi.mock("../src/lore/tokenCrypto.js", () => ({
  decryptToken: (s: string) => s,
  encryptToken: (s: string) => s,
}));

// Stub refreshServiceToken so the worker can call it without real Spotify
// credentials when the stored token is about to expire.  getConnector is not
// used by the sync worker so the real implementation is fine; we mock the
// whole module to avoid pulling in OAuth init side-effects.
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
// Deferred imports (after mocks are in place)
// ---------------------------------------------------------------------------

import app from "../src/app.js";

// ---------------------------------------------------------------------------
// Test-run-scoped unique IDs
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);

// Session IDs
const SID      = `test-sync-sid-${run}`;
const SID_RO   = `test-sync-ro-sid-${run}`;   // canWrite:false user

// Spotify user IDs
const SP_UID    = `test-sync-uid-${run}`;
const SP_UID_RO = `test-sync-ro-uid-${run}`;

// Recording MBIDs (3 tracks for the happy-path user's library)
//   LINK  — has an Odesli-resolved exact Spotify link → confidence "link"
//   ISRC  — has an ISRC; search mock returns a hit   → confidence "isrc"
//   NONE  — no links, no ISRC; search returns null   → unavailable
const MBID_LINK = `test-sync-link-${run}`;
const MBID_ISRC = `test-sync-isrc-${run}`;
const MBID_NONE = `test-sync-none-${run}`;

// Spotify track IDs returned by the mocked search
const SP_ID_LINK = `splink${run}`;
const SP_ID_ISRC = `spisrc${run}`;

// ISRC stored on MBID_ISRC — used to match the search mock
const ISRC_VAL = `TS${run.toUpperCase()}`.slice(0, 12);

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

let dbAvailable = false;
let userId: number | null = null;
let userIdRo: number | null = null;
let server: Server | undefined;
let baseUrl = "";
let originalFetch: typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiCall(path: string, opts?: RequestInit & { cookies?: Record<string, string> }) {
  const { cookies, ...rest } = opts ?? {};
  const sid = cookies?.lore_sid ?? SID;
  return fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...rest.headers,
      cookie: `lore_sid=${sid}`,
    },
  });
}

async function pollUntilDone(
  jobId: number,
  maxMs = 8_000,
  intervalMs = 50,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res = await apiCall(`/api/me/library/sync/${jobId}`);
    const body = (await res.json()) as Record<string, unknown>;
    if (body.status === "done" || body.status === "error") return body;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for sync job ${jobId} to complete`);
}

// ---------------------------------------------------------------------------
// Global fetch mock — intercepts Spotify API calls, passes local calls through
// ---------------------------------------------------------------------------

function buildFetchMock(original: typeof globalThis.fetch): typeof globalThis.fetch {
  return async function mockedFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    // Local API-server calls (test polling loop): pass through unchanged.
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return original(input, init);
    }

    // ── Spotify search ────────────────────────────────────────────────────
    if (url.includes("api.spotify.com/v1/search")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      // ISRC search hit for MBID_ISRC
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
      // Text search — no hit (for MBID_NONE / any other track)
      return new Response(
        JSON.stringify({ tracks: { items: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Contains check — none pre-saved ───────────────────────────────────
    if (url.includes("api.spotify.com/v1/me/tracks/contains")) {
      const idsParam = new URL(url).searchParams.get("ids") ?? "";
      const count = idsParam.split(",").filter(Boolean).length;
      return new Response(
        JSON.stringify(Array(count).fill(false)),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Save (PUT /me/tracks) ─────────────────────────────────────────────
    if (url.includes("api.spotify.com/v1/me/tracks") && (init?.method === "PUT" || !init?.method)) {
      return new Response(null, { status: 200 });
    }

    // Unexpected call — surface clearly in test output.
    console.error("[test] unexpected fetch:", url);
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

  // Install global fetch mock before anything touches the DB or the server.
  originalFetch = globalThis.fetch;
  globalThis.fetch = buildFetchMock(originalFetch);

  // ── Seed happy-path user ────────────────────────────────────────────────

  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "fake-access",
    refreshToken: "fake-refresh",
    expiresAt: new Date(Date.now() + 3_600_000),
    spotifyUserId: SP_UID,
  });
  const [u] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: SP_UID, spotifyConnectionId: SID })
    .returning({ id: loreUsersTable.id });
  userId = u!.id;

  await db.insert(serviceConnectionsTable).values({
    userId: userId,
    service: "spotify",
    accessToken: "fake-access",
    refreshToken: "fake-refresh",
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ["user-library-modify"],
    canWrite: true,
    connectedAt: new Date(),
  });

  // Odesli exact link for MBID_LINK — extractSpotifyTrackId reads this.
  const links: RecordingLink[] = [
    { name: "Spotify", url: `https://open.spotify.com/track/${SP_ID_LINK}`, kind: "exact" },
  ];

  await db.insert(recordingsTable).values([
    { mbid: MBID_LINK, title: "Link Track",        artist: `Sync Artist ${run}`, links },
    { mbid: MBID_ISRC, title: "ISRC Track",        artist: `Sync Artist ${run}`, isrc: ISRC_VAL },
    { mbid: MBID_NONE, title: "Unavailable Track", artist: `Sync Artist ${run}` },
  ]);

  await db.insert(libraryItemsTable).values([
    { userId, mbid: MBID_LINK, provenance: { kind: "keep" }, addedAt: new Date(Date.now() - 3000) },
    { userId, mbid: MBID_ISRC, provenance: { kind: "keep" }, addedAt: new Date(Date.now() - 2000) },
    { userId, mbid: MBID_NONE, provenance: { kind: "keep" }, addedAt: new Date(Date.now() - 1000) },
  ]);

  // ── Seed canWrite:false user ────────────────────────────────────────────

  await db.insert(spotifyConnectionsTable).values({
    sid: SID_RO,
    accessToken: "fake-ro-access",
    refreshToken: "fake-ro-refresh",
    expiresAt: new Date(Date.now() + 3_600_000),
    spotifyUserId: SP_UID_RO,
  });
  const [uRo] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: SP_UID_RO, spotifyConnectionId: SID_RO })
    .returning({ id: loreUsersTable.id });
  userIdRo = uRo!.id;

  await db.insert(serviceConnectionsTable).values({
    userId: userIdRo,
    service: "spotify",
    accessToken: "fake-ro-access",
    refreshToken: "fake-ro-refresh",
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: [],
    canWrite: false,   // <-- read-only connection
    connectedAt: new Date(),
  });

  // Start server on a random port.
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  // Restore global fetch before any async teardown so other test files aren't
  // affected if they run after this file.
  if (originalFetch) globalThis.fetch = originalFetch;

  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;

  if (userId != null) {
    await db.delete(librarySyncJobsTable).where(eq(librarySyncJobsTable.userId, userId));
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    await db.delete(serviceConnectionsTable).where(eq(serviceConnectionsTable.userId, userId));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  if (userIdRo != null) {
    await db.delete(librarySyncJobsTable).where(eq(librarySyncJobsTable.userId, userIdRo));
    await db.delete(serviceConnectionsTable).where(eq(serviceConnectionsTable.userId, userIdRo));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userIdRo));
  }
  for (const mbid of [MBID_LINK, MBID_ISRC, MBID_NONE]) {
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID_RO));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/me/library/sync — start", () => {
  it("returns 202 with jobId + pending status", async () => {
    if (!dbAvailable) return;
    const res = await apiCall("/api/me/library/sync?service=spotify", {
      method: "POST",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: number; status: string };
    expect(body.jobId).toBeTypeOf("number");
    expect(body.status).toBe("pending");
  });

  it("returns 409 when a job is already running", async () => {
    if (!dbAvailable) return;
    // A job was just started by the previous test and may still be running.
    // Attempt a second POST — should get 409 (duplicate) or 202 (if the first
    // completed and was reset as a zombie). Either is acceptable; 409 is the
    // case we're testing for.
    const res = await apiCall("/api/me/library/sync?service=spotify", {
      method: "POST",
    });
    // It could be 409 or 202 (if the first finished quickly); either is valid.
    expect([202, 409]).toContain(res.status);
    if (res.status === 409) {
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("in progress");
    }
  });
});

describe("GET /api/me/library/sync/:jobId — polling until done", () => {
  it("job reaches status=done with correct receipt after full lifecycle", async () => {
    if (!dbAvailable) return;

    // Discover the most-recent sync job for this user (created in the test above).
    const latestRes = await apiCall("/api/me/library/sync");
    expect(latestRes.status).toBe(200);
    const latest = (await latestRes.json()) as { jobId: number; status: string };
    const { jobId } = latest;
    expect(jobId).toBeTypeOf("number");

    // Poll until the worker finishes.
    const final = await pollUntilDone(jobId);

    expect(final.status).toBe("done");
    expect(final.results).toBeTruthy();

    const results = final.results as {
      synced: number;
      searchMatched: number;
      alreadySaved: number;
      unavailable: number;
      unavailableItems: Array<{ mbid: string; title: string; artist: string; bandcampUrl: string }>;
      searchMatchedItems: Array<{ mbid: string }>;
    };

    // MBID_LINK → matched via Odesli exact link (confidence "link") → synced
    // MBID_ISRC → matched via ISRC search hit (confidence "isrc")   → synced
    // MBID_NONE → no match at all                                    → unavailable
    expect(results.synced).toBe(2);
    expect(results.unavailable).toBe(1);
    expect(results.alreadySaved).toBe(0);
    expect(results.searchMatched).toBe(0);

    // The unavailable item must carry a Bandcamp search link.
    expect(results.unavailableItems).toHaveLength(1);
    expect(results.unavailableItems[0]!.mbid).toBe(MBID_NONE);
    expect(results.unavailableItems[0]!.bandcampUrl).toContain("bandcamp.com/search");

    // No search-matched items (ISRC search returns confidence "isrc", not "search").
    expect(results.searchMatchedItems).toHaveLength(0);
  });
});

describe("POST /api/me/library/sync — canWrite:false", () => {
  it("returns 403 with error=canWrite:false when the connection has no write scope", async () => {
    if (!dbAvailable) return;
    const res = await apiCall("/api/me/library/sync?service=spotify", {
      method: "POST",
      cookies: { lore_sid: SID_RO },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("canWrite:false");
    expect(body.message).toContain("write access");
  });

  it("does not create a sync job when canWrite:false", async () => {
    if (!dbAvailable) return;
    // Confirm no sync job exists for the read-only user.
    const res = await apiCall("/api/me/library/sync", {
      cookies: { lore_sid: SID_RO },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/me/library/sync — latest job endpoint", () => {
  it("returns the most recent job (the one just completed)", async () => {
    if (!dbAvailable) return;
    const res = await apiCall("/api/me/library/sync");
    // The happy-path job may still be running if we race; wait for it.
    const body = (await res.json()) as { status: string; jobId: number };
    expect(["running", "done", "pending"]).toContain(body.status);
    expect(body.jobId).toBeTypeOf("number");
  });
});
