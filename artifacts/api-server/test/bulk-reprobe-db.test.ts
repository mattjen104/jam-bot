/**
 * HTTP + database integration coverage for the unsupported-stream recovery
 * tool. A station can have several Radio Browser rows, so recovery must make
 * the successful row—not an older still-unsupported row—the live poll target.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { createServer } from "node:http";
import { eq, sql } from "drizzle-orm";
import {
  db,
  radioBrowserStationsTable,
  stationsTable,
} from "@workspace/db";
import {
  _testOnly_setProbeGapMs,
  getBulkReprobeStatus,
} from "../src/lore/bulk-reprobe.js";

vi.mock("../src/lore/icy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lore/icy.js")>();
  return { ...actual, fetchIcyMetadata: vi.fn() };
});

vi.mock("../src/lore/poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lore/poller.js")>();
  return { ...actual, enrollStationPoller: vi.fn() };
});

const ADMIN_TOKEN = `test-bulk-reprobe-${randomUUID().slice(0, 8)}`;
process.env.LORE_ADMIN_TOKEN = ADMIN_TOKEN;

const run = randomUUID().slice(0, 8);
const STATION_NAME = `Bulk Reprobe Station ${run}`;
const OLD_STREAM_URL = `https://stream.example.com/bulk-old-${run}`;
const RECOVERED_STREAM_URL = `https://stream.example.com/bulk-recovered-${run}`;

let dbAvailable = false;
let stationId: number | null = null;
let oldRbId: number | null = null;
let recoveredRbId: number | null = null;
let server: ReturnType<typeof createServer> | null = null;
let serverUrl = "";
let restoreProbeGap: (() => void) | null = null;

async function waitForBulkReprobe(): Promise<ReturnType<typeof getBulkReprobeStatus>> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const status = getBulkReprobeStatus();
    if (!status.running && status.finishedAt) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Bulk re-probe did not finish: ${JSON.stringify(getBulkReprobeStatus())}`);
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: `bulk-reprobe-${run}`,
      name: STATION_NAME,
      streamUrl: OLD_STREAM_URL,
      streamFormat: "mp3",
      mode: "live",
      active: true,
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: { streamUrl: OLD_STREAM_URL },
      source: "radio_browser",
      tier: "longtail",
      tags: [],
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  const [oldRow] = await db
    .insert(radioBrowserStationsTable)
    .values({
      stationId,
      radioBrowserUuid: `bulk-old-${run}`,
      name: STATION_NAME,
      streamUrl: OLD_STREAM_URL,
      icyStatus: "icy_unsupported",
    })
    .returning({ id: radioBrowserStationsTable.id });
  oldRbId = oldRow!.id;

  const [recoveredRow] = await db
    .insert(radioBrowserStationsTable)
    .values({
      stationId,
      radioBrowserUuid: `bulk-recovered-${run}`,
      name: STATION_NAME,
      streamUrl: RECOVERED_STREAM_URL,
      icyStatus: "icy_unsupported",
    })
    .returning({ id: radioBrowserStationsTable.id });
  recoveredRbId = recoveredRow!.id;

  const icy = await import("../src/lore/icy.js");
  vi.mocked(icy.fetchIcyMetadata).mockImplementation(async (streamUrl) => {
    if (streamUrl === RECOVERED_STREAM_URL) {
      return { ok: true, streamTitle: "Recovered Artist - Recovered Song" };
    }
    return { ok: false, kind: "icy_unsupported", message: "still unsupported" };
  });

  restoreProbeGap = _testOnly_setProbeGapMs(0);

  // Import only after the admin token and module seams are ready.
  const { default: adminRouter } = await import("../src/routes/lore/admin.js");
  const app = express();
  app.use(express.json());
  app.use(adminRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  restoreProbeGap?.();
  server?.close();
  if (!dbAvailable) return;
  if (oldRbId !== null || recoveredRbId !== null) {
    await db
      .delete(radioBrowserStationsTable)
      .where(
        eq(
          radioBrowserStationsTable.stationId,
          stationId!,
        ),
      );
  }
  if (stationId !== null) {
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
});

describe("POST /admin/radio-browser/bulk-reprobe (HTTP + DB integration)", () => {
  it("switches a multi-row station to the recovered stream and enrolls that exact station", async () => {
    if (!dbAvailable) return;

    const response = await fetch(`${serverUrl}/admin/radio-browser/bulk-reprobe`, {
      method: "POST",
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      started: true,
      status: { running: true },
    });

    const status = await waitForBulkReprobe();
    // This is a shared database integration suite, so unrelated unsupported
    // rows may already exist. The batch must still account for every row it
    // found while recovering exactly this test's one successful stream.
    expect(status.running).toBe(false);
    expect(status.total).toBeGreaterThanOrEqual(2);
    expect(status.probed).toBe(status.total);
    expect(status.recovered).toBe(1);
    expect(status.stillBad).toBe(status.total - 1);
    expect(status.error).toBeNull();

    const [oldRow, recoveredRow] = await Promise.all([
      db
        .select({ icyStatus: radioBrowserStationsTable.icyStatus })
        .from(radioBrowserStationsTable)
        .where(eq(radioBrowserStationsTable.id, oldRbId!)),
      db
        .select({
          icyStatus: radioBrowserStationsTable.icyStatus,
          lastStreamTitle: radioBrowserStationsTable.lastStreamTitle,
        })
        .from(radioBrowserStationsTable)
        .where(eq(radioBrowserStationsTable.id, recoveredRbId!)),
    ]);
    expect(oldRow[0]).toMatchObject({ icyStatus: "icy_unsupported" });
    expect(recoveredRow[0]).toMatchObject({
      icyStatus: "active",
      lastStreamTitle: "Recovered Artist - Recovered Song",
    });

    const [station] = await db
      .select({
        id: stationsTable.id,
        streamUrl: stationsTable.streamUrl,
        nowPlayingSource: stationsTable.nowPlayingSource,
        nowPlayingConfig: stationsTable.nowPlayingConfig,
      })
      .from(stationsTable)
      .where(eq(stationsTable.id, stationId!));
    expect(station).toMatchObject({
      id: stationId,
      streamUrl: RECOVERED_STREAM_URL,
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: {
        streamUrl: RECOVERED_STREAM_URL,
        radioBrowserId: recoveredRbId,
      },
    });

    const poller = await import("../src/lore/poller.js");
    expect(vi.mocked(poller.enrollStationPoller)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(poller.enrollStationPoller)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: stationId,
        streamUrl: RECOVERED_STREAM_URL,
        nowPlayingConfig: {
          streamUrl: RECOVERED_STREAM_URL,
          radioBrowserId: recoveredRbId,
        },
      }),
    );
  });
});