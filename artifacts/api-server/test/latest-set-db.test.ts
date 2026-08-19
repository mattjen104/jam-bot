import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  showsTable,
  recordingsTable,
  spinsTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration tests for the set-scanner read models:
 *   GET /api/player/stations/:slug/latest-set  — full tracklist of the
 *     station's latest COMPLETED run (a run whose last spin is older than
 *     the 30-minute live gap; a still-live newest run is skipped).
 *   GET /api/player/latest-sets?slugs=…        — per-slug summaries for the
 *     dial rows' "Last set" affordance; null for stations with no completed
 *     set or unknown slugs.
 *
 * Fully isolated (unique slugs/MBID) and cleaned up. Skips gracefully when
 * no real database is reachable.
 */
const run = randomUUID().slice(0, 8);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const MBID = `test-ls-${run}`;

let dbAvailable = false;
let stationIds: number[] = [];
let showIds: number[] = [];
let spinIds: number[] = [];
let server: Server | undefined;
let baseUrl = "";

let slugA = "";
let slugB = "";
let slugC = "";
let slugD = "";

// Station D: a set straddling the 14-day lookback boundary — one spin just
// BEFORE the cutoff, one just after, same UTC day (nudged past midnight when
// the cutoff lands too close to it). The summary must aggregate the whole
// partition, not just the post-cutoff subset.
const CUTOFF = Date.now() - 14 * 24 * HOUR;
let boundEarly = CUTOFF - 2 * MIN;
let boundLate = CUTOFF + 2 * MIN;
if (
  new Date(boundEarly).toISOString().slice(0, 10) !==
  new Date(boundLate).toISOString().slice(0, 10)
) {
  boundEarly += 30 * MIN;
  boundLate += 30 * MIN;
}
let boundSpinIds: number[] = [];

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  slugA = `test-ls-a-${run}`;
  slugB = `test-ls-b-${run}`;
  slugC = `test-ls-c-${run}`;
  slugD = `test-ls-d-${run}`;
  const stations = await db
    .insert(stationsTable)
    .values([
      { slug: slugA, name: `Test LS A ${run}`, streamUrl: "http://example.invalid/a", stationClass: "curated" },
      { slug: slugB, name: `Test LS B ${run}`, streamUrl: "http://example.invalid/b", stationClass: "curated" },
      { slug: slugC, name: `Test LS C ${run}`, streamUrl: "http://example.invalid/c", stationClass: "curated" },
      { slug: slugD, name: `Test LS D ${run}`, streamUrl: "http://example.invalid/d", stationClass: "curated" },
    ])
    .returning({ id: stationsTable.id });
  stationIds = stations.map((s) => s.id);
  const [stationA, stationB, stationC, stationD] = stationIds as [number, number, number, number];

  const shows = await db
    .insert(showsTable)
    .values([{ stationId: stationA, name: `Test LS Show ${run}`, djName: "DJ LS" }])
    .returning({ id: showsTable.id });
  showIds = shows.map((s) => s.id);
  const showA = showIds[0]!;

  await db
    .insert(recordingsTable)
    .values([{ mbid: MBID, title: "Resolved Title", artist: `Resolved Artist ${run}` }]);

  const now = Date.now();
  const spins = await db
    .insert(spinsTable)
    .values([
      // Station A, run 1 (no show) — completed 3h ago. This is the set the
      // scanner should open even though a newer run is still live.
      { stationId: stationA, confidence: "text", rawArtist: "Raw Alpha 1", rawTitle: "Raw Song 1", playedAt: new Date(now - 3 * HOUR) },
      { stationId: stationA, confidence: "text", rawArtist: "Raw Alpha 2", rawTitle: "Raw Song 2", playedAt: new Date(now - 3 * HOUR + 4 * MIN) },
      // Station A, run 2 (show-attributed, so a separate run group) — last
      // spin a minute ago: still on the air, must be skipped.
      { stationId: stationA, showId: showA, confidence: "text", rawArtist: "Live Artist", rawTitle: "Live Song", playedAt: new Date(now - 1 * MIN) },
      // Station B — one completed run 2h ago; second spin resolved.
      { stationId: stationB, confidence: "text", rawArtist: "Raw Beta 1", rawTitle: "Raw Beta Song 1", playedAt: new Date(now - 2 * HOUR) },
      { stationId: stationB, mbid: MBID, confidence: "recording_id", rawArtist: "raw", rawTitle: "raw", playedAt: new Date(now - 2 * HOUR + 4 * MIN) },
      // Station C — only a still-live spin: no completed set at all.
      { stationId: stationC, confidence: "text", rawArtist: "Live Only", rawTitle: "Live Only Song", playedAt: new Date(now - 1 * MIN) },
      // Station D — one partition straddling the lookback boundary.
      { stationId: stationD, confidence: "text", rawArtist: "Boundary Early", rawTitle: "Before Cutoff", playedAt: new Date(boundEarly) },
      { stationId: stationD, confidence: "text", rawArtist: "Boundary Late", rawTitle: "After Cutoff", playedAt: new Date(boundLate) },
    ])
    .returning({ id: spinsTable.id });
  spinIds = spins.map((s) => s.id);
  boundSpinIds = spinIds.slice(-2);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable || stationIds.length === 0) return;
  await db.delete(spinsTable).where(inArray(spinsTable.id, spinIds));
  if (showIds.length) await db.delete(showsTable).where(inArray(showsTable.id, showIds));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID]));
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
});

describe("GET /api/player/stations/:slug/latest-set", () => {
  it("returns the latest COMPLETED set, skipping the still-live run", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/player/stations/${slugA}/latest-set`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      station: { slug: string; name: string };
      run: { runId: number; show: unknown; spinCount: number; startedAt: string; endedAt: string };
      tracks: { spinId: number; position: number; artist: string; title: string }[];
    };
    expect(body.station.slug).toBe(slugA);
    expect(body.run.show).toBeNull();
    expect(body.run.spinCount).toBe(2);
    // The completed run's two spins — not the live one.
    expect(body.tracks.map((t) => t.spinId).sort()).toEqual([...spinIds.slice(0, 2)].sort());
    expect(body.tracks[0]!.title).toBe("Raw Song 1");
    expect(body.tracks[1]!.title).toBe("Raw Song 2");
  });

  it("serves tracks in broadcast order with spin ids and resolved recording fields", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/player/stations/${slugB}/latest-set`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: { spinCount: number; resolvedCount: number };
      tracks: {
        spinId: number;
        position: number;
        playedAt: string;
        artist: string;
        title: string;
        mbid: string | null;
      }[];
    };
    expect(body.run.spinCount).toBe(2);
    expect(body.run.resolvedCount).toBe(1);
    expect(body.tracks.map((t) => t.position)).toEqual([0, 1]);
    expect(new Date(body.tracks[0]!.playedAt).getTime())
      .toBeLessThan(new Date(body.tracks[1]!.playedAt).getTime());
    // Resolved spin overrides raw text with the recording's canonical fields.
    expect(body.tracks[1]!.mbid).toBe(MBID);
    expect(body.tracks[1]!.artist).toBe(`Resolved Artist ${run}`);
    expect(body.tracks[1]!.title).toBe("Resolved Title");
  });

  it("404s for a station whose only run is still live, and for unknown slugs", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const live = await fetch(`${baseUrl}/api/player/stations/${slugC}/latest-set`);
    expect(live.status).toBe(404);
    const unknown = await fetch(`${baseUrl}/api/player/stations/nope-${run}/latest-set`);
    expect(unknown.status).toBe(404);
  });

  it("aggregates the whole partition when a set straddles the lookback boundary", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/player/stations/${slugD}/latest-set`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: { runId: number; spinCount: number; startedAt: string };
      tracks: { spinId: number; title: string }[];
    };
    // Both spins of the partition — including the one played BEFORE the
    // lookback cutoff — are counted and listed, and the run anchor is the
    // true earliest spin (min id), so summary and detail agree.
    expect(body.run.spinCount).toBe(2);
    expect(body.run.runId).toBe(boundSpinIds[0]);
    expect(new Date(body.run.startedAt).getTime()).toBe(new Date(boundEarly).getTime());
    expect(body.tracks.map((t) => t.title)).toEqual(["Before Cutoff", "After Cutoff"]);
    // Batch summary agrees with the detail endpoint.
    const sum = await fetch(`${baseUrl}/api/player/latest-sets?slugs=${slugD}`);
    const sumBody = (await sum.json()) as { items: Record<string, { runId: number; spinCount: number } | null> };
    expect(sumBody.items[slugD]?.spinCount).toBe(2);
    expect(sumBody.items[slugD]?.runId).toBe(boundSpinIds[0]);
  });
});

describe("GET /api/player/latest-sets", () => {
  it("maps each requested slug to its summary or null", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/player/latest-sets?slugs=${slugA},${slugB},${slugC},nope-${run}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Record<string, { runId: number; spinCount: number; startedAt: string; endedAt: string } | null>;
    };
    expect(body.items[slugA]?.spinCount).toBe(2);
    expect(body.items[slugB]?.spinCount).toBe(2);
    // The summary's runId matches the tracklist endpoint's run.
    const detail = await fetch(`${baseUrl}/api/player/stations/${slugA}/latest-set`);
    const detailBody = (await detail.json()) as { run: { runId: number } };
    expect(body.items[slugA]?.runId).toBe(detailBody.run.runId);
    // No completed set / unknown slug → explicit null, never a fabricated row.
    expect(body.items[slugC]).toBeNull();
    expect(body.items[`nope-${run}`]).toBeNull();
  });

  it("returns an empty map when no slugs are given", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/player/latest-sets`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: {} });
  });
});
