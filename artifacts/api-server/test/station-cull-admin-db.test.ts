import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, stationsTable } from "@workspace/db";
import { applyStationCullMetadataMigration } from "../src/lore/station-cull-metadata-migration.js";

vi.mock("../src/lore/poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lore/poller.js")>();
  return {
    ...actual,
    enrollStationPoller: vi.fn(),
    unenrollStationPoller: vi.fn(),
  };
});

const ADMIN_TOKEN = `test-cull-admin-${randomUUID().slice(0, 8)}`;
process.env.LORE_ADMIN_TOKEN = ADMIN_TOKEN;

const run = randomUUID().slice(0, 8);
let dbAvailable = false;
let server: ReturnType<typeof createServer> | null = null;
let serverUrl = "";
let canonicalId: number | null = null;
let culledId: number | null = null;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    await applyStationCullMetadataMigration();
    dbAvailable = true;
  } catch {
    return;
  }

  const { default: adminRouter } = await import("../src/routes/lore/admin.js");
  const app = express();
  app.use(express.json());
  app.use(adminRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [canonical] = await db
    .insert(stationsTable)
    .values({
      slug: `cull-canonical-${run}`,
      name: `Cull Canonical ${run}`,
      streamUrl: `https://stream.example.com/cull-${run}`,
      nowPlayingSource: "radio_browser_icy",
      source: "curated",
    })
    .returning({ id: stationsTable.id });
  canonicalId = canonical!.id;

  const [culled] = await db
    .insert(stationsTable)
    .values({
      slug: `cull-duplicate-${run}`,
      name: `Cull Duplicate ${run}`,
      streamUrl: `https://stream.example.com/cull-${run}`,
      nowPlayingSource: "radio_browser_icy",
      source: "radio_browser",
      hidden: true,
      automaticCullReason: "duplicate_stream",
      automaticCullCanonicalStationId: canonicalId,
    })
    .returning({ id: stationsTable.id });
  culledId = culled!.id;
}, 90_000);

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  const ids = [culledId, canonicalId].filter((id): id is number => id !== null);
  if (ids.length > 0) {
    await db.delete(stationsTable).where(inArray(stationsTable.id, ids));
  }
});

describe("automatic station cull admin review", () => {
  it("lists the cull reason and visible canonical station", async () => {
    if (!dbAvailable) return;
    const response = await fetch(`${serverUrl}/admin/stations/flags`, {
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      stations: Array<Record<string, unknown>>;
    };
    const row = body.stations.find((station) => station.id === culledId);
    expect(row).toMatchObject({
      hidden: true,
      automaticCullReason: "duplicate_stream",
      automaticCullCanonicalStationId: canonicalId,
      automaticCullCanonicalStationSlug: `cull-canonical-${run}`,
      automaticCullCanonicalStationName: `Cull Canonical ${run}`,
    });
  });

  it("restores the station and clears automatic-cull provenance", async () => {
    if (!dbAvailable) return;
    const response = await fetch(`${serverUrl}/admin/stations/${culledId}/flags`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": ADMIN_TOKEN,
      },
      body: JSON.stringify({ hidden: false }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: culledId,
      hidden: false,
      automaticCullReason: null,
      automaticCullCanonicalStationId: null,
    });

    const [row] = await db
      .select({
        hidden: stationsTable.hidden,
        automaticCullReason: stationsTable.automaticCullReason,
        automaticCullCanonicalStationId:
          stationsTable.automaticCullCanonicalStationId,
      })
      .from(stationsTable)
      .where(eq(stationsTable.id, culledId!));
    expect(row).toEqual({
      hidden: false,
      automaticCullReason: null,
      automaticCullCanonicalStationId: null,
    });
  });
});