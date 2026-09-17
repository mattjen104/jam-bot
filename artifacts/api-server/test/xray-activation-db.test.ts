import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, stationsTable } from "@workspace/db";
import {
  RESTORED_VISIBLE_SEED_STATION_SLUGS,
  seedStations,
} from "../src/lore/seed.js";

let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }
  await seedStations();
}, 90_000);

afterAll(async () => {
  if (!dbAvailable) return;
  await seedStations();
});

describe("XRAY.fm reviewed activation", () => {
  it("keeps the existing curated identity and playable ICY source", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const [station] = await db
      .select({
        slug: stationsTable.slug,
        name: stationsTable.name,
        source: stationsTable.source,
        streamUrl: stationsTable.streamUrl,
        nowPlayingSource: stationsTable.nowPlayingSource,
        nowPlayingConfig: stationsTable.nowPlayingConfig,
      })
      .from(stationsTable)
      .where(eq(stationsTable.slug, "xray-fm"))
      .limit(1);

    expect(station).toMatchObject({
      slug: "xray-fm",
      name: "XRAY.fm",
      source: "curated",
      streamUrl: "https://listen.xray.fm/stream",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: expect.objectContaining({
        streamUrl: "https://listen.xray.fm/stream",
      }),
    });
  });

  it("restores catalog eligibility and clears stale automatic-cull evidence on reseed", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    expect(RESTORED_VISIBLE_SEED_STATION_SLUGS.has("xray-fm")).toBe(true);

    await db
      .update(stationsTable)
      .set({
        active: false,
        hidden: true,
        automaticCullReason: "duplicate_stream",
        automaticCullCanonicalStationId: null,
      })
      .where(eq(stationsTable.slug, "xray-fm"));

    await seedStations();

    const [station] = await db
      .select({
        active: stationsTable.active,
        hidden: stationsTable.hidden,
        crossingEligible: stationsTable.crossingEligible,
        automaticCullReason: stationsTable.automaticCullReason,
        automaticCullCanonicalStationId:
          stationsTable.automaticCullCanonicalStationId,
      })
      .from(stationsTable)
      .where(eq(stationsTable.slug, "xray-fm"))
      .limit(1);

    expect(station).toEqual({
      active: true,
      hidden: false,
      crossingEligible: true,
      automaticCullReason: null,
      automaticCullCanonicalStationId: null,
    });
  });
});