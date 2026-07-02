import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  recordingsTable,
  spinsTable,
  segueEdgesTable,
} from "@workspace/db";
import { runSegueDerivation } from "../src/lore/segue.js";

/**
 * Integration test for the DB-row selection half of segue derivation — the part
 * `deriveEdges` unit tests can't reach. It guards the specific regression where
 * `runSegueDerivation` pre-filtered `mbid IS NOT NULL`, which hid unresolved
 * spins so a hole between two resolved plays no longer broke the chain and a
 * false A->B edge was forged. Fully isolated (unique station + MBIDs) and
 * cleaned up. Skips gracefully when no real database is reachable (the rest of
 * the suite is pure-unit and uses a dummy DATABASE_URL).
 */
const run = randomUUID().slice(0, 8);
const A = `test-seg-A-${run}`;
const B = `test-seg-B-${run}`;
const C = `test-seg-C-${run}`;
const D = `test-seg-D-${run}`;
const MBIDS = [A, B, C, D];
const MIN = 60 * 1000;
const base = new Date("2020-01-01T00:00:00Z").getTime();

let dbAvailable = false;
let stationId: number | undefined;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return; // no real DB in this environment — tests below self-skip
  }

  const [st] = await db
    .insert(stationsTable)
    .values({
      slug: `test-seg-${run}`,
      name: `Test Segue ${run}`,
      streamUrl: "http://example.invalid/stream",
      stationClass: "curated",
    })
    .returning({ id: stationsTable.id });
  stationId = st!.id;

  await db.insert(recordingsTable).values([
    { mbid: A, title: "A", artist: "Test" },
    { mbid: B, title: "B", artist: "Test" },
    { mbid: C, title: "C", artist: "Test" },
    { mbid: D, title: "D", artist: "Test" },
  ]);

  await db.insert(spinsTable).values([
    // Hole sequence: A -> (unresolved) -> B, all within the segue gap. The
    // unresolved middle must break the chain, so NO A->B edge may be derived.
    { stationId, mbid: A, confidence: "text", playedAt: new Date(base + 0 * MIN) },
    { stationId, mbid: null, rawArtist: "?", rawTitle: "?", confidence: "unresolved", playedAt: new Date(base + 2 * MIN) },
    { stationId, mbid: B, confidence: "text", playedAt: new Date(base + 4 * MIN) },
    // Positive control: C -> D consecutive resolved within the gap (and >10min
    // after B so no stray edge bridges the two groups) => a C->D edge IS derived.
    { stationId, mbid: C, confidence: "text", playedAt: new Date(base + 20 * MIN) },
    { stationId, mbid: D, confidence: "text", playedAt: new Date(base + 23 * MIN) },
  ]);

  await runSegueDerivation();
});

afterAll(async () => {
  if (!dbAvailable || stationId === undefined) return;
  await db.delete(segueEdgesTable).where(eq(segueEdgesTable.stationId, stationId));
  await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, MBIDS));
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
});

describe("runSegueDerivation (DB row selection)", () => {
  it("does not forge an edge across an unresolved middle spin", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const forged = await db
      .select()
      .from(segueEdgesTable)
      .where(
        and(
          eq(segueEdgesTable.stationId, stationId!),
          eq(segueEdgesTable.fromMbid, A),
          eq(segueEdgesTable.toMbid, B),
        ),
      );
    expect(forged).toHaveLength(0);
  });

  it("derives an edge between two consecutive resolved spins", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const edge = await db
      .select()
      .from(segueEdgesTable)
      .where(
        and(
          eq(segueEdgesTable.stationId, stationId!),
          eq(segueEdgesTable.fromMbid, C),
          eq(segueEdgesTable.toMbid, D),
        ),
      );
    expect(edge).toHaveLength(1);
  });

  it("is idempotent — a second run adds no duplicate edges", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const before = await db
      .select({ id: segueEdgesTable.id })
      .from(segueEdgesTable)
      .where(eq(segueEdgesTable.stationId, stationId!));
    await runSegueDerivation();
    const after = await db
      .select({ id: segueEdgesTable.id })
      .from(segueEdgesTable)
      .where(eq(segueEdgesTable.stationId, stationId!));
    expect(after.length).toBe(before.length);
  });
});
