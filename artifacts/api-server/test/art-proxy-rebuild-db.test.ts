/**
 * Round-trip integration test for the art-proxy cache rebuild path.
 *
 * Scenario:
 *   1. A recording already has OLD_URL stored as its artworkUrl.
 *   2. upsertRecording is called with NEW_URL — the eviction logic calls
 *      artDelete(OLD_URL) and persists NEW_URL to the DB.
 *   3. The next GET /api/art?src=NEW_URL is a cache miss (the new blob has
 *      not been stored yet).
 *   4. The route fetches from origin, writes to Object Storage via artPut,
 *      and serves the new bytes.
 *
 * artStorage helpers are mocked so the test never touches real GCS.
 * isSafeArtworkUrl is mocked to always allow the URLs used in the test.
 * global fetch is mocked to return a controlled image payload.
 * The DB is real (shared integration suite); upsertRecording needs it to
 * detect the existing artworkUrl and trigger eviction.
 *
 * enrichLinks=false keeps every external MB/Spotify/Odesli call out of the
 * path — identical to the eviction unit tests this mirrors.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { db, recordingsTable } from "@workspace/db";

// ── Module mocks — must be hoisted above any imports that pull these modules ─

vi.mock("../src/lib/artStorage.js", () => ({
  artDelete: vi.fn().mockResolvedValue(undefined),
  artExists: vi.fn().mockResolvedValue(false),
  artGet: vi.fn().mockResolvedValue(null),
  artPut: vi.fn().mockResolvedValue(undefined),
  artUrlHash: (url: string) => url,
}));

vi.mock("../src/lore/share.js", () => ({
  isSafeArtworkUrl: vi.fn().mockResolvedValue(true),
}));

// Mock global fetch — used by the art route to fetch from origin on cache miss
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// ── Imports after mocks are registered ──────────────────────────────────────

import * as artStorageMod from "../src/lib/artStorage.js";
const { upsertRecording } = await import("../src/lore/resolve.js");
import artRouter from "../src/routes/art.js";

// ── Express app for route-level tests ───────────────────────────────────────

const app = express();
app.use(artRouter);

// ── Test fixtures ────────────────────────────────────────────────────────────

const run = randomUUID().slice(0, 8);
const mkMbid = (label: string) => `test-art-rebuild-${run}-${label}`;

const OLD_URL = "https://example.com/art/old-cover.jpg";
const NEW_URL = "https://example.com/art/new-cover.jpg";
const NEW_IMAGE_BYTES = Buffer.from("fresh-image-data-from-origin");

function baseResolution(mbid: string) {
  return {
    mbid,
    confidence: "text" as const,
    title: "Rebuild Test Track",
    artist: "Rebuild Test Artist",
    fromCache: true,
  };
}

/** Build a minimal fetch Response stub for a successful image fetch. */
function makeImageResponse(body: Buffer = NEW_IMAGE_BYTES) {
  return {
    status: 200,
    ok: true,
    headers: {
      get: (h: string) => {
        if (h === "content-type") return "image/jpeg";
        if (h === "location") return null;
        return null;
      },
    },
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}

// ── DB availability guard ───────────────────────────────────────────────────

let dbAvailable = false;
const insertedMbids: string[] = [];

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    // Skip DB-backed tests when DATABASE_URL is not configured.
  }
});

beforeEach(() => {
  vi.mocked(artStorageMod.artDelete).mockClear();
  vi.mocked(artStorageMod.artGet).mockClear();
  vi.mocked(artStorageMod.artPut).mockClear();
  fetchMock.mockClear();
});

afterAll(async () => {
  if (!dbAvailable) return;
  for (const mbid of insertedMbids) {
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Seed a recording row directly, bypassing upsertRecording. */
async function seedRecording(mbid: string, artworkUrl: string | null) {
  await db
    .insert(recordingsTable)
    .values({ mbid, title: "Rebuild Seed", artist: "Seed Artist", artworkUrl })
    .onConflictDoUpdate({
      target: recordingsTable.mbid,
      set: { artworkUrl },
    });
  insertedMbids.push(mbid);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("art-proxy cache rebuild after eviction", () => {
  it(
    "full round-trip: evict OLD_URL then re-fetch and store NEW_URL on the next /api/art request",
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      const mbid = mkMbid("full-round-trip");

      // 1. Seed a recording with OLD_URL as the cached cover.
      await seedRecording(mbid, OLD_URL);

      // 2. artGet returns null throughout — simulates that neither URL's blob
      //    is in Object Storage (eviction clears the old one; the new one has
      //    not been stored yet).
      vi.mocked(artStorageMod.artGet).mockResolvedValue(null);

      // 3. upsertRecording detects the URL change and evicts the old blob.
      await upsertRecording(baseResolution(mbid), NEW_URL, false);

      // artDelete must have been called with the OLD URL.
      expect(vi.mocked(artStorageMod.artDelete)).toHaveBeenCalledOnce();
      expect(vi.mocked(artStorageMod.artDelete)).toHaveBeenCalledWith(OLD_URL);

      // 4. The next /api/art request for NEW_URL is a cache miss.
      //    Origin returns the new image bytes.
      fetchMock.mockResolvedValue(makeImageResponse());

      const res = await request(app).get(
        `/art?src=${encodeURIComponent(NEW_URL)}`,
      );

      // 5. Route served the fresh bytes from origin (cache miss path).
      expect(res.status).toBe(200);
      expect(res.headers["x-art-proxy"]).toBe("miss");
      expect(res.headers["content-type"]).toMatch(/image\/jpeg/);
      expect(Buffer.from(res.body)).toEqual(NEW_IMAGE_BYTES);

      // 6. artGet was queried for NEW_URL (not the old one).
      const artGetCalls = vi
        .mocked(artStorageMod.artGet)
        .mock.calls.map((c) => c[0]);
      expect(artGetCalls).toContain(NEW_URL);

      // 7. artPut was called with NEW_URL — the fresh blob is now stored.
      // artPut is fire-and-forget so we wait a tick for it to register.
      await new Promise((r) => setTimeout(r, 0));
      expect(vi.mocked(artStorageMod.artPut)).toHaveBeenCalledWith(
        NEW_URL,
        expect.any(Buffer),
        "image/jpeg",
      );
    },
  );

  it(
    "cache miss after eviction returns X-Art-Proxy: miss (not hit) for the new URL",
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      const mbid = mkMbid("miss-header");
      await seedRecording(mbid, OLD_URL);

      vi.mocked(artStorageMod.artGet).mockResolvedValue(null);
      await upsertRecording(baseResolution(mbid), NEW_URL, false);

      fetchMock.mockResolvedValue(makeImageResponse());
      const res = await request(app).get(
        `/art?src=${encodeURIComponent(NEW_URL)}`,
      );

      expect(res.headers["x-art-proxy"]).toBe("miss");
    },
  );

  it(
    "artPut is called with the exact bytes returned by origin after a rebuild",
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      const mbid = mkMbid("put-bytes");
      await seedRecording(mbid, OLD_URL);

      vi.mocked(artStorageMod.artGet).mockResolvedValue(null);
      await upsertRecording(baseResolution(mbid), NEW_URL, false);

      const customBytes = Buffer.from("custom-origin-image-payload");
      fetchMock.mockResolvedValue(makeImageResponse(customBytes));

      await request(app).get(`/art?src=${encodeURIComponent(NEW_URL)}`);
      await new Promise((r) => setTimeout(r, 0));

      expect(vi.mocked(artStorageMod.artPut)).toHaveBeenCalledWith(
        NEW_URL,
        expect.any(Buffer),
        "image/jpeg",
      );
      const [, storedData] = vi.mocked(artStorageMod.artPut).mock.calls[0];
      expect(Buffer.from(storedData as Buffer)).toEqual(customBytes);
    },
  );

  it(
    "a subsequent /api/art request for the NEW_URL serves from cache (hit) once stored",
    async (ctx) => {
      if (!dbAvailable) return ctx.skip();

      const mbid = mkMbid("second-hit");
      await seedRecording(mbid, OLD_URL);

      // First request: cache miss — artGet returns null, origin is fetched.
      vi.mocked(artStorageMod.artGet).mockResolvedValue(null);
      await upsertRecording(baseResolution(mbid), NEW_URL, false);

      fetchMock.mockResolvedValue(makeImageResponse());
      await request(app).get(`/art?src=${encodeURIComponent(NEW_URL)}`);

      // Second request: artGet now returns the stored blob (simulating GCS hit).
      vi.mocked(artStorageMod.artGet).mockResolvedValue({
        data: NEW_IMAGE_BYTES,
        contentType: "image/jpeg",
      });
      fetchMock.mockClear();

      const res = await request(app).get(
        `/art?src=${encodeURIComponent(NEW_URL)}`,
      );

      expect(res.status).toBe(200);
      expect(res.headers["x-art-proxy"]).toBe("hit");
      expect(Buffer.from(res.body)).toEqual(NEW_IMAGE_BYTES);
      // Origin must not be called on a cache hit.
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
