// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  spinsTable,
  recordingsTable,
  type Station,
} from "@workspace/db";
import { fetchPlaysUntilCursor } from "../src/lore/poller.js";
import { ingestRawSpins } from "../src/lore/resolve.js";
import type { RawSpin, HistoryAdapter } from "../src/lore/types.js";

/**
 * DB-backed integration test for the poller-restart contract.
 *
 * Guards the property described in the task: fetchPlaysUntilCursor pages back
 * to the cursor that was persisted in the DB before a restart, and
 * ingestRawSpins correctly ingests only the spins newer than that cursor
 * without duplicating the ones that were already logged.
 *
 * Two scenarios:
 *   A) Station has a known lastSeenCursor (mid-show restart) — only new spins
 *      are ingested; the cursor advances to the newest spin.
 *   B) Station has no cursor (first enroll after restart / null cursor) — the
 *      full bounded backfill window is ingested and the cursor is set.
 *
 * Spins carry recordingId so resolution is the free recording_id path and
 * no MusicBrainz traffic happens. Recording rows are pre-seeded with links so
 * upsertRecording sees them present and skips outbound link fetches.
 * Fully isolated (unique run IDs) and cleaned up; skips when no real DB.
 */

const run = randomUUID().slice(0, 8);
const REC_A = `test-restart-a-${run}`;
const REC_B = `test-restart-b-${run}`;
const REC_C = `test-restart-c-${run}`;
const REC_D = `test-restart-d-${run}`;
const ALL_MBIDS = [REC_A, REC_B, REC_C, REC_D];

const SLUG_MID = `test-restart-mid-${run}`;
const SLUG_NULL = `test-restart-null-${run}`;

// externalIds in newest-first order (what a history adapter returns)
const EXT_A = `ext-a-${run}`; // oldest — was already polled before restart
const EXT_B = `ext-b-${run}`; // second
const EXT_C = `ext-c-${run}`; // third
const EXT_D = `ext-d-${run}`; // newest — arrived after restart

let dbAvailable = false;
let stationMid: Station | undefined; // station with a known cursor (EXT_A)
let stationNull: Station | undefined; // station with no cursor (null)

function spin(
  externalId: string,
  recordingId: string,
  playedAt: Date,
  title: string,
): RawSpin {
  return {
    rawArtist: `Restart Act ${run}`,
    rawTitle: title,
    externalId,
    recordingId,
    playedAt,
  };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Pre-seed recordings with links so enrichment never calls outbound APIs.
  await db.insert(recordingsTable).values(
    ALL_MBIDS.map((mbid, i) => ({
      mbid,
      title: `Restart Track ${i}`,
      artist: `Restart Act ${run}`,
      links: [{ platform: "spotify", url: "https://example.com/x" }],
    })),
  );

  // Station A: had a previous poll that logged EXT_A; cursor set to EXT_A.
  const [rowMid] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG_MID,
      name: `Restart Mid ${run}`,
      streamUrl: "https://example.invalid/stream-mid",
      nowPlayingSource: "kexp_api",
      lastSeenCursor: EXT_A,
    })
    .returning();
  stationMid = rowMid;

  // Pre-insert the already-polled spin for EXT_A so the DB state matches a
  // real mid-show scenario (cursor exists AND the corresponding spin row exists).
  const t0 = new Date(Date.UTC(2025, 0, 1, 12, 0, 0));
  await db.insert(spinsTable).values({
    stationId: stationMid!.id,
    mbid: REC_A,
    rawArtist: `Restart Act ${run}`,
    rawTitle: "Restart Track 0",
    confidence: "recording_id",
    externalId: EXT_A,
    source: "kexp_api",
    playedAt: t0,
  });

  // Station B: freshly enrolled — no cursor, no prior spins.
  const [rowNull] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG_NULL,
      name: `Restart Null ${run}`,
      streamUrl: "https://example.invalid/stream-null",
      nowPlayingSource: "kexp_api",
    })
    .returning();
  stationNull = rowNull;
});

afterAll(async () => {
  if (!dbAvailable) return;
  const ids = [stationMid?.id, stationNull?.id].filter((v): v is number => v != null);
  if (ids.length) {
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, ids));
    await db.delete(stationsTable).where(inArray(stationsTable.id, ids));
  }
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, ALL_MBIDS));
});

// ---- Scenario A: mid-show restart with persisted cursor --------------------

describe("poller restart with known cursor (mid-show)", () => {
  /**
   * Fake adapter: returns 4 spins newest-first (EXT_D → EXT_C → EXT_B → EXT_A).
   * This matches what a real source hands the poller after downtime — the full
   * recent window including the already-seen EXT_A at the tail.
   */
  function buildAdapter(
    spinsNewestFirst: RawSpin[],
    pageSize = 10,
  ): HistoryAdapter {
    return async (_config, opts) => {
      const page = opts?.page ?? 0;
      const limit = opts?.limit ?? pageSize;
      return spinsNewestFirst.slice(page * limit, page * limit + limit);
    };
  }

  it("reads the persisted cursor from the DB and pages only to that cursor", async (ctx) => {
    if (!dbAvailable || !stationMid) return ctx.skip();

    // Reload the station from the DB — this is what pollStation does at the
    // start of every tick so it sees the cursor the previous run persisted.
    const [fresh] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, stationMid.id));
    expect(fresh!.lastSeenCursor).toBe(EXT_A);

    const t = (m: number) => new Date(Date.UTC(2025, 0, 1, 12, m, 0));
    const feedNewestFirst: RawSpin[] = [
      spin(EXT_D, REC_D, t(30), "Restart Track 3"),
      spin(EXT_C, REC_C, t(20), "Restart Track 2"),
      spin(EXT_B, REC_B, t(10), "Restart Track 1"),
      spin(EXT_A, REC_A, t(0), "Restart Track 0"), // the cursor — already logged
    ];

    const adapter = buildAdapter(feedNewestFirst);
    const collected = await fetchPlaysUntilCursor(
      adapter,
      {},
      fresh!.lastSeenCursor ?? null,
      200,
      10,
    );

    // fetchPlaysUntilCursor stops when it finds the cursor in the page.
    // It returns the whole page (including the cursor itself) so the ingest
    // path can dedup it — we must not lose EXT_B or EXT_C.
    expect(collected.some((s) => s.externalId === EXT_A)).toBe(true);
    expect(collected.some((s) => s.externalId === EXT_B)).toBe(true);
    expect(collected.some((s) => s.externalId === EXT_C)).toBe(true);
    expect(collected.some((s) => s.externalId === EXT_D)).toBe(true);
  });

  it("ingests only spins newer than the cursor — no drops, no duplicates", async (ctx) => {
    if (!dbAvailable || !stationMid) return ctx.skip();

    const [fresh] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, stationMid.id));

    const t = (m: number) => new Date(Date.UTC(2025, 0, 1, 12, m, 0));
    const feedNewestFirst: RawSpin[] = [
      spin(EXT_D, REC_D, t(30), "Restart Track 3"),
      spin(EXT_C, REC_C, t(20), "Restart Track 2"),
      spin(EXT_B, REC_B, t(10), "Restart Track 1"),
      spin(EXT_A, REC_A, t(0), "Restart Track 0"),
    ];

    const adapter = buildAdapter(feedNewestFirst);
    const collected = await fetchPlaysUntilCursor(
      adapter,
      {},
      fresh!.lastSeenCursor ?? null,
      200,
      10,
    );

    const ingested = await ingestRawSpins(fresh!, collected, "kexp_api");

    // EXT_A was already in the DB → deduplicated; EXT_B, EXT_C, EXT_D are new.
    expect(ingested).toBe(3);

    // Verify no duplicate rows for EXT_A.
    const rowsA = await db
      .select()
      .from(spinsTable)
      .where(
        eq(spinsTable.stationId, stationMid.id),
      );
    const extARows = rowsA.filter((r) => r.externalId === EXT_A);
    expect(extARows.length).toBe(1);

    // All four external IDs must appear exactly once.
    for (const extId of [EXT_A, EXT_B, EXT_C, EXT_D]) {
      const matching = rowsA.filter((r) => r.externalId === extId);
      expect(matching.length).toBe(1);
    }

    // Total spin count for the station is exactly 4 (1 pre-existing + 3 new).
    expect(rowsA.length).toBe(4);
  });

  it("advances lastSeenCursor to the newest spin after ingestion", async (ctx) => {
    if (!dbAvailable || !stationMid) return ctx.skip();

    // The previous test already ran ingestRawSpins — reload to verify cursor.
    const [after] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, stationMid.id));

    // The cursor must have advanced to EXT_D (the newest spin's externalId).
    expect(after!.lastSeenCursor).toBe(EXT_D);
  });

  it("a second poll tick does not duplicate any spin (steady-state after restart)", async (ctx) => {
    if (!dbAvailable || !stationMid) return ctx.skip();

    // Reload: cursor is now EXT_D after the previous tick.
    const [fresh] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, stationMid.id));
    expect(fresh!.lastSeenCursor).toBe(EXT_D);

    const t = (m: number) => new Date(Date.UTC(2025, 0, 1, 12, m, 0));
    // Same feed — no new spins have arrived since the last tick.
    const feedNewestFirst: RawSpin[] = [
      spin(EXT_D, REC_D, t(30), "Restart Track 3"),
      spin(EXT_C, REC_C, t(20), "Restart Track 2"),
      spin(EXT_B, REC_B, t(10), "Restart Track 1"),
      spin(EXT_A, REC_A, t(0), "Restart Track 0"),
    ];

    const adapter = buildAdapter(feedNewestFirst);
    const collected = await fetchPlaysUntilCursor(
      adapter,
      {},
      fresh!.lastSeenCursor ?? null,
      200,
      10,
    );
    // Cursor is on the FIRST item returned by the adapter — paging stops
    // immediately (one page fetch) and the collected batch contains EXT_D.
    expect(collected.some((s) => s.externalId === EXT_D)).toBe(true);

    const ingested = await ingestRawSpins(fresh!, collected, "kexp_api");
    // Nothing new — all are already in the DB.
    expect(ingested).toBe(0);

    // Row count must still be exactly 4.
    const rows = await db
      .select()
      .from(spinsTable)
      .where(eq(spinsTable.stationId, stationMid.id));
    expect(rows.length).toBe(4);
  });
});

// ---- Scenario B: null cursor (first enroll after restart) -----------------

describe("poller restart with null cursor (first enroll / fresh station)", () => {
  it("performs a bounded backfill and sets the cursor to the newest spin", async (ctx) => {
    if (!dbAvailable || !stationNull) return ctx.skip();

    const [fresh] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, stationNull.id));
    expect(fresh!.lastSeenCursor).toBeNull();

    const t = (m: number) => new Date(Date.UTC(2025, 0, 1, 13, m, 0));
    // Adapter returns EXT_B and EXT_A (a bounded two-spin backfill window).
    // Uses unique external IDs scoped to the null-cursor station so there is
    // no overlap with the mid-show station's spins.
    const EXT_NULL_B = `ext-null-b-${run}`;
    const EXT_NULL_A = `ext-null-a-${run}`;
    const feedNewestFirst: RawSpin[] = [
      spin(EXT_NULL_B, REC_B, t(5), "Restart Track 1"),
      spin(EXT_NULL_A, REC_A, t(0), "Restart Track 0"),
    ];

    const adapter: HistoryAdapter = async (_config, opts) => {
      const page = opts?.page ?? 0;
      const limit = opts?.limit ?? 10;
      return feedNewestFirst.slice(page * limit, page * limit + limit);
    };

    // null cursor → fetchPlaysUntilCursor pages the bounded backfill window.
    const collected = await fetchPlaysUntilCursor(adapter, {}, null, 200, 10);
    expect(collected.length).toBe(2);

    const ingested = await ingestRawSpins(fresh!, collected, "kexp_api");
    expect(ingested).toBe(2);

    // Cursor must be set to the newest externalId after first-enroll ingest.
    const [after] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, stationNull.id));
    expect(after!.lastSeenCursor).toBe(EXT_NULL_B);

    // Both spins landed with no duplicates.
    const rows = await db
      .select()
      .from(spinsTable)
      .where(eq(spinsTable.stationId, stationNull.id));
    expect(rows.length).toBe(2);
  });
});
