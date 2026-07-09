import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import { db, stationsTable, recordingsTable, spinsTable } from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration test for GET /api/stations/spins — the universal, time-based
 * scrub endpoint over a station's *entire* logged spin history (not grouped
 * by show/run). Guards cursor pagination (`before`/`nextBefore`), ordering
 * (newest first), and the reported oldest/newest bounds used to size the
 * scrub slider.
 *
 * Seeded spins sit a few minutes in the FUTURE so they rank above any real
 * live spin regardless of pollers running concurrently. Fully isolated
 * (unique slug/MBIDs) and cleaned up. Skips gracefully when no DB is reachable.
 */
const run = randomUUID().slice(0, 8);
const MBID = `test-ss-${run}`;
const MIN = 60 * 1000;
const base = Date.now() + 5 * MIN;

let dbAvailable = false;
let stationId: number | undefined;
let server: Server | undefined;
let baseUrl = "";
const SLUG = `test-ss-${run}`;

// 5 spins, one per minute, newest last inserted.
const OFFSETS = [0, 1, 2, 3, 4];

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
      slug: SLUG,
      name: `Test SS ${run}`,
      streamUrl: "http://example.invalid/ss",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  await db.insert(recordingsTable).values([{ mbid: MBID, title: "SS", artist: `Test SS ${run}` }]);

  await db.insert(spinsTable).values(
    OFFSETS.map((offset, i) => ({
      stationId: stationId!,
      // Leave the middle spin unresolved to exercise the recording-less shape.
      mbid: i === 2 ? null : MBID,
      confidence: "text" as const,
      rawArtist: `artist-${offset}`,
      rawTitle: `title-${offset}`,
      playedAt: new Date(base + offset * MIN),
    })),
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable || !stationId) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, [stationId]));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID]));
  await db.delete(stationsTable).where(inArray(stationsTable.id, [stationId]));
});

type SpinsResponse = {
  station: { slug: string; name: string };
  tracks: {
    position: number;
    playedAt: string;
    rawArtist: string;
    rawTitle: string;
    confidence: string;
    recording: { mbid: string } | null;
  }[];
  nextBefore: string | null;
  bounds: { oldestSpinAt: string | null; newestSpinAt: string | null; spinCount: number };
};

describe("GET /api/stations/spins", () => {
  it("404s for an unknown station slug", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/spins?slug=does-not-exist-${run}`);
    expect(res.status).toBe(404);
  });

  it("returns bounds, newest-first ordering, and per-track resolution shape", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/spins?slug=${SLUG}&limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SpinsResponse;

    expect(body.station.slug).toBe(SLUG);
    expect(body.bounds.spinCount).toBe(5);
    expect(body.bounds.oldestSpinAt).toBe(new Date(base).toISOString());
    expect(body.bounds.newestSpinAt).toBe(new Date(base + 4 * MIN).toISOString());

    expect(body.tracks).toHaveLength(5);
    const playedAts = body.tracks.map((t) => t.playedAt);
    expect(playedAts).toEqual([...playedAts].sort().reverse());
    expect(body.tracks[0]!.playedAt).toBe(new Date(base + 4 * MIN).toISOString());
    expect(body.tracks[4]!.playedAt).toBe(new Date(base).toISOString());

    // The middle spin (offset 2) was never resolved to a recording.
    const unresolved = body.tracks.find((t) => t.rawTitle === "title-2");
    expect(unresolved).toBeDefined();
    expect(unresolved!.recording).toBeNull();
    const resolved = body.tracks.find((t) => t.rawTitle === "title-4");
    expect(resolved!.recording).toMatchObject({ mbid: MBID });

    // A full page (tracks.length === limit) reports no further page.
    expect(body.nextBefore).toBeNull();
  });

  it("paginates strictly older via before/nextBefore with no overlap or gaps", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const page1 = (await (
      await fetch(`${baseUrl}/api/stations/spins?slug=${SLUG}&limit=2`)
    ).json()) as SpinsResponse;
    expect(page1.tracks).toHaveLength(2);
    expect(page1.tracks.map((t) => t.rawTitle)).toEqual(["title-4", "title-3"]);
    expect(page1.nextBefore).toBe(new Date(base + 3 * MIN).toISOString());

    const page2 = (await (
      await fetch(
        `${baseUrl}/api/stations/spins?slug=${SLUG}&limit=2&before=${encodeURIComponent(page1.nextBefore!)}`,
      )
    ).json()) as SpinsResponse;
    expect(page2.tracks).toHaveLength(2);
    expect(page2.tracks.map((t) => t.rawTitle)).toEqual(["title-2", "title-1"]);
    expect(page2.nextBefore).toBe(new Date(base + 1 * MIN).toISOString());

    const page3 = (await (
      await fetch(
        `${baseUrl}/api/stations/spins?slug=${SLUG}&limit=2&before=${encodeURIComponent(page2.nextBefore!)}`,
      )
    ).json()) as SpinsResponse;
    expect(page3.tracks).toHaveLength(1);
    expect(page3.tracks.map((t) => t.rawTitle)).toEqual(["title-0"]);
    // Last (oldest) page: fewer rows than limit means no further page.
    expect(page3.nextBefore).toBeNull();

    // Bounds are stable across every page regardless of the cursor.
    for (const page of [page1, page2, page3]) {
      expect(page.bounds.spinCount).toBe(5);
      expect(page.bounds.oldestSpinAt).toBe(new Date(base).toISOString());
      expect(page.bounds.newestSpinAt).toBe(new Date(base + 4 * MIN).toISOString());
    }
  });

  it("clamps limit to the [1, 200] range", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/spins?slug=${SLUG}&limit=0`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SpinsResponse;
    expect(body.tracks).toHaveLength(1);
  });
});
