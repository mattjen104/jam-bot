// @vitest-environment node
/**
 * Integration coverage for withdrawing a structurally-valid but incorrect
 * scraped schedule block. The schedule receipt is retained for audit, while
 * all schedule-derived bylines immediately fall back to station attribution.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import express from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  pickersTable,
  recordingsTable,
  scrapedShowsTable,
  showsTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import { clearAutomationClassCache, lookupScrapedShowId } from "../src/lore/scraped-shows-sync.js";
import { spinsForRecording } from "../src/lore/segue.js";

const run = randomUUID().slice(0, 8);
const ADMIN_TOKEN = `test-void-schedule-${run}`;
process.env.LORE_ADMIN_TOKEN = ADMIN_TOKEN;

const SLUG = `void-schedule-${run}`;
const MBID = `void-schedule-mbid-${run}`;
const CURATED_MBID = `void-schedule-curated-${run}`;
const VOIDED_SHOW = `Incorrect Schedule ${run}`;
const VALID_SHOW = `Valid Schedule ${run}`;
const INSIDE_SLOT = new Date("2024-01-08T10:30:00Z"); // Monday UTC

let dbAvailable = false;
let stationId: number | null = null;
let voidedBlockId: number | null = null;
let validBlockId: number | null = null;
let curatedShowId: number | null = null;
let pickerId: number | null = null;
let server: Server | null = null;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
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
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG,
      name: `Void Schedule ${run}`,
      streamUrl: "https://example.invalid/stream",
      ianaTimezone: "UTC",
      automationClass: "mixed",
      active: true,
    })
    .returning({ id: stationsTable.id });
  stationId = station!.id;

  await db.insert(showsTable).values([
    { stationId, name: VOIDED_SHOW, djName: "Wrong DJ" },
    { stationId, name: VALID_SHOW, djName: "Right DJ" },
    { stationId, name: `Curated Show ${run}`, djName: "Curator" },
  ]);
  const [picker] = await db
    .insert(pickersTable)
    .values({
      pickerType: "dj",
      name: `Curator ${run}`,
      handle: `void-schedule-curator-${run}`,
      sourceRef: { source: "test" },
      active: true,
    })
    .returning({ id: pickersTable.id });
  pickerId = picker!.id;
  const [curated] = await db
    .select({ id: showsTable.id })
    .from(showsTable)
    .where(and(eq(showsTable.stationId, stationId), eq(showsTable.name, `Curated Show ${run}`)));
  curatedShowId = curated!.id;
  await db
    .update(showsTable)
    .set({ pickerId })
    .where(eq(showsTable.id, curatedShowId));

  await db.insert(recordingsTable).values({
    mbid: MBID,
    title: "Test Track",
    artist: "Test Artist",
  });
  await db.insert(recordingsTable).values({
    mbid: CURATED_MBID,
    title: "Curated Track",
    artist: "Test Artist",
  });

  const blocks = await db
    .insert(scrapedShowsTable)
    .values([
      {
        stationId,
        showName: VOIDED_SHOW,
        dayOfWeek: "Mon",
        startTime: "10:00",
        endTime: "12:00",
        djName: "Wrong DJ",
        sourceUrl: "https://example.invalid/schedule",
        extraction: "llm",
      },
      {
        stationId,
        showName: VALID_SHOW,
        dayOfWeek: "Mon",
        startTime: "10:00",
        endTime: "12:00",
        djName: "Right DJ",
        sourceUrl: "https://example.invalid/schedule",
        extraction: "llm",
      },
    ])
    .returning({ id: scrapedShowsTable.id, showName: scrapedShowsTable.showName });
  voidedBlockId = blocks.find((b) => b.showName === VOIDED_SHOW)!.id;
  validBlockId = blocks.find((b) => b.showName === VALID_SHOW)!.id;

  const [wrongShow] = await db
    .select({ id: showsTable.id })
    .from(showsTable)
    .where(and(eq(showsTable.stationId, stationId), eq(showsTable.name, VOIDED_SHOW)));
  await db.insert(spinsTable).values({
    stationId,
    showId: wrongShow!.id,
    mbid: MBID,
    rawArtist: "Test Artist",
    rawTitle: "Test Track",
    confidence: "recording_id",
    playedAt: INSIDE_SLOT,
  });
  await db.insert(spinsTable).values({
    stationId,
    showId: curatedShowId,
    mbid: CURATED_MBID,
    rawArtist: "Test Artist",
    rawTitle: "Curated Track",
    source: "manual",
    confidence: "recording_id",
    playedAt: new Date("2024-01-15T10:30:00Z"),
  });
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable || stationId == null) return;
  await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
  await db.delete(showsTable).where(eq(showsTable.stationId, stationId));
  await db.delete(scrapedShowsTable).where(eq(scrapedShowsTable.stationId, stationId));
  if (pickerId != null) await db.delete(pickersTable).where(eq(pickersTable.id, pickerId));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, CURATED_MBID));
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
});

function voidUrl(id: number): string {
  return `${baseUrl}/admin/scraped-shows/${id}/void`;
}

describe("PATCH /admin/scraped-shows/:id/void", () => {
  it("requires admin authentication and a non-empty reason", async () => {
    if (!dbAvailable) return;
    expect((await fetch(voidUrl(voidedBlockId!), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "bad extraction" }),
    })).status).toBe(401);

    expect((await fetch(voidUrl(voidedBlockId!), {
      method: "PATCH",
      headers: { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ reason: "   " }),
    })).status).toBe(400);

    expect((await fetch(voidUrl(999_999_999), {
      method: "PATCH",
      headers: { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ reason: "bad extraction" }),
    })).status).toBe(404);
  });

  it("retains the audit receipt, excludes its byline, and keeps valid evidence usable", async () => {
    if (!dbAvailable) return;
    clearAutomationClassCache([stationId!]);

    const before = await lookupScrapedShowId(stationId!, "UTC", INSIDE_SLOT);
    expect(before).not.toBeNull();

    const res = await fetch(voidUrl(voidedBlockId!), {
      method: "PATCH",
      headers: { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Schedule page paired the wrong host with this slot." }),
    });
    if (res.status !== 200) {
      throw new Error(`void request failed (${res.status}): ${await res.text()}`);
    }
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: voidedBlockId,
      stationId,
      showName: VOIDED_SHOW,
      voidReason: "Schedule page paired the wrong host with this slot.",
    });

    const [audit] = await db
      .select()
      .from(scrapedShowsTable)
      .where(eq(scrapedShowsTable.id, voidedBlockId!));
    expect(audit?.voidedAt).not.toBeNull();
    expect(audit?.voidReason).toBe("Schedule page paired the wrong host with this slot.");

    const attributed = await spinsForRecording(MBID);
    expect(attributed).toHaveLength(1);
    expect(attributed[0]?.show).toBeNull();

    // Only the withdrawn block is excluded. The overlapping valid block still
    // resolves through the schedule-to-show path.
    const resolved = await lookupScrapedShowId(stationId!, "UTC", INSIDE_SLOT);
    const [validShow] = await db
      .select({ id: showsTable.id })
      .from(showsTable)
      .where(and(eq(showsTable.stationId, stationId!), eq(showsTable.name, VALID_SHOW)));
    expect(resolved).toBe(validShow!.id);

    const [validAudit] = await db
      .select({ voidedAt: scrapedShowsTable.voidedAt })
      .from(scrapedShowsTable)
      .where(eq(scrapedShowsTable.id, validBlockId!));
    expect(validAudit?.voidedAt).toBeNull();

    // Curated show evidence remains usable even when a same-named withdrawn
    // schedule block exists at a different time.
    const [curatedBlock] = await db
      .insert(scrapedShowsTable)
      .values({
        stationId: stationId!,
        showName: `Curated Show ${run}`,
        dayOfWeek: "Mon",
        startTime: "10:00",
        endTime: "12:00",
        djName: "Incorrect schedule host",
        sourceUrl: "https://example.invalid/schedule",
        extraction: "llm",
        voidedAt: new Date(),
        voidReason: "Not the curated broadcast.",
      })
      .returning({ id: scrapedShowsTable.id });
    expect(curatedBlock).toBeDefined();

    const curatedSpins = await spinsForRecording(CURATED_MBID);
    expect(curatedSpins.find((spin) => spin.show?.name === `Curated Show ${run}`)?.show)
      .toMatchObject({ djName: "Curator" });
  });
});