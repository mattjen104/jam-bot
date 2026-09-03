import { beforeAll, describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import {
  db,
  radioBrowserStationsTable,
  stationsTable,
} from "@workspace/db";
import { ensureIcyHealthRows, seedStations } from "../src/lore/seed.js";

let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }
  await seedStations();
  await ensureIcyHealthRows();
}, 90_000);

describe("instrumental specialist seed", () => {
  it("converges on one station and one ICY health identity", async () => {
    if (!dbAvailable) return;
    const [first] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.slug, "nightride-chillsynth"))
      .limit(1);
    expect(first).toBeTruthy();

    await seedStations();
    await ensureIcyHealthRows();

    const [stationCount] = await db
      .select({ value: count() })
      .from(stationsTable)
      .where(eq(stationsTable.slug, "nightride-chillsynth"));
    const [healthCount] = await db
      .select({ value: count() })
      .from(radioBrowserStationsTable)
      .where(eq(
        radioBrowserStationsTable.radioBrowserUuid,
        "manual-nightride-chillsynth",
      ));
    const [second] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.slug, "nightride-chillsynth"))
      .limit(1);

    expect(stationCount?.value).toBe(1);
    expect(healthCount?.value).toBe(1);
    expect(second?.id).toBe(first?.id);
    expect(second?.nowPlayingConfig).toMatchObject({
      instrumentalClaim: true,
      evidenceUrl: "https://nightride.fm/",
      radioBrowserId: expect.any(Number),
    });
  }, 90_000);
});