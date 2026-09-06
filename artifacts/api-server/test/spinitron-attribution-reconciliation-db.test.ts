// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  showsTable,
  spinsTable,
  stationsTable,
  type Station,
} from "@workspace/db";
import { fetchPlaysUntilCursor } from "../src/lore/poller.js";
import { ingestRawSpins, logSpinIfChanged } from "../src/lore/resolve.js";
import type { HistoryAdapter, RawSpin } from "../src/lore/types.js";

const run = randomUUID().slice(0, 8);
let available = false;
let station: Station | null = null;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    available = true;
  } catch {
    return;
  }
  [station] = await db
    .insert(stationsTable)
    .values({
      slug: `spinitron-attribution-${run}`,
      name: `Spinitron attribution ${run}`,
      streamUrl: "https://example.invalid/stream",
      nowPlayingSource: "spinitron",
      nowPlayingConfig: { accessToken: "test-only" },
      ianaTimezone: "UTC",
    })
    .returning();
});

afterAll(async () => {
  if (!available || !station) return;
  await db.delete(spinsTable).where(eq(spinsTable.stationId, station.id));
  await db.delete(showsTable).where(eq(showsTable.stationId, station.id));
  // Ingestion emits append-only timeline evidence linked to the station.
  // Retire the fixture instead of trying to mutate/delete that audit record.
  await db
    .update(stationsTable)
    .set({ active: false, hidden: true })
    .where(eq(stationsTable.id, station.id));
});

describe("Spinitron attribution reconciliation", () => {
  it("fills attribution on an already-ingested history row without duplicating it", async (ctx) => {
    if (!available || !station) return ctx.skip();
    const externalId = `spinitron:${run}:history`;
    const raw = {
      rawArtist: `History artist ${run}`,
      rawTitle: `History title ${run}`,
      recordingId: `recording-${run}-history`,
      externalId,
      playedAt: new Date("2026-09-01T10:00:00Z"),
    };

    expect(
      await ingestRawSpins(station, [raw], "spinitron", { backfill: true }),
    ).toBe(1);
    expect(
      await ingestRawSpins(
        station,
        [
          {
            ...raw,
            show: {
              name: `History show ${run}`,
              djName: "DJ Valid",
              attributionSource: "source_api" as const,
            },
          },
        ],
        "spinitron",
        { backfill: true },
      ),
    ).toBe(0);

    const rows = await db
      .select({
        showName: showsTable.name,
        djName: showsTable.djName,
        source: spinsTable.showAttributionSource,
      })
      .from(spinsTable)
      .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
      .where(
        and(
          eq(spinsTable.stationId, station.id),
          eq(spinsTable.externalId, externalId),
        ),
      );
    expect(rows).toEqual([
      {
        showName: `History show ${run}`,
        djName: "DJ Valid",
        source: "source_api",
      },
    ]);
  }, 300_000);

  it("updates a same-track show boundary without inserting another spin", async (ctx) => {
    if (!available || !station) return ctx.skip();
    const rawArtist = `Boundary artist ${run}`;
    const rawTitle = `Boundary title ${run}`;
    const externalId = `spinitron:${run}:boundary`;
    await ingestRawSpins(
      station,
      [
        {
          rawArtist,
          rawTitle,
          recordingId: `recording-${run}-boundary`,
          externalId,
          playedAt: new Date(),
          show: {
            name: `Before boundary ${run}`,
            attributionSource: "source_api",
          },
        },
      ],
      "spinitron",
      { backfill: true },
    );

    expect(
      await logSpinIfChanged(station, {
        rawArtist,
        rawTitle,
        show: {
          name: `After boundary ${run}`,
          djName: "DJ Boundary",
          attributionSource: "source_api",
        },
      }),
    ).toBe(false);

    const rows = await db
      .select({
        showName: showsTable.name,
        djName: showsTable.djName,
      })
      .from(spinsTable)
      .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
      .where(
        and(
          eq(spinsTable.stationId, station.id),
          eq(spinsTable.externalId, externalId),
        ),
      );
    expect(rows).toEqual([
      { showName: `After boundary ${run}`, djName: "DJ Boundary" },
    ]);
  }, 300_000);

  it("preserves the cursor across a partial history failure and recovers on retry", async (ctx) => {
    if (!available || !station) return ctx.skip();
    const priorCursor = `spinitron:${run}:prior-cursor`;
    const newestId = `spinitron:${run}:retry-newest`;
    const middleId = `spinitron:${run}:retry-middle`;
    await db
      .update(stationsTable)
      .set({ lastSeenCursor: priorCursor })
      .where(eq(stationsTable.id, station.id));

    const page0: RawSpin[] = [
      {
        rawArtist: `Retry artist ${run}`,
        rawTitle: "Newest",
        recordingId: `recording-${run}-retry-newest`,
        externalId: newestId,
        playedAt: new Date("2026-09-02T10:02:00Z"),
      },
      {
        rawArtist: `Retry artist ${run}`,
        rawTitle: "Middle",
        recordingId: `recording-${run}-retry-middle`,
        externalId: middleId,
        playedAt: new Date("2026-09-02T10:01:00Z"),
      },
    ];
    const failingAdapter: HistoryAdapter = async (_config, options) => {
      if ((options?.page ?? 0) === 0) return page0;
      throw new Error("temporary playlist attribution failure");
    };

    const incomplete = await fetchPlaysUntilCursor(
      failingAdapter,
      {},
      priorCursor,
      20,
      2,
    );
    expect(incomplete).toEqual([]);
    await ingestRawSpins(station, incomplete, "spinitron");
    let [persisted] = await db
      .select({ lastSeenCursor: stationsTable.lastSeenCursor })
      .from(stationsTable)
      .where(eq(stationsTable.id, station.id));
    expect(persisted?.lastSeenCursor).toBe(priorCursor);

    const successfulAdapter: HistoryAdapter = async (_config, options) => {
      const page = options?.page ?? 0;
      if (page === 0) return page0;
      if (page === 1) {
        return [
          {
            rawArtist: `Retry artist ${run}`,
            rawTitle: "Prior cursor",
            recordingId: `recording-${run}-retry-prior`,
            externalId: priorCursor,
            playedAt: new Date("2026-09-02T10:00:00Z"),
            show: {
              name: `Recovered show ${run}`,
              djName: "DJ Recovered",
              attributionSource: "source_api",
            },
          },
        ];
      }
      return [];
    };
    const recovered = await fetchPlaysUntilCursor(
      successfulAdapter,
      {},
      priorCursor,
      20,
      2,
    );
    expect(recovered.map((spin) => spin.externalId)).toEqual([
      newestId,
      middleId,
      priorCursor,
    ]);
    const [freshStation] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, station.id));
    expect(freshStation?.lastSeenCursor).toBe(priorCursor);
    await ingestRawSpins(freshStation!, recovered, "spinitron");
    [persisted] = await db
      .select({ lastSeenCursor: stationsTable.lastSeenCursor })
      .from(stationsTable)
      .where(eq(stationsTable.id, station.id));
    expect(persisted?.lastSeenCursor).toBe(newestId);
  }, 300_000);
});