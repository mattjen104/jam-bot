// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  libraryItemsTable,
  loreUsersTable,
  pickersTable,
  recordingsTable,
  showsTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import {
  applyLibraryProvenanceBackfill,
} from "../src/lore/library-provenance-backfill.js";
import { applyMigrationCompletionsMigration } from "../src/lore/migration-completions-migration.js";

/**
 * The backfill is intentionally tested against the real joins and JSONB
 * storage. The suite skips when Postgres is unavailable (as do the other DB
 * integration suites).
 */
const run = randomUUID().slice(0, 8);
const LEDGER_KEY = "applyLibraryProvenanceBackfill";
const DEVICE_KEY = `library-prov-backfill-${run}`;
const MBID_A = `library-prov-a-${run}`;
const MBID_B = `library-prov-b-${run}`;
const MBID_C = `library-prov-c-${run}`;

let dbAvailable = false;
let userId: number | undefined;
let stationId: number | undefined;
let pickerId: number | undefined;
let showId: number | undefined;
let spinAId: number | undefined;
let spinBId: number | undefined;

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await applyMigrationCompletionsMigration();
  const [user] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: DEVICE_KEY })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBID_A, title: "Backfill A", artist: `Backfill Artist ${run}` },
    { mbid: MBID_B, title: "Backfill B", artist: `Backfill Artist ${run}` },
    { mbid: MBID_C, title: "Backfill C", artist: `Backfill Artist ${run}` },
  ]);
  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: `library-prov-station-${run}`,
      name: `Backfill Station ${run}`,
      streamUrl: "http://example.invalid/library-provenance-backfill",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  const [picker] = await db
    .insert(pickersTable)
    .values({
      pickerType: "dj",
      name: `Backfill DJ ${run}`,
      handle: `library-prov-picker-${run}`,
    })
    .returning({ id: pickersTable.id });
  pickerId = picker!.id;
  const [show] = await db
    .insert(showsTable)
    .values({
      stationId: stationId!,
      name: `Backfill Show ${run}`,
      djName: `Backfill DJ ${run}`,
      pickerId: pickerId!,
    })
    .returning({ id: showsTable.id });
  showId = show!.id;

  const spins = await db
    .insert(spinsTable)
    .values([
      {
        stationId: stationId!,
        showId: showId!,
        mbid: MBID_A,
        rawArtist: "Backfill Artist",
        rawTitle: "Backfill A",
        confidence: "recording_id",
        playedAt: new Date("2026-08-01T12:00:00.000Z"),
      },
      {
        stationId: stationId!,
        showId: showId!,
        mbid: MBID_B,
        rawArtist: "Backfill Artist",
        rawTitle: "Backfill B",
        confidence: "recording_id",
        playedAt: new Date("2026-08-01T13:00:00.000Z"),
      },
    ])
    .returning({ id: spinsTable.id });
  spinAId = spins[0]!.id;
  spinBId = spins[1]!.id;
}, 90_000);

beforeEach(async () => {
  if (!dbAvailable) return;
  await db.execute(sql`DELETE FROM migration_completions WHERE name = ${LEDGER_KEY}`);
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId!));
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId!));
  if (userId != null) {
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  if (spinAId != null && spinBId != null) {
    await db
      .delete(spinsTable)
      .where(inArray(spinsTable.id, [spinAId, spinBId]));
  }
  if (showId != null) await db.delete(showsTable).where(eq(showsTable.id, showId));
  if (pickerId != null) await db.delete(pickersTable).where(eq(pickersTable.id, pickerId));
  if (stationId != null) await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  await db
    .delete(recordingsTable)
    .where(inArray(recordingsTable.mbid, [MBID_A, MBID_B, MBID_C]));
  await db.execute(sql`DELETE FROM migration_completions WHERE name = ${LEDGER_KEY}`);
}, 90_000);

describe("applyLibraryProvenanceBackfill", () => {
  it("repairs attribution, counts disagreements, preserves context, and is idempotent", async (ctx) => {
    if (!dbAvailable || userId == null) return ctx.skip();

    const expectedA = {
      kind: "keep",
      surface: "library",
      entryPoint: "legacy-import",
      stationSlug: `library-prov-station-${run}`,
      stationName: `Backfill Station ${run}`,
      showName: `Backfill Show ${run}`,
      djName: `Backfill DJ ${run}`,
      pickerHandle: `library-prov-picker-${run}`,
      pickerName: `Backfill DJ ${run}`,
      playedAt: "2026-08-01T12:00:00.000Z",
    };
    const expectedB = { ...expectedA, playedAt: "2026-08-01T13:00:00.000Z" };

    await db.insert(libraryItemsTable).values([
      {
        userId,
        mbid: MBID_A,
        spinId: spinAId,
        provenance: {
          kind: "station",
          surface: "library",
          entryPoint: "legacy-import",
          stationSlug: "client-claimed-station",
          stationName: "Client Claimed Station",
          showName: "Client Claimed Show",
          playedAt: "2099-01-01T00:00:00.000Z",
          arbitrary: "remove me",
        },
      },
      {
        userId,
        mbid: MBID_B,
        spinId: spinBId,
        provenance: expectedB,
      },
      {
        userId,
        mbid: MBID_C,
        spinId: null,
        provenance: {
          kind: "keep",
          surface: "library",
          entryPoint: "direct",
          stationSlug: "stale-no-spin-attribution",
          showName: "stale",
          arbitrary: "remove me",
        },
      },
    ]);

    const first = await applyLibraryProvenanceBackfill({ _testUserIds: [userId] });
    expect(first).toEqual({
      processedRows: 3,
      spinLinkedRows: 2,
      noSpinRows: 1,
      updatedRows: 2,
      mismatchCount: 1,
    });

    const rows = await db
      .select({ mbid: libraryItemsTable.mbid, provenance: libraryItemsTable.provenance })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId));
    expect(rows).toHaveLength(3);
    const repaired = rows.find((row) => row.mbid === MBID_C)?.provenance;
    expect(repaired).toEqual({
      kind: "keep",
      surface: "library",
      entryPoint: "direct",
    });
    const linkedCorrect = rows.find((row) => row.mbid === MBID_B)?.provenance;
    expect(linkedCorrect).toEqual(expectedB);

    const second = await applyLibraryProvenanceBackfill({ _testUserIds: [userId] });
    expect(second).toEqual({
      processedRows: 0,
      spinLinkedRows: 0,
      noSpinRows: 0,
      updatedRows: 0,
      mismatchCount: 0,
    });
    const ledger = await db.execute(
      sql`SELECT name FROM migration_completions WHERE name = ${LEDGER_KEY}`,
    );
    expect(ledger.rows).toHaveLength(1);
  }, 90_000);
});