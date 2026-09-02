import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  stationSourceQualityTable,
} from "@workspace/db";
import {
  emptyMetadataOutcomeCounts,
  recordMetadataQuality,
  type MetadataOutcomeCounts,
} from "../src/lore/metadata-quality.js";
import { applyStationSourceQualityMigration } from "../src/lore/source-quality-migration.js";

const run = randomUUID().slice(0, 8);
let dbAvailable = false;
let stationId: number | null = null;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    await applyStationSourceQualityMigration();
    const [station] = await db
      .insert(stationsTable)
      .values({
        slug: `test-source-quality-${run}`,
        name: `Source Quality ${run}`,
        streamUrl: `https://source-quality-${run}.example.test/live`,
        nowPlayingSource: "station_page",
        nowPlayingConfig: {},
      })
      .returning({ id: stationsTable.id });
    stationId = station!.id;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (!dbAvailable || stationId == null) return;
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
});

describe("station source quality persistence", () => {
  it("keeps timestamps and rolling counts across multiple attempts", async (ctx) => {
    if (!dbAvailable || stationId == null) return ctx.skip();
    const first = new Date("2026-09-02T12:00:00Z");
    const second = new Date("2026-09-02T12:01:00Z");

    await recordMetadataQuality({
      stationId,
      source: "station_page",
      capability: "current_track_api",
      outcomes: ["response_error"],
      responded: false,
      detail: "503 upstream",
      at: first,
    });
    await recordMetadataQuality({
      stationId,
      source: "station_page",
      capability: "current_track_api",
      outcomes: ["usable_pair", "written_spin"],
      responded: true,
      artist: "Nina Simone",
      title: "Sinnerman",
      at: second,
    });

    const [row] = await db
      .select()
      .from(stationSourceQualityTable)
      .where(
        and(
          eq(stationSourceQualityTable.stationId, stationId),
          eq(stationSourceQualityTable.source, "station_page"),
        ),
      );
    expect(row?.lastAttemptAt).toEqual(second);
    expect(row?.lastResponseAt).toEqual(second);
    expect(row?.lastUsableAt).toEqual(second);
    expect(row?.lastUsableArtist).toBe("Nina Simone");
    expect(row?.lastUsableTitle).toBe("Sinnerman");
    const counts = {
      ...emptyMetadataOutcomeCounts(),
      ...(row?.outcomeCounts as Partial<MetadataOutcomeCounts>),
    };
    expect(counts.response_error).toBe(1);
    expect(counts.usable_pair).toBe(1);
    expect(counts.written_spin).toBe(1);
  });

  it("does not lose counts when writers finish concurrently", async (ctx) => {
    if (!dbAvailable || stationId == null) return ctx.skip();
    const at = new Date("2026-09-02T12:02:00Z");
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        recordMetadataQuality({
          stationId: stationId!,
          source: "station_page",
          capability: "current_track_api",
          outcomes: [index % 2 === 0 ? "empty_metadata" : "response_error"],
          responded: index % 2 === 0,
          at,
        }),
      ),
    );
    const [row] = await db
      .select()
      .from(stationSourceQualityTable)
      .where(
        and(
          eq(stationSourceQualityTable.stationId, stationId),
          eq(stationSourceQualityTable.source, "station_page"),
        ),
      );
    const counts = {
      ...emptyMetadataOutcomeCounts(),
      ...(row?.outcomeCounts as Partial<MetadataOutcomeCounts>),
    };
    expect(counts.empty_metadata).toBe(6);
    expect(counts.response_error).toBe(7);
  });

  it("does not label an initial incomplete observation as usable", async (ctx) => {
    if (!dbAvailable || stationId == null) return ctx.skip();
    await recordMetadataQuality({
      stationId,
      source: "initial_incomplete_test",
      capability: "current_track_api",
      outcomes: ["incomplete_pair"],
      responded: true,
      artist: "Nina Simone",
      title: null,
      at: new Date("2026-09-02T12:03:00Z"),
    });
    const [row] = await db
      .select()
      .from(stationSourceQualityTable)
      .where(
        and(
          eq(stationSourceQualityTable.stationId, stationId),
          eq(stationSourceQualityTable.source, "initial_incomplete_test"),
        ),
      );
    expect(row?.lastUsableAt).toBeNull();
    expect(row?.lastUsableArtist).toBeNull();
    expect(row?.lastUsableTitle).toBeNull();
  });
});