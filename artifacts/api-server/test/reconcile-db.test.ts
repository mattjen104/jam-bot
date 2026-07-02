import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  spinsTable,
  recordingsTable,
  type Station,
} from "@workspace/db";
import { ingestRawSpins } from "../src/lore/resolve.js";
import type { RawSpin } from "../src/lore/types.js";

/**
 * Integration test for the reconciliation ingest contract — the parts the
 * pure paging tests can't reach:
 *   - insert-only-missing: a sweep re-reads plays it already has plus plays it
 *     missed; only the missing ones become new spin rows (dedup by
 *     station+externalId);
 *   - reconcile mode NEVER advances `lastSeenCursor` — that cursor belongs to
 *     the live poller, and a gap-fill of OLDER plays must not yank it around;
 *   - contrast: the same ingest in live mode DOES advance the cursor.
 * Spins carry `recordingId`, so resolution is the free recording_id path and
 * no MusicBrainz traffic happens. Recording rows are pre-seeded WITH links so
 * enrichment sees them present and skips outbound link fetches.
 * Fully isolated (unique ids) and cleaned up; self-skips without a real DB.
 */
const run = randomUUID().slice(0, 8);
const REC_A = `test-reconcile-a-${run}`;
const REC_B = `test-reconcile-b-${run}`;
const REC_C = `test-reconcile-c-${run}`;
const MBIDS = [REC_A, REC_B, REC_C];

let dbAvailable = false;
let station: Station | undefined;

function raw(
  id: string,
  recordingId: string,
  playedAt: Date,
  title: string,
): RawSpin {
  return {
    rawArtist: `Reconcile Act ${run}`,
    rawTitle: title,
    playedAt,
    externalId: id,
    recordingId,
  } as RawSpin;
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // Pre-seed recordings WITH links so upsertRecording never fetches outbound.
  await db.insert(recordingsTable).values(
    MBIDS.map((mbid, i) => ({
      mbid,
      title: `Track ${i}`,
      artist: `Reconcile Act ${run}`,
      links: [{ platform: "spotify", url: "https://example.com/x" }],
    })),
  );

  const [row] = await db
    .insert(stationsTable)
    .values({
      slug: `test-reconcile-${run}`,
      name: `Reconcile Test ${run}`,
      streamUrl: "https://example.com/stream",
      nowPlayingSource: "kexp_api",
      lastSeenCursor: `live-cursor-${run}`,
    })
    .returning();
  station = row;
});

afterAll(async () => {
  if (!dbAvailable || !station) return;
  await db.delete(spinsTable).where(eq(spinsTable.stationId, station.id));
  await db.delete(stationsTable).where(eq(stationsTable.id, station.id));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, MBIDS));
});

describe("reconcile-mode ingest (DB)", () => {
  it("inserts only the missing plays and leaves lastSeenCursor untouched", async () => {
    if (!dbAvailable || !station) return;

    const t = (m: number) => new Date(Date.UTC(2024, 5, 1, 12, m));

    // The live poller already captured play A.
    const liveLogged = await ingestRawSpins(
      station,
      [raw(`e-a-${run}`, REC_A, t(0), "Track 0")],
      "kexp_api",
    );
    expect(liveLogged).toBe(1);

    // Live ingest advanced the cursor — reload so we contrast from there.
    let [fresh] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, station.id));
    expect(fresh!.lastSeenCursor).toBe(`e-a-${run}`);

    // The nightly sweep re-reads the window: A again (already have it) plus
    // B and C (missed during downtime).
    const inserted = await ingestRawSpins(
      fresh!,
      [
        raw(`e-a-${run}`, REC_A, t(0), "Track 0"),
        raw(`e-b-${run}`, REC_B, t(4), "Track 1"),
        raw(`e-c-${run}`, REC_C, t(8), "Track 2"),
      ],
      "kexp_api",
      { reconcile: true },
    );
    expect(inserted).toBe(2); // only B and C — A dedups

    // No duplicate rows for A; exactly one row per play.
    const rows = await db
      .select({ externalId: spinsTable.externalId, mbid: spinsTable.mbid })
      .from(spinsTable)
      .where(eq(spinsTable.stationId, station.id));
    expect(rows.length).toBe(3);
    expect(
      rows.filter((r) => r.externalId === `e-a-${run}`).length,
    ).toBe(1);
    // Reconciled spins resolved like live ones (recording_id path).
    expect(rows.every((r) => r.mbid != null)).toBe(true);

    // The safety contract: reconcile mode did NOT move the live cursor, even
    // though it ingested plays with newer externalIds.
    [fresh] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, station.id));
    expect(fresh!.lastSeenCursor).toBe(`e-a-${run}`);
  });

  it("a repeated sweep over the same window inserts nothing", async () => {
    if (!dbAvailable || !station) return;

    const t = (m: number) => new Date(Date.UTC(2024, 5, 1, 12, m));
    const again = await ingestRawSpins(
      station,
      [
        raw(`e-a-${run}`, REC_A, t(0), "Track 0"),
        raw(`e-b-${run}`, REC_B, t(4), "Track 1"),
        raw(`e-c-${run}`, REC_C, t(8), "Track 2"),
      ],
      "kexp_api",
      { reconcile: true },
    );
    expect(again).toBe(0);

    const [{ n }] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(spinsTable)
      .where(
        and(
          eq(spinsTable.stationId, station.id),
          inArray(spinsTable.externalId, [
            `e-a-${run}`,
            `e-b-${run}`,
            `e-c-${run}`,
          ]),
        ),
      )) as [{ n: number }];
    expect(n).toBe(3);
  });
});
