import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, recordingsTable } from "@workspace/db";
import { getSongShare } from "../src/lore/share.js";
import type { RecordingLink } from "@workspace/db";

/**
 * DB-backed integration test for the share-page Odesli enrichment path that
 * covers non-Spotify stations (KEXP, FIP, Radio Paradise) whose spins arrive
 * with no ISRC and no Spotify link.  Verifies the full chain:
 *
 *   ingest (no-ISRC recording in DB)
 *     → first share-page hit  → ?q=artist%20title Odesli call
 *     → exact links written back to recordings.links
 *     → second share-page hit → Odesli skipped (DB cache hit)
 *
 * Mirrors the pattern in entry-db.test.ts: fully isolated (unique ids per run),
 * real DB writes, self-skips without a real DB connection.
 */
const run = randomUUID().slice(0, 8);
const MBID = `test-share-odesli-${run}`;

let dbAvailable = false;

const FAKE_ODESLI_RESPONSE = {
  linksByPlatform: {
    spotify: { url: "https://open.spotify.com/track/TESTTRACK001" },
    appleMusic: { url: "https://music.apple.com/us/album/alright/123456?i=789" },
    youtubeMusic: { url: "https://music.youtube.com/watch?v=TESTVID001" },
  },
};

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await db.insert(recordingsTable).values({
    mbid: MBID,
    title: "Alright",
    artist: "Kendrick Lamar",
    // No isrc, no links — simulates a KEXP or FIP spin with no Spotify metadata
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("share-page Odesli enrichment: KEXP/FIP no-ISRC flow", () => {
  it("calls Odesli with ?q=artist%20title and writes exact links back to DB", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    let capturedUrl: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify(FAKE_ODESLI_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const payload = await getSongShare(MBID);

    // The fire-and-forget DB write runs immediately after enrichShareLinksIfNeeded
    // returns — give it a moment to complete before asserting the DB state.
    await new Promise<void>((r) => setTimeout(r, 300));

    // 1. Odesli was called with the free-text ?q= fallback (no ISRC, no Spotify URL)
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain("api.song.link");
    expect(capturedUrl).toContain("q=Kendrick%20Lamar%20Alright");

    // 2. The returned payload contains exact links from Odesli
    expect(payload).not.toBeNull();
    const exactLinks = payload!.song.links.filter((l: RecordingLink) => l.kind === "exact");
    expect(exactLinks.length).toBeGreaterThan(0);
    expect(exactLinks.some((l: RecordingLink) => l.url.includes("open.spotify.com"))).toBe(true);

    // 3. Exact links were persisted to recordings.links in the DB
    const [row] = await db
      .select({ links: recordingsTable.links })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, MBID));
    const dbLinks = (row?.links as RecordingLink[] | null) ?? [];
    const dbExact = dbLinks.filter((l) => l.kind === "exact");
    expect(dbExact.length).toBeGreaterThan(0);
    expect(dbExact.some((l) => l.url.includes("open.spotify.com"))).toBe(true);
  });

  it("skips Odesli on a second share-page hit — returns DB-cached exact links without a fetch call", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // After the first test the DB already has exact links — Odesli must not be called again.
    const guardFetch = vi.fn(async () => {
      throw new Error("Odesli must not be called on a DB cache hit");
    });
    vi.stubGlobal("fetch", guardFetch);

    const payload = await getSongShare(MBID);

    expect(guardFetch).not.toHaveBeenCalled();
    expect(payload).not.toBeNull();
    const exactLinks = payload!.song.links.filter((l: RecordingLink) => l.kind === "exact");
    expect(exactLinks.length).toBeGreaterThan(0);
  });
});
