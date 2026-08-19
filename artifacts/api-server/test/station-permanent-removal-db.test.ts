/**
 * HTTP integration tests for permanent station removal ("Remove from Lore"):
 *
 *   DELETE /api/admin/stations/:id/permanent
 *   GET    /api/admin/stations/:id/removal-preview
 *   GET    /api/admin/station-exclusions
 *
 * Covers:
 *   - preview reports name/spinCount/curated flag
 *   - radio_browser station: dependents + station row deleted in FK order,
 *     UUID tombstoned in station_exclusions
 *   - discovery upsert skips an excluded UUID (never re-enrolled)
 *   - curated station: soft removal (hidden + inactive) + slug tombstone
 *   - exclusions list endpoint returns the tombstones
 *   - 404 for unknown ids, 400 for garbage ids
 *
 * Self-skips when no Postgres is reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql, inArray } from "drizzle-orm";
import type { AddressInfo } from "node:net";
import express from "express";
import { createServer } from "node:http";
import {
  db,
  stationsTable,
  radioBrowserStationsTable,
  stationExclusionsTable,
  spinsTable,
  showsTable,
} from "@workspace/db";

const ADMIN_TOKEN = `test-permremove-${randomUUID().slice(0, 8)}`;
process.env.LORE_ADMIN_TOKEN = ADMIN_TOKEN;

const run = randomUUID().slice(0, 8);
const RB_SLUG = `test-permremove-rb-${run}`;
const RB_UUID = `permremove-uuid-${run}`;
const CURATED_SLUG = `test-permremove-cur-${run}`;

let dbAvailable = false;
let rbStationId: number | null = null;
let curatedStationId: number | null = null;
let serverUrl = "";
let server: ReturnType<typeof createServer> | null = null;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // radio_browser station with a spin, a show, and an enrollment row.
  const [rb] = await db
    .insert(stationsTable)
    .values({
      slug: RB_SLUG,
      name: `Test PermRemove RB ${run}`,
      streamUrl: `https://stream.example.com/permremove-${run}`,
      source: "radio_browser",
      active: true,
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  rbStationId = rb!.id;
  await db.insert(radioBrowserStationsTable).values({
    radioBrowserUuid: RB_UUID,
    streamUrl: `https://stream.example.com/permremove-${run}`,
    name: `Test PermRemove RB ${run}`,
    stationId: rbStationId,
  });
  await db.insert(showsTable).values({
    stationId: rbStationId,
    name: `Test PermRemove Show ${run}`,
    startedAt: new Date(),
  });
  await db.insert(spinsTable).values({
    stationId: rbStationId,
    artist: `PermRemove Artist ${run}`,
    title: `PermRemove Title ${run}`,
    playedAt: new Date(),
  });

  // Curated (seed-style) station.
  const [cur] = await db
    .insert(stationsTable)
    .values({
      slug: CURATED_SLUG,
      name: `Test PermRemove Curated ${run}`,
      streamUrl: `https://stream.example.com/permremove-cur-${run}`,
      source: "curated",
      active: true,
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  curatedStationId = cur!.id;

  const { default: adminRouter } = await import("../src/routes/lore/admin.js");
  const app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server!.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (!dbAvailable) return;
  // Cleanup — tolerate rows already deleted by the endpoint under test.
  const ids = [rbStationId, curatedStationId].filter((n): n is number => n != null);
  if (ids.length > 0) {
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, ids));
    await db.delete(showsTable).where(inArray(showsTable.stationId, ids));
    await db
      .delete(radioBrowserStationsTable)
      .where(inArray(radioBrowserStationsTable.stationId, ids));
    await db.delete(stationsTable).where(inArray(stationsTable.id, ids));
  }
  await db
    .delete(stationExclusionsTable)
    .where(eq(stationExclusionsTable.radioBrowserUuid, RB_UUID));
  await db
    .delete(stationExclusionsTable)
    .where(eq(stationExclusionsTable.stationSlug, CURATED_SLUG));
});

function authed(path: string, init: RequestInit = {}) {
  return fetch(`${serverUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), "x-admin-token": ADMIN_TOKEN },
  });
}

describe("permanent station removal", () => {
  it("removal-preview reports name, spin count, and curated flag", async () => {
    if (!dbAvailable) return;
    const res = await authed(`/api/admin/stations/${rbStationId}/removal-preview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string;
      spinCount: number;
      curated: boolean;
    };
    expect(body.name).toBe(`Test PermRemove RB ${run}`);
    expect(body.spinCount).toBe(1);
    expect(body.curated).toBe(false);

    const cur = await authed(
      `/api/admin/stations/${curatedStationId}/removal-preview`,
    );
    expect(((await cur.json()) as { curated: boolean }).curated).toBe(true);
  });

  it("rejects garbage and unknown ids", async () => {
    if (!dbAvailable) return;
    expect(
      (await authed(`/api/admin/stations/abc/permanent`, { method: "DELETE" }))
        .status,
    ).toBe(400);
    expect(
      (
        await authed(`/api/admin/stations/999999999/permanent`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });

  it("deletes a radio_browser station and tombstones its UUID", async () => {
    if (!dbAvailable) return;
    const res = await authed(`/api/admin/stations/${rbStationId}/permanent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { mode: string }).mode).toBe("deleted");

    const stationRows = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, rbStationId!));
    expect(stationRows).toHaveLength(0);
    const spinRows = await db
      .select()
      .from(spinsTable)
      .where(eq(spinsTable.stationId, rbStationId!));
    expect(spinRows).toHaveLength(0);
    const rbRows = await db
      .select()
      .from(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.radioBrowserUuid, RB_UUID));
    expect(rbRows).toHaveLength(0);

    const excl = await db
      .select()
      .from(stationExclusionsTable)
      .where(eq(stationExclusionsTable.radioBrowserUuid, RB_UUID));
    expect(excl).toHaveLength(1);
    expect(excl[0]!.stationName).toBe(`Test PermRemove RB ${run}`);
  });

  it("discovery upsert skips an excluded UUID", async () => {
    if (!dbAvailable) return;
    const { upsertRadioBrowserStations } = await import(
      "../src/lore/radio-browser.js"
    );
    const count = await upsertRadioBrowserStations(
      [
        {
          stationuuid: RB_UUID,
          name: `Test PermRemove RB ${run}`,
          url: `https://stream.example.com/permremove-${run}`,
          url_resolved: `https://stream.example.com/permremove-${run}`,
          favicon: "",
          tags: "experimental",
          votes: 100000,
          clickcount: 100000,
          bitrate: 320,
          codec: "MP3",
          lastcheckok: 1,
          countrycode: "US",
          homepage: "",
        } as never,
      ],
      "experimental",
    );
    expect(count).toBe(0);
    const rows = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.slug, RB_SLUG));
    expect(rows).toHaveLength(0);
  });

  it("soft-removes a curated station (hidden + inactive) and tombstones its slug", async () => {
    if (!dbAvailable) return;
    const res = await authed(
      `/api/admin/stations/${curatedStationId}/permanent`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { mode: string }).mode).toBe("hidden");

    const [row] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, curatedStationId!));
    expect(row).toBeDefined();
    expect(row!.hidden).toBe(true);
    expect(row!.active).toBe(false);

    const excl = await db
      .select()
      .from(stationExclusionsTable)
      .where(eq(stationExclusionsTable.stationSlug, CURATED_SLUG));
    expect(excl).toHaveLength(1);
  });

  it("lists tombstones on GET /api/admin/station-exclusions", async () => {
    if (!dbAvailable) return;
    const res = await authed(`/api/admin/station-exclusions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      exclusions: { radioBrowserUuid: string | null; stationSlug: string | null }[];
    };
    expect(
      body.exclusions.some((e) => e.radioBrowserUuid === RB_UUID),
    ).toBe(true);
    expect(
      body.exclusions.some((e) => e.stationSlug === CURATED_SLUG),
    ).toBe(true);
  });
});
