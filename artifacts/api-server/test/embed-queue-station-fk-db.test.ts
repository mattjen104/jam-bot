import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  embedResolutionQueueTable,
  recordingsTable,
  stationsTable,
} from "@workspace/db";

// Regression: embed_resolution_queue.station_id must be nullable with
// ON DELETE SET NULL. Before the fix, the Drizzle schema declared the
// column NOT NULL DEFAULT 0, so in a schema-built database deleting a
// station with pending embed-resolution jobs failed with 23502.
const run = randomUUID().slice(0, 8);
const mbid = `test-embed-queue-fk-${run}`;
const slug = `test-embed-queue-fk-${run}`;
let dbAvailable = false;
let stationId: number;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    await db.insert(recordingsTable).values({
      mbid,
      title: "Embed Queue FK Track",
      artist: "Embed Queue FK Artist",
    });
    const [station] = await db
      .insert(stationsTable)
      .values({
        slug,
        name: `Test EQFK ${run}`,
        streamUrl: "http://example.invalid/eqfk",
        stationClass: "community",
      })
      .returning({ id: stationsTable.id });
    stationId = station!.id;
    dbAvailable = true;
  } catch {
    // Database-backed suites are allowed to skip when DATABASE_URL is absent.
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db
    .delete(embedResolutionQueueTable)
    .where(eq(embedResolutionQueueTable.recordingMbid, mbid));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
  await db.delete(stationsTable).where(eq(stationsTable.slug, slug));
});

describe("embed_resolution_queue station FK", () => {
  it("clears the station reference (not fails) when the station is deleted", async () => {
    if (!dbAvailable) return;

    const [job] = await db
      .insert(embedResolutionQueueTable)
      .values({
        recordingMbid: mbid,
        provider: "bandcamp",
        role: "provenance",
        stationId,
        genreCluster: "test-cluster",
      })
      .returning({ id: embedResolutionQueueTable.id });

    // Deleting the station must succeed (SET NULL), not raise 23502.
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));

    const [after] = await db
      .select({
        stationId: embedResolutionQueueTable.stationId,
        genreCluster: embedResolutionQueueTable.genreCluster,
      })
      .from(embedResolutionQueueTable)
      .where(eq(embedResolutionQueueTable.id, job!.id));

    expect(after).toBeDefined();
    expect(after!.stationId).toBeNull();
    expect(after!.genreCluster).toBe("test-cluster");
  });
});
