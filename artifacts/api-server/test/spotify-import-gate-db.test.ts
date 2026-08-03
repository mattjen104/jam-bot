/**
 * HTTP tests for the SPOTIFY_IMPORT_ENABLED feature-flag gate on
 * POST /api/me/library/import?service=spotify.
 *
 * Confirms:
 *   1. The route returns 403 when SPOTIFY_IMPORT_ENABLED is unset.
 *   2. The route returns 403 when SPOTIFY_IMPORT_ENABLED is any value other
 *      than the string "true" (e.g. "false", "0").
 *   3. The route returns 202 when SPOTIFY_IMPORT_ENABLED=true and the caller
 *      has an active Spotify service connection.
 *
 * Self-skips when no real database is reachable (same pattern as
 * me-library-db.test.ts).  The background import worker is fully mocked so
 * it never makes real network calls to Spotify or MusicBrainz.
 */

// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { sql, eq } from "drizzle-orm";
import {
  db,
  loreUsersTable,
  spotifyConnectionsTable,
  serviceConnectionsTable,
  libraryImportJobsTable,
} from "@workspace/db";

// ── Module mocks (must be declared before any deferred imports) ───────────────

// Prevent real Spotify API calls in the background import worker.
const { mockImportLibrary } = vi.hoisted(() => ({
  mockImportLibrary: vi.fn().mockResolvedValue({ tracks: [] }),
}));

vi.mock("../src/lore/serviceConnector.js", () => ({
  getConnector: vi.fn().mockReturnValue({ importLibrary: mockImportLibrary }),
  getFreshServiceToken: vi.fn(),
  refreshServiceToken: vi.fn(),
}));

// Prevent real MusicBrainz calls from the Phase-3 worker.
vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...orig,
    createMbResolver: vi.fn().mockReturnValue({
      resolveByIsrc: vi.fn().mockResolvedValue(null),
      resolveByText: vi.fn().mockResolvedValue(null),
      resolveByTextWithScore: vi.fn().mockResolvedValue(null),
    }),
  };
});

// Pass-through crypto so the worker can read plaintext tokens seeded in tests.
vi.mock("../src/lore/tokenCrypto.js", () => ({
  decryptToken: (s: string) => s,
  encryptToken: (s: string) => s,
}));

// Prevent the Spotify saved-track checker from hitting the network.
vi.mock("../src/routes/me/spotify-library-check.js", () => ({
  checkSpotifyLibraryContains: vi.fn().mockResolvedValue({ ok: false, reason: "token" }),
}));

// Stub non-essential modules that are evaluated when the me-router loads.
vi.mock("../src/lore/for-you.js", () => ({
  getForYouStations: vi.fn(),
  getForYouBlogs: vi.fn(),
}));

// ── Deferred app import (after mocks are in place) ────────────────────────────

import app from "../src/app.js";

// ── Per-run identifiers ───────────────────────────────────────────────────────

const run = randomUUID().slice(0, 8);
const SID = `test-spgate-sid-${run}`;
const ENV_KEY = "SPOTIFY_IMPORT_ENABLED";

// ── Shared state ──────────────────────────────────────────────────────────────

let dbAvailable = false;
let userId: number | null = null;
let server: Server | undefined;
let baseUrl = "";

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return; // no DB — all tests self-skip via the dbAvailable guard
  }

  // Seed a Spotify OAuth connection so the session middleware can resolve the
  // lore_sid cookie to a real user.
  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "fake-access-token",
    refreshToken: "fake-refresh-token",
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const [user] = await db
    .insert(loreUsersTable)
    .values({
      spotifyUserId: `test-spgate-${run}`,
      spotifyConnectionId: SID,
      // deviceKey = SID so the lore_sid cookie is resolved by getUserFromSession.
      deviceKey: SID,
    })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  // Seed a service_connections row so the "no connection" guard is satisfied
  // when the flag is enabled (test 3 — the 202 path).
  await db.insert(serviceConnectionsTable).values({
    userId: userId!,
    service: "spotify",
    accessToken: "fake-access-token",
    refreshToken: "fake-refresh-token",
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: "user-library-read",
    canWrite: false,
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server!.address();
  if (addr && typeof addr === "object") {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable) return;
  if (userId != null) {
    // Remove in FK-safe order.
    await db.delete(libraryImportJobsTable).where(eq(libraryImportJobsTable.userId, userId));
    await db.delete(serviceConnectionsTable).where(eq(serviceConnectionsTable.userId, userId));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function postImport(): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/api/me/library/import?service=spotify`, {
    method: "POST",
    headers: { cookie: `lore_sid=${SID}` },
  });
  return { status: res.status, body: await res.json() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SPOTIFY_IMPORT_ENABLED gate", () => {
  it("returns 403 when SPOTIFY_IMPORT_ENABLED is unset", async () => {
    if (!dbAvailable) return;

    const prev = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    try {
      const { status, body } = await postImport();
      expect(status).toBe(403);
      expect(body).toMatchObject({ error: expect.stringContaining("not enabled") });
    } finally {
      if (prev !== undefined) process.env[ENV_KEY] = prev;
    }
  });

  it("returns 403 when SPOTIFY_IMPORT_ENABLED is set to 'false'", async () => {
    if (!dbAvailable) return;

    const prev = process.env[ENV_KEY];
    process.env[ENV_KEY] = "false";
    try {
      const { status, body } = await postImport();
      expect(status).toBe(403);
      expect(body).toMatchObject({ error: expect.stringContaining("not enabled") });
    } finally {
      if (prev === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prev;
    }
  });

  it("returns 202 when SPOTIFY_IMPORT_ENABLED=true and the user has a Spotify connection", async () => {
    if (!dbAvailable) return;

    const prev = process.env[ENV_KEY];
    process.env[ENV_KEY] = "true";
    try {
      const { status, body } = await postImport();
      expect(status).toBe(202);
      expect(body).toMatchObject({ status: "pending" });
      expect(typeof (body as { jobId: unknown }).jobId).toBe("number");
    } finally {
      if (prev === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prev;
    }
  });
});
