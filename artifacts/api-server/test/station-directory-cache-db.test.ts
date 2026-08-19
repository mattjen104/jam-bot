import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import { db, stationsTable } from "@workspace/db";
import app from "../src/app.js";
import {
  _testOnly_expireStationDirectoryCaches,
  _testOnly_getStationDirectoryBuildCount,
  _testOnly_getStationRowsRefreshCount,
  _testOnly_resetStationDirectoryCaches,
  _testOnly_setStationRowsRefreshGate,
  _testOnly_waitForStationRowsRefresh,
} from "../src/routes/lore/stations.js";

const run = randomUUID().slice(0, 8);
const SLUG = `test-station-cache-${run}`;

let dbAvailable = false;
let stationId: number | undefined;
let server: Server | undefined;
let baseUrl = "";

type ListStationsBody = {
  stations: Array<{ id: number; slug: string; name: string }>;
};

async function getStationsWithin(timeoutMs = 5_000): Promise<ListStationsBody> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    const res = await Promise.race([
      fetch(`${baseUrl}/api/stations`),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`GET /api/stations exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    expect(res.status).toBe(200);
    return (await res.json()) as ListStationsBody;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  _testOnly_resetStationDirectoryCaches(true);

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG,
      name: `Station cache ${run}`,
      streamUrl: "https://example.invalid/station-cache",
      stationClass: "community",
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
}, 90_000);

afterAll(async () => {
  _testOnly_setStationRowsRefreshGate(null);
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  if (dbAvailable && stationId) {
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
}, 90_000);

describe("GET /api/stations directory snapshot", () => {
  it("single-flights a burst of cache-empty first requests", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    _testOnly_resetStationDirectoryCaches(true);
    const refreshesBefore = _testOnly_getStationRowsRefreshCount();
    const bodies = await Promise.all(
      Array.from({ length: 5 }, () => getStationsWithin()),
    );

    for (const body of bodies) {
      expect(body.stations.some((station) => station.slug === SLUG)).toBe(true);
    }
    expect(_testOnly_getStationRowsRefreshCount() - refreshesBefore).toBe(1);
  }, 90_000);

  it("serves stale rows immediately while the shared DB refresh is blocked", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const warm = await getStationsWithin();
    expect(warm.stations.some((station) => station.slug === SLUG)).toBe(true);
    const updatedName = `Station cache updated ${run}`;
    await db
      .update(stationsTable)
      .set({ name: updatedName })
      .where(eq(stationsTable.id, stationId!));

    _testOnly_expireStationDirectoryCaches();
    const gate = deferred();
    _testOnly_setStationRowsRefreshGate(gate.promise);
    try {
      const body = await getStationsWithin();
      expect(body.stations.find((station) => station.slug === SLUG)?.name)
        .not.toBe(updatedName);
    } finally {
      gate.resolve();
      _testOnly_setStationRowsRefreshGate(null);
      await _testOnly_waitForStationRowsRefresh();
    }

    const refreshed = await getStationsWithin();
    expect(refreshed.stations.find((station) => station.slug === SLUG)?.name)
      .toBe(updatedName);
  }, 90_000);

  it("builds a cache-cold response from the shared row snapshot without joining a blocked refresh", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Keep the raw station snapshot published by the first request, but drop
    // the endpoint response cache to model a first front-door request after
    // now-playing prewarm has completed.
    _testOnly_resetStationDirectoryCaches(false);
    _testOnly_expireStationDirectoryCaches();
    const buildsBefore = _testOnly_getStationDirectoryBuildCount();
    const gate = deferred();
    _testOnly_setStationRowsRefreshGate(gate.promise);
    try {
      const bodies = await Promise.all(
        Array.from({ length: 5 }, () => getStationsWithin()),
      );
      for (const body of bodies) {
        expect(body.stations.some((station) => station.slug === SLUG)).toBe(true);
      }
      expect(_testOnly_getStationDirectoryBuildCount() - buildsBefore).toBe(1);
    } finally {
      gate.resolve();
      _testOnly_setStationRowsRefreshGate(null);
      await _testOnly_waitForStationRowsRefresh();
    }
  }, 90_000);
});