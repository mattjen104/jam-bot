// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  scrapedShowsTable,
  showsTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import { applySpinShowAttributionMigration } from "../src/lore/spin-show-attribution-migration.js";
import { stampSpinShowIds } from "../src/lore/scraped-shows-sync.js";

const run = randomUUID().slice(0, 8);
const ADMIN_TOKEN = `show-provenance-${run}`;
process.env.LORE_ADMIN_TOKEN = ADMIN_TOKEN;

let available = false;
let stationId: number | null = null;
let directShowId: number | null = null;
let server: Server | null = null;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    available = true;
  } catch {
    return;
  }
  await applySpinShowAttributionMigration();
  const [station] = await db.insert(stationsTable).values({
    slug: `show-provenance-${run}`,
    name: `Show provenance ${run}`,
    streamUrl: "https://example.invalid/stream",
    ianaTimezone: "UTC",
  }).returning({ id: stationsTable.id });
  stationId = station!.id;
  const shows = await db.insert(showsTable).values([
    { stationId, name: `Direct ${run}` },
    { stationId, name: `Scheduled ${run}` },
  ]).returning({ id: showsTable.id, name: showsTable.name });
  directShowId = shows.find((show) => show.name === `Direct ${run}`)!.id;
  await db.insert(scrapedShowsTable).values({
    stationId,
    showName: `Scheduled ${run}`,
    dayOfWeek: "Mon",
    startTime: "10:00",
    endTime: "11:00",
    sourceUrl: "https://example.invalid/schedule",
    extraction: "api",
  });
  await db.insert(spinsTable).values([
    {
      stationId,
      showId: directShowId,
      showAttributionSource: "source_api",
      rawArtist: "Direct artist",
      rawTitle: "Direct title",
      playedAt: new Date("2024-01-08T09:00:00Z"),
    },
    {
      stationId,
      rawArtist: "Scheduled artist",
      rawTitle: "Scheduled title",
      playedAt: new Date("2024-01-08T10:30:00Z"),
    },
  ]);
  const { default: adminRouter } = await import("../src/routes/lore/admin.js");
  const app = express();
  app.use(adminRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 300_000);

afterAll(async () => {
  server?.close();
  if (!available || stationId == null) return;
  await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
  await db.delete(scrapedShowsTable).where(eq(scrapedShowsTable.stationId, stationId));
  await db.delete(showsTable).where(eq(showsTable.stationId, stationId));
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
}, 300_000);

describe("show attribution provenance", () => {
  it("marks schedule matches without counting them as stream-emitted", async (ctx) => {
    if (!available) return ctx.skip();
    expect(await stampSpinShowIds()).toBeGreaterThanOrEqual(1);
    const rows = await db.select({
      title: spinsTable.rawTitle,
      source: spinsTable.showAttributionSource,
    }).from(spinsTable).where(eq(spinsTable.stationId, stationId!));
    expect(rows).toEqual(expect.arrayContaining([
      { title: "Direct title", source: "source_api" },
      { title: "Scheduled title", source: "schedule_match" },
    ]));

    const response = await fetch(`${baseUrl}/admin/show-attribution-health`, {
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(response.status).toBe(200);
    const health = await response.json() as {
      streamEmitted: number;
      bySource: Record<string, number>;
    };
    expect(health.bySource.source_api).toBeGreaterThanOrEqual(1);
    expect(health.bySource.schedule_match).toBeGreaterThanOrEqual(1);
    expect(health.streamEmitted).toBe(
      health.bySource.stream_metadata + health.bySource.source_api,
    );
  }, 300_000);
});