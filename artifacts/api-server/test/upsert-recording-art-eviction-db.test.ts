/**
 * Integration tests for upsertRecording's artwork-cache eviction logic.
 *
 * artDelete must be called exactly once when a recording's artworkUrl changes
 * to a new non-null value. It must NOT fire when the URL is unchanged, when
 * there was no prior artwork, or when the new artwork is absent.
 *
 * DB is real (shared integration suite). artDelete is mocked so the tests
 * never touch Object Storage and remain deterministic. enrichLinks=false keeps
 * every external network call (Spotify, MusicBrainz, Odesli) out of the path.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, recordingsTable } from "@workspace/db";
import type { MbidResolution } from "../src/lore/resolve.js";

// ── Mock artStorage BEFORE importing resolve so the hoisted factory runs ────
vi.mock("../src/lib/artStorage.js", () => ({
  artDelete: vi.fn().mockResolvedValue(undefined),
  artExists: vi.fn().mockResolvedValue(false),
  artGet: vi.fn().mockResolvedValue(null),
  artPut: vi.fn().mockResolvedValue(undefined),
  artUrlHash: (url: string) => url,
}));

// Import AFTER the mock is registered so the module under test receives the stub.
const { upsertRecording } = await import("../src/lore/resolve.js");
import * as artStorageMod from "../src/lib/artStorage.js";

// ── Test fixtures ────────────────────────────────────────────────────────────
const run = randomUUID().slice(0, 8);
const mkMbid = (label: string) => `test-art-eviction-${run}-${label}`;

const OLD_URL = "https://example.com/art/old.jpg";
const NEW_URL = "https://example.com/art/new.jpg";

function baseResolution(mbid: string): MbidResolution {
  return {
    mbid,
    confidence: "text",
    title: "Eviction Test Track",
    artist: "Eviction Test Artist",
    fromCache: true,
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

afterEach(() => {
  vi.mocked(artStorageMod.artDelete).mockClear();
});

afterAll(async () => {
  if (!dbAvailable) return;
  for (const mbid of insertedMbids) {
    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Insert a recording row with the given artworkUrl, bypassing upsertRecording. */
async function seedRecording(mbid: string, artworkUrl: string | null) {
  await db
    .insert(recordingsTable)
    .values({ mbid, title: "Eviction Seed", artist: "Seed Artist", artworkUrl })
    .onConflictDoUpdate({
      target: recordingsTable.mbid,
      set: { artworkUrl },
    });
  insertedMbids.push(mbid);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("upsertRecording art-cache eviction", () => {
  it("calls artDelete when the artwork URL changes to a new value", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const mbid = mkMbid("url-changes");
    await seedRecording(mbid, OLD_URL);

    await upsertRecording(baseResolution(mbid), NEW_URL, false);

    expect(vi.mocked(artStorageMod.artDelete)).toHaveBeenCalledOnce();
    expect(vi.mocked(artStorageMod.artDelete)).toHaveBeenCalledWith(OLD_URL);
  });

  it("does NOT call artDelete when the artwork URL is unchanged", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const mbid = mkMbid("url-same");
    await seedRecording(mbid, OLD_URL);

    await upsertRecording(baseResolution(mbid), OLD_URL, false);

    expect(vi.mocked(artStorageMod.artDelete)).not.toHaveBeenCalled();
  });

  it("does NOT call artDelete when there was no prior artwork", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const mbid = mkMbid("no-prior-art");
    await seedRecording(mbid, null);

    await upsertRecording(baseResolution(mbid), NEW_URL, false);

    expect(vi.mocked(artStorageMod.artDelete)).not.toHaveBeenCalled();
  });

  it("does NOT call artDelete when the recording is brand new (no existing row)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const mbid = mkMbid("brand-new");
    insertedMbids.push(mbid); // register for cleanup

    await upsertRecording(baseResolution(mbid), NEW_URL, false);

    expect(vi.mocked(artStorageMod.artDelete)).not.toHaveBeenCalled();
  });

  it("does NOT call artDelete when the new artwork is absent (even if there was a prior URL)", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const mbid = mkMbid("new-art-absent");
    await seedRecording(mbid, OLD_URL);

    // No artworkUrl argument — upsertRecording won't overwrite the existing
    // cover and must not evict it either.
    await upsertRecording(baseResolution(mbid), undefined, false);

    expect(vi.mocked(artStorageMod.artDelete)).not.toHaveBeenCalled();
  });
});
