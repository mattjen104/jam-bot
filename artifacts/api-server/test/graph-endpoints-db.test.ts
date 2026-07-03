import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pickersTable,
  picksTable,
  recordingsTable,
  stationsTable,
  spinsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Integration tests for the bidirectional song–source graph endpoints:
 *   - GET /recordings/:mbid/picks        (reverse edge: song → lists)
 *   - GET /stations/:slug/overlaps/pickers   ("Critics agree")
 *   - GET /pickers/:handle/overlaps/stations ("On the radio too")
 *   - GET /picks/contains?mbids=          (dial badge batch lookup)
 *
 * Exercises the run-anchor derivation (runId = min pick id per
 * picker+sourceUrl group), trust ordering, DJ exclusion from editorial
 * surfaces, and strongest-pick selection. Mounts the real router over HTTP
 * so the zod response contracts are enforced end to end.
 *
 * NOTE on /picks/contains: the endpoint keeps a 60s in-memory cache keyed by
 * mbid — all mbids here are unique per test run, so the cache can never leak
 * hits across runs or across other test files (vitest DB is shared within a
 * file only; unique ids keep us isolated regardless).
 */
const run = randomUUID().slice(0, 8);
const REC_A = `test-graph-a-${run}`; // picked by blog (ordered list) AND label
const REC_B = `test-graph-b-${run}`; // picked by blog only (same list as A)
const REC_C = `test-graph-c-${run}`; // never picked (spun only)
const REC_DJ = `test-graph-dj-${run}`; // picked by a DJ picker only
const MBIDS = [REC_A, REC_B, REC_C, REC_DJ];

const STATION_SLUG = `test-graph-st-${run}`;
const BLOG_HANDLE = `test-graph-blog-${run}`;
const LABEL_HANDLE = `test-graph-label-${run}`;
const DJ_HANDLE = `test-graph-dj-${run}`;
const LIST_URL = `https://example.invalid/list-${run}`;

let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";
let stationId: number | undefined;
let blogId: number | undefined;
let labelId: number | undefined;
let djId: number | undefined;
let blogPickIdA: number | undefined;
let blogPickIdB: number | undefined;

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  await db.insert(recordingsTable).values([
    { mbid: REC_A, title: "Graph Track A", artist: "Graph Act" },
    { mbid: REC_B, title: "Graph Track B", artist: "Graph Act" },
    { mbid: REC_C, title: "Graph Track C", artist: "Graph Act" },
    { mbid: REC_DJ, title: "Graph Track DJ", artist: "Graph Act" },
  ]);

  const pickers = await db
    .insert(pickersTable)
    .values([
      {
        pickerType: "blog",
        name: `Graph Blog ${run}`,
        handle: BLOG_HANDLE,
        trustTier: 2,
      },
      {
        pickerType: "label",
        name: `Graph Label ${run}`,
        handle: LABEL_HANDLE,
        trustTier: 1,
      },
      {
        pickerType: "dj",
        name: `Graph DJ ${run}`,
        handle: DJ_HANDLE,
        trustTier: 3,
      },
    ])
    .returning({ id: pickersTable.id, handle: pickersTable.handle });
  blogId = pickers.find((p) => p.handle === BLOG_HANDLE)!.id;
  labelId = pickers.find((p) => p.handle === LABEL_HANDLE)!.id;
  djId = pickers.find((p) => p.handle === DJ_HANDLE)!.id;

  // Blog picks A then B in ONE ordered list (same sourceUrl) — a 2-track run.
  const blogPicks = await db
    .insert(picksTable)
    .values([
      {
        pickerId: blogId,
        mbid: REC_A,
        source: "blog_post",
        context: `Graph List ${run}`,
        sourceUrl: LIST_URL,
        ordinal: 0,
        confidence: "text",
        pickedAt: new Date("2026-06-01T00:00:00Z"),
        externalId: `graph:${run}:blog-a`,
      },
      {
        pickerId: blogId,
        mbid: REC_B,
        source: "blog_post",
        context: `Graph List ${run}`,
        sourceUrl: LIST_URL,
        ordinal: 1,
        confidence: "text",
        pickedAt: new Date("2026-06-01T00:00:00Z"),
        externalId: `graph:${run}:blog-b`,
      },
      // Label also picked A (stronger tier, no source URL → no run link).
      {
        pickerId: labelId!,
        mbid: REC_A,
        source: "label_release",
        confidence: "recording_id",
        pickedAt: new Date("2026-05-01T00:00:00Z"),
        externalId: `graph:${run}:label-a`,
      },
      // DJ picker picked REC_DJ — must never surface on editorial surfaces.
      {
        pickerId: djId!,
        mbid: REC_DJ,
        source: "spin",
        confidence: "text",
        externalId: `graph:${run}:dj`,
      },
    ])
    .returning({ id: picksTable.id, externalId: picksTable.externalId });
  blogPickIdA = blogPicks.find((p) => p.externalId === `graph:${run}:blog-a`)!.id;
  blogPickIdB = blogPicks.find((p) => p.externalId === `graph:${run}:blog-b`)!.id;

  // Station spun A and B (overlaps with the blog list) plus an unresolved spin.
  const [st] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG,
      name: `Graph Station ${run}`,
      streamUrl: "http://example.invalid/stream",
      stationClass: "curated",
    })
    .returning({ id: stationsTable.id });
  stationId = st!.id;
  await db.insert(spinsTable).values([
    { stationId, mbid: REC_A, confidence: "text", playedAt: new Date() },
    { stationId, mbid: REC_B, confidence: "text", playedAt: new Date() },
    { stationId, mbid: REC_C, confidence: "text", playedAt: new Date() },
    { stationId, mbid: null, confidence: "unresolved", playedAt: new Date() },
  ]);

  const { default: loreRouter } = await import("../src/routes/lore/index.js");
  const app = express();
  app.use(express.json());
  app.use("/api", loreRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (!dbAvailable) return;
  if (stationId !== undefined) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
  const pickerIds = [blogId, labelId, djId].filter((x): x is number => x !== undefined);
  if (pickerIds.length > 0) {
    await db.delete(picksTable).where(inArray(picksTable.pickerId, pickerIds));
    await db.delete(pickersTable).where(inArray(pickersTable.id, pickerIds));
  }
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, MBIDS));
});

describe("GET /recordings/:mbid/picks", () => {
  it("returns the pick with its run anchor (min pick id) and track count", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status, body } = await get(`/recordings/${REC_B}/picks`);
    expect(status).toBe(200);
    expect(body.picks).toHaveLength(1);
    const pick = body.picks[0];
    expect(pick.picker.handle).toBe(BLOG_HANDLE);
    // Anchor is the FIRST pick of the list (A's id), not B's own id.
    expect(pick.runId).toBe(Math.min(blogPickIdA!, blogPickIdB!));
    expect(pick.trackCount).toBe(2);
    expect(pick.ordinal).toBe(1);
    expect(pick.listTitle).toBe(`Graph List ${run}`);
    expect(pick.sourceUrl).toBe(LIST_URL);
  });

  it("orders picks by trust tier (label before blog) and handles missing sourceUrl", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status, body } = await get(`/recordings/${REC_A}/picks`);
    expect(status).toBe(200);
    expect(body.picks).toHaveLength(2);
    expect(body.picks[0].picker.handle).toBe(LABEL_HANDLE); // tier 1 first
    expect(body.picks[0].runId).toBeNull(); // no sourceUrl → no run link
    expect(body.picks[0].trackCount).toBe(0);
    expect(body.picks[1].picker.handle).toBe(BLOG_HANDLE);
    expect(body.picks[1].runId).toBe(Math.min(blogPickIdA!, blogPickIdB!));
  });

  it("returns an empty list for an unpicked recording", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status, body } = await get(`/recordings/${REC_C}/picks`);
    expect(status).toBe(200);
    expect(body.picks).toEqual([]);
  });
});

describe("GET /stations/:slug/overlaps/pickers", () => {
  it("finds editorial pickers sharing exact MBIDs and excludes DJ pickers", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status, body } = await get(`/stations/${STATION_SLUG}/overlaps/pickers`);
    expect(status).toBe(200);
    const byHandle = new Map(
      body.items.map((i: any) => [i.picker.handle, i.sharedCount]),
    );
    expect(byHandle.get(BLOG_HANDLE)).toBe(2); // A + B
    expect(byHandle.get(LABEL_HANDLE)).toBe(1); // A only
    expect(byHandle.has(DJ_HANDLE)).toBe(false); // DJs never on this surface
  });

  it("404s for an unknown station", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status } = await get(`/stations/no-such-station-${run}/overlaps/pickers`);
    expect(status).toBe(404);
  });
});

describe("GET /pickers/:handle/overlaps/stations", () => {
  it("finds stations that spun the picker's exact MBIDs", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status, body } = await get(`/pickers/${BLOG_HANDLE}/overlaps/stations`);
    expect(status).toBe(200);
    const ours = body.items.find((i: any) => i.station.slug === STATION_SLUG);
    expect(ours).toBeDefined();
    expect(ours.sharedCount).toBe(2); // A + B
  });

  it("404s for an unknown picker", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status } = await get(`/pickers/no-such-picker-${run}/overlaps/stations`);
    expect(status).toBe(404);
  });
});

describe("GET /picks/contains", () => {
  it("returns the strongest editorial pick per mbid, omitting unpicked and DJ-only mbids", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status, body } = await get(
      `/picks/contains?mbids=${[REC_A, REC_B, REC_C, REC_DJ].join(",")}`,
    );
    expect(status).toBe(200);
    const byMbid = new Map(body.items.map((i: any) => [i.mbid, i]));
    // REC_A: label (tier 1) beats blog (tier 2); label pick has no run.
    const a = byMbid.get(REC_A) as any;
    expect(a.picker.handle).toBe(LABEL_HANDLE);
    expect(a.runId).toBeNull();
    // REC_B: blog is the only editorial pick; anchored to the list run.
    const b = byMbid.get(REC_B) as any;
    expect(b.picker.handle).toBe(BLOG_HANDLE);
    expect(b.runId).toBe(Math.min(blogPickIdA!, blogPickIdB!));
    expect(b.listTitle).toBe(`Graph List ${run}`);
    // Unpicked and DJ-only tracks are simply absent.
    expect(byMbid.has(REC_C)).toBe(false);
    expect(byMbid.has(REC_DJ)).toBe(false);
  });

  it("serves repeat lookups (cache path) with identical results", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const first = await get(`/picks/contains?mbids=${REC_B}`);
    const second = await get(`/picks/contains?mbids=${REC_B}`);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.body.items[0].picker.handle).toBe(BLOG_HANDLE);
  });

  it("400s when mbids is missing", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const { status } = await get(`/picks/contains`);
    expect(status).toBe(400);
  });
});
