import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  showsTable,
  recordingsTable,
  spinsTable,
  pickersTable,
  picksTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration test for GET /api/archive/artist-runs — artist search across
 * archive runs. Guards the core semantics: match via rawArtist OR the
 * resolved recording's artist, group hits into runs, and compute run anchors
 * (runId = min id) plus totals over the FULL partition, never just the
 * matching rows — so returned runIds match the archive pages exactly.
 *
 * Fully isolated (unique slugs/handles/MBIDs, unique artist token) and
 * cleaned up. Skips gracefully when no real database is reachable.
 */
const run = randomUUID().slice(0, 8);
const ARTIST = `Zqartist ${run}`;
const MBID = `test-ars-${run}`;
const MIN = 60 * 1000;

// Base a couple of minutes ahead of now; keep the window inside one UTC day.
let base = Date.now() + 2 * MIN;
if (
  new Date(base).toISOString().slice(0, 10) !==
  new Date(base + 10 * MIN).toISOString().slice(0, 10)
) {
  base += 20 * MIN;
}

let dbAvailable = false;
let stationId = 0;
let pickerId = 0;
let server: Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: `test-ars-${run}`,
      name: `Test ARS ${run}`,
      streamUrl: "http://example.invalid/ars",
      stationClass: "curated",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  // Resolved recording whose canonical artist matches (spin's rawArtist does
  // NOT match — exercises the recordings-join match path).
  await db
    .insert(recordingsTable)
    .values([{ mbid: MBID, title: "ARS Song", artist: ARTIST }]);

  await db.insert(spinsTable).values([
    // Run: 3 spins on one day. Spin 1 (earliest, the anchor) does NOT match.
    {
      stationId,
      confidence: "text",
      rawArtist: "someone else",
      rawTitle: "opener",
      playedAt: new Date(base),
    },
    // Spin 2 matches via rawArtist.
    {
      stationId,
      confidence: "unresolved",
      rawArtist: ARTIST,
      rawTitle: "raw hit",
      playedAt: new Date(base + 1 * MIN),
    },
    // Spin 3 matches via resolved recording artist only.
    {
      stationId,
      mbid: MBID,
      confidence: "text",
      rawArtist: "mislabeled",
      rawTitle: "resolved hit",
      playedAt: new Date(base + 2 * MIN),
    },
  ]);

  const [picker] = await db
    .insert(pickersTable)
    .values({
      pickerType: "blog",
      name: `Test ARS Blog ${run}`,
      handle: `test-ars-blog-${run}`,
      trustTier: 2,
    })
    .returning({ id: pickersTable.id });
  pickerId = picker!.id;

  const listUrl = `http://example.invalid/ars-list-${run}`;
  await db.insert(picksTable).values([
    // Pick 1 (anchor of the list) does NOT match.
    {
      pickerId,
      rawArtist: "another act",
      rawTitle: "list opener",
      source: "blog_post",
      context: `ARS List ${run}`,
      sourceUrl: listUrl,
      pickedAt: new Date(base),
    },
    // Pick 2 matches via rawArtist.
    {
      pickerId,
      rawArtist: ARTIST,
      rawTitle: "list hit",
      source: "blog_post",
      context: `ARS List ${run}`,
      sourceUrl: listUrl,
      pickedAt: new Date(base + 1 * MIN),
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object")
    baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  if (stationId) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(showsTable).where(eq(showsTable.stationId, stationId));
  }
  if (pickerId) {
    await db.delete(picksTable).where(eq(picksTable.pickerId, pickerId));
    await db.delete(pickersTable).where(eq(pickersTable.id, pickerId));
  }
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID]));
  if (stationId) {
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
});

describe("GET /api/archive/artist-runs", () => {
  it("rejects a missing or empty query", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const missing = await fetch(`${baseUrl}/api/archive/artist-runs`);
    expect(missing.status).toBe(400);
    const empty = await fetch(
      `${baseUrl}/api/archive/artist-runs?q=%20%20`,
    );
    expect(empty.status).toBe(400);
  });

  it("finds station and picker runs by artist, with full-run anchors and totals", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/archive/artist-runs?q=${encodeURIComponent(`zqartist ${run}`)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      query: string;
      stationRuns: {
        station: { slug: string };
        run: { runId: number; spinCount: number; resolvedCount: number };
        matchCount: number;
      }[];
      pickerRuns: {
        picker: { handle: string };
        runId: number;
        title: string | null;
        trackCount: number;
        matchCount: number;
      }[];
    };

    const s = body.stationRuns.find(
      (m) => m.station.slug === `test-ars-${run}`,
    );
    expect(s).toBeDefined();
    // Both match paths counted: rawArtist hit + resolved-artist hit.
    expect(s!.matchCount).toBe(2);
    // Totals span the WHOLE run, including the non-matching opener.
    expect(s!.run.spinCount).toBe(3);
    expect(s!.run.resolvedCount).toBe(1);
    // The anchor is the run's min spin id — the NON-matching opener.
    const [anchor] = await db
      .select({ id: sql<number>`min(${spinsTable.id})` })
      .from(spinsTable)
      .where(eq(spinsTable.stationId, stationId));
    expect(s!.run.runId).toBe(anchor!.id);

    const p = body.pickerRuns.find(
      (m) => m.picker.handle === `test-ars-blog-${run}`,
    );
    expect(p).toBeDefined();
    expect(p!.matchCount).toBe(1);
    expect(p!.trackCount).toBe(2);
    expect(p!.title).toBe(`ARS List ${run}`);
    const [pickAnchor] = await db
      .select({ id: sql<number>`min(${picksTable.id})` })
      .from(picksTable)
      .where(eq(picksTable.pickerId, pickerId));
    expect(p!.runId).toBe(pickAnchor!.id);
  });

  it("escapes ILIKE wildcards in the query", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/archive/artist-runs?q=${encodeURIComponent(`%${run}%`)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stationRuns: { station: { slug: string } }[];
    };
    // "%…%" is treated literally, so it must NOT match our seeded artist.
    expect(
      body.stationRuns.find((m) => m.station.slug === `test-ars-${run}`),
    ).toBeUndefined();
  });
});
