import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import { db, stationsTable, recordingsTable, spinsTable } from "@workspace/db";
import app from "../../../src/app.js";

/**
 * Route-level integration tests for the public /api/stations surface:
 *
 *   - GET /api/stations                  — list shape + hidden/inactive filter
 *   - GET /api/stations/:slug/now-playing — known slug, unknown slug (404),
 *     hidden slug (404), latest-spin selection
 *   - GET /api/stations/spins?slug=…      — limit + before/nextBefore
 *     pagination (the spins endpoint is query-param addressed, not
 *     /:slug/spins)
 *
 * Setup requirements: runs under `server-db-tests` (vitest.db.config.ts,
 * real shared Postgres). Seeded spins sit minutes in the FUTURE so they
 * outrank any live poller writes. Unique per-run slugs/mbids; cleaned up in
 * afterAll; self-skips when no DB is reachable.
 */
const run = randomUUID().slice(0, 8);
const SLUG = `test-rt-st-${run}`;
const HIDDEN_SLUG = `test-rt-st-hidden-${run}`;
const INACTIVE_SLUG = `test-rt-st-inactive-${run}`;
const SLEEP_SLUG = `test-rt-st-sleep-${run}`;
const SLEEP_INACTIVE_SLUG = `test-rt-st-sleep-inactive-${run}`;
const MBID = `test-rt-st-rec-${run}`;
const MIN = 60 * 1000;
const base = Date.now() + 5 * MIN;
const OFFSETS = [0, 1, 2];

let dbAvailable = false;
let stationIds: number[] = [];
let server: Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const inserted = await db
    .insert(stationsTable)
    .values([
      {
        slug: SLUG,
        name: `Test RT Station ${run}`,
        streamUrl: "http://example.invalid/rt",
        stationClass: "community",
      },
      {
        slug: HIDDEN_SLUG,
        name: `Test RT Hidden ${run}`,
        streamUrl: "http://example.invalid/rt-hidden",
        stationClass: "community",
        hidden: true,
      },
      {
        slug: INACTIVE_SLUG,
        name: `Test RT Inactive ${run}`,
        streamUrl: "http://example.invalid/rt-inactive",
        stationClass: "community",
        active: false,
      },
      // Sleep Radio station — hidden from the normal directory but returned
      // by ?mode=sleep. hidden=true + sleepMode=true mirrors what the sleep
      // migration writes.
      {
        slug: SLEEP_SLUG,
        name: `Test RT Sleep ${run}`,
        streamUrl: "http://example.invalid/rt-sleep",
        stationClass: "community",
        hidden: true,
        sleepMode: true,
      },
      // Inactive sleep station — must not appear in either mode.
      {
        slug: SLEEP_INACTIVE_SLUG,
        name: `Test RT Sleep Inactive ${run}`,
        streamUrl: "http://example.invalid/rt-sleep-inactive",
        stationClass: "community",
        hidden: true,
        sleepMode: true,
        active: false,
      },
    ])
    .returning({ id: stationsTable.id, slug: stationsTable.slug });
  stationIds = inserted.map((s) => s.id);
  const visibleId = inserted.find((s) => s.slug === SLUG)!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBID, title: "RT Track", artist: `Test RT Artist ${run}` },
  ]);

  // 3 spins one minute apart; the middle one unresolved.
  await db.insert(spinsTable).values(
    OFFSETS.map((offset, i) => ({
      stationId: visibleId,
      mbid: i === 1 ? null : MBID,
      confidence: "text" as const,
      rawArtist: `rt-artist-${offset}`,
      rawTitle: `rt-title-${offset}`,
      playedAt: new Date(base + offset * MIN),
    })),
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (!dbAvailable || stationIds.length === 0) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [MBID]));
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
});

describe("GET /api/stations", () => {
  it("lists visible stations with required fields and excludes hidden/inactive ones", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.stations)).toBe(true);

    const slugs = body.stations.map((s: { slug: string }) => s.slug);
    expect(slugs).toContain(SLUG);
    expect(slugs).not.toContain(HIDDEN_SLUG);
    expect(slugs).not.toContain(INACTIVE_SLUG);

    const ours = body.stations.find((s: { slug: string }) => s.slug === SLUG);
    expect(ours).toMatchObject({ slug: SLUG, name: `Test RT Station ${run}` });
    expect(typeof ours.name).toBe("string");
  });

  it("excludes sleep stations from the default directory", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations`);
    const body = await res.json();
    const slugs = body.stations.map((s: { slug: string }) => s.slug);
    expect(slugs).not.toContain(SLEEP_SLUG);
    expect(slugs).not.toContain(SLEEP_INACTIVE_SLUG);
  });

  it("?mode=sleep returns only active sleep stations — no ordinary or hidden rows", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations?mode=sleep`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const slugs = body.stations.map((s: { slug: string }) => s.slug);
    expect(slugs).toContain(SLEEP_SLUG);
    // Inactive sleep stations stay out.
    expect(slugs).not.toContain(SLEEP_INACTIVE_SLUG);
    // Ordinary visible stations do not leak into sleep mode…
    expect(slugs).not.toContain(SLUG);
    // …and neither do ordinary hidden (non-sleep) stations.
    expect(slugs).not.toContain(HIDDEN_SLUG);
    expect(slugs).not.toContain(INACTIVE_SLUG);
  });

  it("rejects unknown mode values with a clear 400", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations?mode=party`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("party");
    expect(body.error).toContain("sleep");
  });
});

describe("GET /api/stations/:slug/now-playing", () => {
  it("404s for an unknown slug", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/does-not-exist-${run}/now-playing`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("404s for a hidden station", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/${HIDDEN_SLUG}/now-playing`);
    expect(res.status).toBe(404);
  });

  it("returns the station plus its latest spin for a known slug", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/${SLUG}/now-playing`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.station.slug).toBe(SLUG);
    expect(body.nowPlaying).not.toBeNull();
    // Latest = highest playedAt offset.
    expect(body.nowPlaying.rawTitle).toBe("rt-title-2");
    expect(body.nowPlaying.playedAt).toBe(new Date(base + 2 * MIN).toISOString());
    expect(body.nowPlaying.recording).toMatchObject({ mbid: MBID });
  });
});

type SpinsResponse = {
  station: { slug: string };
  tracks: { rawTitle: string; playedAt: string; recording: { mbid: string } | null }[];
  nextBefore: string | null;
  bounds: { spinCount: number };
};

describe("GET /api/stations/spins pagination", () => {
  it("404s for an unknown slug", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/stations/spins?slug=does-not-exist-${run}`);
    expect(res.status).toBe(404);
  });

  it("honours limit and pages strictly older via before/nextBefore", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const page1 = (await (
      await fetch(`${baseUrl}/api/stations/spins?slug=${SLUG}&limit=2`)
    ).json()) as SpinsResponse;
    expect(page1.station.slug).toBe(SLUG);
    expect(page1.tracks.map((t) => t.rawTitle)).toEqual(["rt-title-2", "rt-title-1"]);
    expect(page1.bounds.spinCount).toBe(3);
    expect(page1.nextBefore).toBe(new Date(base + 1 * MIN).toISOString());
    // The unresolved middle spin carries no recording.
    expect(page1.tracks[1]!.recording).toBeNull();

    const page2 = (await (
      await fetch(
        `${baseUrl}/api/stations/spins?slug=${SLUG}&limit=2&before=${encodeURIComponent(page1.nextBefore!)}`,
      )
    ).json()) as SpinsResponse;
    expect(page2.tracks.map((t) => t.rawTitle)).toEqual(["rt-title-0"]);
    expect(page2.nextBefore).toBeNull();
  });
});
