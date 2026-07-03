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
 * Integration test for GET /api/archive/recent-runs — the cross-station run
 * derivation (group by station + show + UTC day, runId = min spin id, newest
 * play first). Guards the grouping semantics the home screen's Ghost Radio
 * mode depends on.
 *
 * Seeded spins sit a few minutes in the FUTURE so they are guaranteed to rank
 * inside the endpoint's newest-40 window even while live pollers keep
 * ingesting real spins, and all within one UTC day (base is nudged past
 * midnight when too close) so the grouping splits under test are station and
 * show, never an accidental day boundary. Fully isolated (unique slugs/MBIDs)
 * and cleaned up. Skips gracefully when no real database is reachable.
 */
const run = randomUUID().slice(0, 8);
const MBID = `test-rr-${run}`;
const MIN = 60 * 1000;

// Base a couple of minutes ahead of now; if the 10-minute test window would
// straddle UTC midnight, push past it so every spin shares one broadcast day.
let base = Date.now() + 2 * MIN;
if (
  new Date(base).toISOString().slice(0, 10) !==
  new Date(base + 10 * MIN).toISOString().slice(0, 10)
) {
  base += 20 * MIN;
}
const DAY = new Date(base).toISOString().slice(0, 10);

let dbAvailable = false;
let stationIds: number[] = [];
let showIds: number[] = [];
let server: Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const stations = await db
    .insert(stationsTable)
    .values([
      {
        slug: `test-rr-a-${run}`,
        name: `Test RR A ${run}`,
        streamUrl: "http://example.invalid/a",
        stationClass: "curated",
      },
      {
        slug: `test-rr-b-${run}`,
        name: `Test RR B ${run}`,
        streamUrl: "http://example.invalid/b",
        stationClass: "community",
      },
    ])
    .returning({ id: stationsTable.id });
  stationIds = stations.map((s) => s.id);
  const [stationA, stationB] = stationIds as [number, number];

  const shows = await db
    .insert(showsTable)
    .values([
      { stationId: stationA, name: `Test Show A ${run}`, djName: "DJ Alpha" },
      { stationId: stationB, name: `Test Show B ${run}`, djName: "DJ Beta" },
    ])
    .returning({ id: showsTable.id });
  showIds = shows.map((s) => s.id);
  const [showA, showB] = showIds as [number, number];

  await db
    .insert(recordingsTable)
    .values([{ mbid: MBID, title: "RR", artist: `Test RR ${run}` }]);

  await db.insert(spinsTable).values([
    // Run a1 — station A, no show: 2 spins (1 resolved).
    {
      stationId: stationA,
      mbid: MBID,
      confidence: "text",
      rawArtist: "x",
      rawTitle: "x",
      playedAt: new Date(base),
    },
    {
      stationId: stationA,
      mbid: null,
      confidence: "unresolved",
      rawArtist: "y",
      rawTitle: "y",
      playedAt: new Date(base + 1 * MIN),
    },
    // Run a2 — SAME station A, but attributed to a show: must split off (show
    // is part of the grouping key). Newest play but fully unresolved.
    {
      stationId: stationA,
      showId: showA,
      mbid: null,
      confidence: "unresolved",
      rawArtist: "z",
      rawTitle: "z",
      playedAt: new Date(base + 3 * MIN),
    },
    // Run b1 — station B with its show: splits by station. Middle recency.
    {
      stationId: stationB,
      showId: showB,
      mbid: MBID,
      confidence: "text",
      rawArtist: "w",
      rawTitle: "w",
      playedAt: new Date(base + 2 * MIN),
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
  if (!dbAvailable || stationIds.length === 0) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  if (showIds.length) {
    await db.delete(showsTable).where(inArray(showsTable.id, showIds));
  }
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID]));
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
});

describe("GET /api/archive/recent-runs", () => {
  it("groups by station + show + UTC day with correct counts, attribution, and order", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/archive/recent-runs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        station: { slug: string; name: string; stationClass: string };
        run: {
          runId: number;
          date: string;
          show: { name: string; djName?: string | null } | null;
          spinCount: number;
          resolvedCount: number;
          startedAt: string;
          endedAt: string;
        };
      }[];
    };

    const mine = body.items.filter(
      (i) =>
        i.station.slug.startsWith("test-rr-") && i.station.slug.endsWith(run),
    );
    expect(mine).toHaveLength(3);
    for (const item of mine) expect(item.run.date).toBe(DAY);

    const a1 = mine.find(
      (i) => i.station.slug === `test-rr-a-${run}` && i.run.show === null,
    );
    expect(a1).toBeDefined();
    expect(a1!.run.spinCount).toBe(2);
    expect(a1!.run.resolvedCount).toBe(1);
    expect(a1!.run.startedAt).toBe(new Date(base).toISOString());
    expect(a1!.run.endedAt).toBe(new Date(base + 1 * MIN).toISOString());

    const a2 = mine.find(
      (i) => i.station.slug === `test-rr-a-${run}` && i.run.show !== null,
    );
    expect(a2).toBeDefined();
    expect(a2!.run.spinCount).toBe(1);
    expect(a2!.run.resolvedCount).toBe(0);
    expect(a2!.run.show).toEqual({ name: `Test Show A ${run}`, djName: "DJ Alpha" });

    const b1 = mine.find((i) => i.station.slug === `test-rr-b-${run}`);
    expect(b1).toBeDefined();
    expect(b1!.run.spinCount).toBe(1);
    expect(b1!.run.resolvedCount).toBe(1);
    expect(b1!.run.show).toEqual({ name: `Test Show B ${run}`, djName: "DJ Beta" });
    expect(b1!.station.stationClass).toBe("community");

    // Distinct runs carry distinct anchor ids (min spin id per group).
    const ids = new Set(mine.map((i) => i.run.runId));
    expect(ids.size).toBe(3);

    // Quality-aware ranking: same broadcast day, so resolution ratio decides —
    // b1 (1/1) > a1 (1/2) > a2 (0/1) — even though a2 has the newest play.
    const order = mine.map((i) => i.run.runId);
    expect(order).toEqual([b1!.run.runId, a1!.run.runId, a2!.run.runId]);
  });
});
