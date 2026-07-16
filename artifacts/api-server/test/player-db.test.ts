import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  showsTable,
  recordingsTable,
  spinsTable,
  trackClaimsTable,
} from "@workspace/db";
import app from "../src/app.js";

/**
 * Integration tests for the webplayer read-models (/api/player/*), anonymous
 * path: on-air listing with earlier-artist summary, tonight's-run partition
 * (station + anchor show + UTC day), and lore-counts batching.
 *
 * Spins are seeded slightly in the FUTURE so they stay inside the 90-minute
 * on-air window and rank newest even while live pollers ingest real spins;
 * the window is nudged past UTC midnight when needed so the whole run shares
 * one broadcast day. Unique slugs/MBIDs; cleaned up; skips without a DB.
 */
const run = randomUUID().slice(0, 8);
const MBID_A = `test-wp-a-${run}`;
const MBID_B = `test-wp-b-${run}`;
const MIN = 60 * 1000;

let base = Date.now() + 2 * MIN;
if (
  new Date(base).toISOString().slice(0, 10) !==
  new Date(base + 10 * MIN).toISOString().slice(0, 10)
) {
  base += 20 * MIN;
}
const DAY = new Date(base).toISOString().slice(0, 10);

let dbAvailable = false;
let stationIds: number[] = [];
let showIds: number[] = [];
let server: Server | undefined;
let baseUrl = "";
const slug = `test-wp-${run}`;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const stations = await db
    .insert(stationsTable)
    .values([
      {
        slug,
        name: `Test WP ${run}`,
        streamUrl: "http://example.invalid/wp",
        stationClass: "curated",
      },
    ])
    .returning({ id: stationsTable.id });
  stationIds = stations.map((s) => s.id);
  const stationId = stationIds[0]!;

  const shows = await db
    .insert(showsTable)
    .values([{ stationId, name: `Test WP Show ${run}`, djName: "DJ Wp" }])
    .returning({ id: showsTable.id });
  showIds = shows.map((s) => s.id);
  const showId = showIds[0]!;

  await db.insert(recordingsTable).values([
    { mbid: MBID_A, title: "Alpha Song", artist: `Alpha Artist ${run}` },
    { mbid: MBID_B, title: "Beta Song", artist: `Beta Artist ${run}` },
  ]);

  await db.insert(trackClaimsTable).values([
    {
      mbid: MBID_A,
      text: "test claim",
      sourceLabel: "Test Source",
      sourceUrl: "http://example.invalid/claim",
      sourceHandle: "test",
      externalId: `test-wp-claim-${run}`,
      status: "published",
    },
  ]);

  await db.insert(spinsTable).values([
    // Earlier tonight, same show/day: resolved to B.
    {
      stationId,
      showId,
      mbid: MBID_B,
      confidence: "text",
      rawArtist: "raw-b",
      rawTitle: "raw-b-t",
      playedAt: new Date(base),
    },
    // Unresolved spin in the middle of the run.
    {
      stationId,
      showId,
      confidence: "text",
      rawArtist: `Raw Gamma ${run}`,
      rawTitle: "Gamma Track",
      playedAt: new Date(base + 1 * MIN),
    },
    // Latest spin: resolved to A — this is "now".
    {
      stationId,
      showId,
      mbid: MBID_A,
      confidence: "text",
      rawArtist: "raw-a",
      rawTitle: "raw-a-t",
      playedAt: new Date(base + 2 * MIN),
    },
  ]);

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable || stationIds.length === 0) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, stationIds));
  if (showIds.length)
    await db.delete(showsTable).where(inArray(showsTable.id, showIds));
  await db
    .delete(trackClaimsTable)
    .where(inArray(trackClaimsTable.mbid, [MBID_A, MBID_B]));
  await db
    .delete(recordingsTable)
    .where(inArray(recordingsTable.mbid, [MBID_A, MBID_B]));
  await db.delete(stationsTable).where(inArray(stationsTable.id, stationIds));
});

describe("GET /api/player/onair", () => {
  it("lists the live station with now/earlier and null matchCount when anonymous", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/player/onair`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        station: { slug: string };
        show: { name: string; djName: string | null } | null;
        now: { mbid: string | null; artist: string; resolved: boolean };
        earlier: string[];
        matchCount: number | null;
      }>;
      authenticated: boolean;
    };
    expect(body.authenticated).toBe(false);

    const mine = body.items.find((i) => i.station.slug === slug);
    expect(mine).toBeDefined();
    expect(mine!.show).toEqual({ name: `Test WP Show ${run}`, djName: "DJ Wp" });
    expect(mine!.now.mbid).toBe(MBID_A);
    expect(mine!.now.artist).toBe(`Alpha Artist ${run}`);
    expect(mine!.now.resolved).toBe(true);
    // Earlier excludes the "now" artist; unresolved falls back to rawArtist.
    expect(mine!.earlier).toContain(`Raw Gamma ${run}`);
    expect(mine!.earlier).toContain(`Beta Artist ${run}`);
    expect(mine!.earlier).not.toContain(`Alpha Artist ${run}`);
    expect(mine!.matchCount).toBeNull();
  });
});

describe("GET /api/player/run/:slug", () => {
  it("returns tonight's run partition, everything in newToYou when anonymous", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/player/run/${slug}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      station: { slug: string; name: string };
      show: { name: string; djName: string | null } | null;
      day: string;
      spinCount: number;
      overlapPct: number | null;
      fromLibrary: unknown[];
      newToYou: Array<{ mbid: string | null; resolved: boolean; inLibrary: boolean }>;
      trove: unknown;
      authenticated: boolean;
    };

    expect(body.station.slug).toBe(slug);
    expect(body.show).toEqual({ name: `Test WP Show ${run}`, djName: "DJ Wp" });
    expect(body.day).toBe(DAY);
    expect(body.spinCount).toBe(3);
    expect(body.overlapPct).toBeNull();
    expect(body.fromLibrary).toHaveLength(0);
    expect(body.newToYou).toHaveLength(3);
    expect(body.newToYou.every((s) => s.inLibrary === false)).toBe(true);
    // Newest first; unresolved spin keeps resolved:false with null mbid.
    expect(body.newToYou[0]!.mbid).toBe(MBID_A);
    expect(body.newToYou[1]!.mbid).toBeNull();
    expect(body.newToYou[1]!.resolved).toBe(false);
    // Trove requires auth.
    expect(body.trove).toBeNull();
    expect(body.authenticated).toBe(false);
  });

  it("404s for an unknown station", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/player/run/definitely-not-${run}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/player/lore-counts", () => {
  it("counts published claims per mbid and returns zeros for unknown mbids", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(
      `${baseUrl}/api/player/lore-counts?mbids=${MBID_A},${MBID_B},unknown-${run}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        mbid: string;
        artifactCount: number;
        listCount: number;
        keptSince: string | null;
      }>;
    };
    expect(body.items).toHaveLength(3);
    const byMbid = new Map(body.items.map((i) => [i.mbid, i]));
    expect(byMbid.get(MBID_A)!.artifactCount).toBe(1);
    expect(byMbid.get(MBID_B)!.artifactCount).toBe(0);
    expect(byMbid.get(`unknown-${run}`)!.artifactCount).toBe(0);
    expect(body.items.every((i) => i.keptSince === null)).toBe(true);
  });

  it("returns empty items for a missing mbids param", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const res = await fetch(`${baseUrl}/api/player/lore-counts`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});
