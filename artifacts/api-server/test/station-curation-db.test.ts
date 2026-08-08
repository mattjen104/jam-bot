/**
 * Station curation — DB-backed integration tests.
 *
 * Covers:
 *   1. crossing_eligible flag — FIP sub-channels seeded with false, main + electro true
 *   2. Seed idempotence — re-seeding does not flip crossingEligible back to true
 *   3. Crossing-surface exclusion — crossingEligible=false station absent from
 *      crossing queries but history (spins) preserved in DB
 *   4. 7-day station-silence health endpoint — correct classification of
 *      neverSeen vs previouslyActive; active stations excluded
 *   5. FK-safe removal — purgeNonQualifyingStations clears dependents in order
 *      without FK violations
 *
 * Runs against the real shared Postgres instance (vitest.db.config.ts).
 * Self-skips gracefully when no DB is reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  spinsTable,
  showsTable,
  radioBrowserStationsTable,
} from "@workspace/db";
import { applyStationDiscoveryMigration } from "../src/lore/station-migration.js";
import { seedStations } from "../src/lore/seed.js";
import { purgeNonQualifyingStations } from "../src/lore/radio-browser.js";

const run = randomUUID().slice(0, 8);
let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbAvailable = true;
    // Ensure crossing_eligible column exists before any test runs.
    // applyStationDiscoveryMigration uses ADD COLUMN IF NOT EXISTS — idempotent.
    await applyStationDiscoveryMigration();
  } catch {
    dbAvailable = false;
  }
}, 60_000);

function skip(ctx: { skip: () => void }) {
  if (!dbAvailable) ctx.skip();
}

// ---------------------------------------------------------------------------
// 1 + 2. FIP seed — crossing_eligible values and idempotence
// ---------------------------------------------------------------------------

describe("FIP seed — crossing_eligible values", () => {
  it("fip-main is seeded with crossingEligible=true", async (ctx) => {
    skip(ctx);
    await seedStations();
    const [row] = await db
      .select({ crossingEligible: stationsTable.crossingEligible })
      .from(stationsTable)
      .where(eq(stationsTable.slug, "fip-main"))
      .limit(1);
    expect(row?.crossingEligible).toBe(true);
  });

  it("fip-electro is seeded with crossingEligible=true", async (ctx) => {
    skip(ctx);
    await seedStations();
    const [row] = await db
      .select({ crossingEligible: stationsTable.crossingEligible })
      .from(stationsTable)
      .where(eq(stationsTable.slug, "fip-electro"))
      .limit(1);
    expect(row?.crossingEligible).toBe(true);
  });

  it.each(["fip-rock", "fip-jazz", "fip-groove", "fip-world", "fip-reggae", "fip-metal"])(
    "%s is seeded with crossingEligible=false",
    async (slug, ctx) => {
      skip(ctx);
      await seedStations();
      const [row] = await db
        .select({ crossingEligible: stationsTable.crossingEligible })
        .from(stationsTable)
        .where(eq(stationsTable.slug, slug))
        .limit(1);
      expect(row?.crossingEligible).toBe(false);
    },
  );

  it("re-seeding does not flip crossingEligible=false back to true for sub-channels", async (ctx) => {
    skip(ctx);
    await seedStations();
    await seedStations(); // second pass — onConflictDoUpdate must preserve the flag
    const rows = await db
      .select({ slug: stationsTable.slug, crossingEligible: stationsTable.crossingEligible })
      .from(stationsTable)
      .where(
        inArray(stationsTable.slug, [
          "fip-rock", "fip-jazz", "fip-groove", "fip-world", "fip-reggae", "fip-metal",
        ]),
      );
    for (const row of rows) {
      expect(row.crossingEligible).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Crossing-surface exclusion — history preserved, crossing surface filtered
// ---------------------------------------------------------------------------

describe("crossingEligible=false — history preserved, excluded from crossing", () => {
  const stationSlug = `test-fip-sub-${run}`;
  let stationId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable) return;
    const [row] = await db
      .insert(stationsTable)
      .values({
        slug: stationSlug,
        name: `FIP Sub Test ${run}`,
        streamUrl: "https://example.invalid/stream",
        stationClass: "curated",
        nowPlayingSource: "fip",
        crossingEligible: false,
        active: true,
        hidden: false,
      })
      .returning({ id: stationsTable.id });
    stationId = row!.id;

    // Insert a spin to verify history is preserved despite crossing exclusion.
    await db.insert(spinsTable).values({
      stationId: stationId!,
      confidence: "unresolved" as const,
      rawArtist: "Test Artist",
      rawTitle: "Test Title",
      playedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    if (!dbAvailable || !stationId) return;
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  });

  it("crossingEligible=false station does NOT appear in the crossing-surface station query", async (ctx) => {
    skip(ctx);
    // Simulates the filter applied by GET /api/stations and GET /api/stations/now-playing.
    const rows = await db
      .select({ slug: stationsTable.slug })
      .from(stationsTable)
      .where(
        sql`active = true AND hidden = false AND crossing_eligible = true AND slug = ${stationSlug}`,
      );
    expect(rows).toHaveLength(0);
  });

  it("crossingEligible=false station DOES exist in DB with spins intact", async (ctx) => {
    skip(ctx);
    const [station] = await db
      .select({ id: stationsTable.id, crossingEligible: stationsTable.crossingEligible })
      .from(stationsTable)
      .where(eq(stationsTable.slug, stationSlug))
      .limit(1);
    expect(station).toBeDefined();
    expect(station!.crossingEligible).toBe(false);

    const { rows: spinRows } = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM spins WHERE station_id = ${stationId!}
    `);
    expect(Number(spinRows[0]?.count ?? 0)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. 7-day station-silence health endpoint
// ---------------------------------------------------------------------------

describe("GET /health/station-silence", () => {
  const silentSlug = `test-silence-${run}`;
  const activeSlug = `test-active-${run}`;
  const neverSlug = `test-never-${run}`;
  let silentId: number | undefined;
  let activeId: number | undefined;
  let neverId: number | undefined;
  let server: import("node:http").Server | undefined;
  let baseUrl = "";

  beforeAll(async () => {
    if (!dbAvailable) return;

    const app = (await import("../src/app.js")).default;
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const addr = server.address();
    if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;

    // "Previously active" station: had a spin > 7 days ago, none recently.
    const [silentRow] = await db
      .insert(stationsTable)
      .values({
        slug: silentSlug,
        name: `Silence Test ${run}`,
        streamUrl: "https://example.invalid/silent",
        stationClass: "community",
        nowPlayingSource: "spinitron_web",
        crossingEligible: true,
        active: true,
        hidden: false,
      })
      .returning({ id: stationsTable.id });
    silentId = silentRow!.id;

    await db.insert(spinsTable).values({
      stationId: silentId!,
      confidence: "unresolved" as const,
      rawArtist: "Old Artist",
      rawTitle: "Old Title",
      // Spin is 8 days in the past — outside the 7-day window.
      playedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    // "Active" station: has a recent spin — must NOT appear in silence results.
    const [activeRow] = await db
      .insert(stationsTable)
      .values({
        slug: activeSlug,
        name: `Active Test ${run}`,
        streamUrl: "https://example.invalid/active",
        stationClass: "community",
        nowPlayingSource: "spinitron_web",
        crossingEligible: true,
        active: true,
        hidden: false,
      })
      .returning({ id: stationsTable.id });
    activeId = activeRow!.id;

    await db.insert(spinsTable).values({
      stationId: activeId!,
      confidence: "unresolved" as const,
      rawArtist: "Recent Artist",
      rawTitle: "Recent Title",
      playedAt: new Date(Date.now() - 60 * 1000),
    });

    // "Never seen" station: active + source set but zero spins ever.
    const [neverRow] = await db
      .insert(stationsTable)
      .values({
        slug: neverSlug,
        name: `Never Seen ${run}`,
        streamUrl: "https://example.invalid/never",
        stationClass: "community",
        nowPlayingSource: "spinitron_web",
        crossingEligible: true,
        active: true,
        hidden: false,
      })
      .returning({ id: stationsTable.id });
    neverId = neverRow!.id;
  }, 60_000);

  afterAll(async () => {
    server?.close();
    if (!dbAvailable) return;
    for (const id of [silentId, activeId, neverId]) {
      if (!id) continue;
      await db.delete(spinsTable).where(eq(spinsTable.stationId, id));
      await db.delete(stationsTable).where(eq(stationsTable.id, id));
    }
  });

  // Health routes are mounted via router.use(healthRouter) inside the /api
  // router, so every health endpoint lives at /api/health/... not /health/...
  const silenceUrl = () => `${baseUrl}/api/health/station-silence`;

  it("returns 200 with the correct shape", async (ctx) => {
    skip(ctx);
    const res = await fetch(silenceUrl());
    expect(res.status).toBe(200);
    const body = await res.json() as {
      monitoringNote: string;
      neverSeen: unknown[];
      previouslyActive: unknown[];
      totalSilent: number;
    };
    expect(typeof body.monitoringNote).toBe("string");
    expect(Array.isArray(body.neverSeen)).toBe(true);
    expect(Array.isArray(body.previouslyActive)).toBe(true);
    expect(typeof body.totalSilent).toBe("number");
    expect(body.totalSilent).toBe(body.neverSeen.length + body.previouslyActive.length);
  });

  it("classifies a station with an old spin (>7 days) as previouslyActive", async (ctx) => {
    skip(ctx);
    const res = await fetch(silenceUrl());
    const body = await res.json() as {
      previouslyActive: Array<{ slug: string; lastSpinAt: string; nowPlayingSource: string }>;
    };
    const entry = body.previouslyActive.find((e) => e.slug === silentSlug);
    expect(entry).toBeDefined();
    expect(entry!.lastSpinAt).toBeTruthy();
    expect(entry!.nowPlayingSource).toBe("spinitron_web");
    // lastSpinAt must be the old spin timestamp (> 7 days ago).
    const lastSpinAge = Date.now() - new Date(entry!.lastSpinAt).getTime();
    expect(lastSpinAge).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 60_000);
  });

  it("classifies a station with zero spins ever as neverSeen", async (ctx) => {
    skip(ctx);
    const res = await fetch(silenceUrl());
    const body = await res.json() as { neverSeen: Array<{ slug: string }> };
    const entry = body.neverSeen.find((e) => e.slug === neverSlug);
    expect(entry).toBeDefined();
  });

  it("does NOT include stations with recent spins (within 7 days)", async (ctx) => {
    skip(ctx);
    const res = await fetch(silenceUrl());
    const body = await res.json() as {
      neverSeen: Array<{ slug: string }>;
      previouslyActive: Array<{ slug: string }>;
    };
    const allSlugs = [
      ...body.neverSeen.map((e) => e.slug),
      ...body.previouslyActive.map((e) => e.slug),
    ];
    expect(allSlugs).not.toContain(activeSlug);
  });
});

// ---------------------------------------------------------------------------
// 5. FK-safe removal — purgeNonQualifyingStations
// ---------------------------------------------------------------------------

describe("purgeNonQualifyingStations — FK-safe removal in documented order", () => {
  const purgeSlug = `test-purge-${run}`;
  let purgeStationId: number | undefined;

  beforeAll(async () => {
    if (!dbAvailable) return;

    // Insert a radio_browser station with bitrate=32 (below MIN_BITRATE_KBPS=128)
    // so purgeNonQualifyingStations will target it.
    const [row] = await db
      .insert(stationsTable)
      .values({
        slug: purgeSlug,
        name: `Purge Test ${run}`,
        streamUrl: "https://example.invalid/purge",
        stationClass: "curated",
        source: "radio_browser",
        bitrate: 32,
        votes: 200,
        tags: ["ambient"],
        active: true,
        hidden: false,
        nowPlayingSource: "radio_browser_icy",
      })
      .returning({ id: stationsTable.id });
    purgeStationId = row!.id;

    // Add dependents that must be cleared in FK order before the station row.
    await db.insert(spinsTable).values({
      stationId: purgeStationId!,
      confidence: "unresolved" as const,
      rawArtist: "Artist",
      rawTitle: "Title",
      playedAt: new Date(),
    });
    await db.insert(showsTable).values({
      stationId: purgeStationId!,
      name: `Show ${run}`,
    });
    await db.insert(radioBrowserStationsTable).values({
      radioBrowserUuid: `test-purge-uuid-${run}`,
      streamUrl: "https://example.invalid/purge",
      name: `Purge Test ${run}`,
      stationId: purgeStationId!,
      icyStatus: "active",
      consecutiveErrors: 0,
      updatedAt: new Date(),
    });
  }, 30_000);

  afterAll(async () => {
    // Cleanup in case the purge test itself didn't run (test isolation).
    if (!dbAvailable || !purgeStationId) return;
    await db.delete(radioBrowserStationsTable).where(
      eq(radioBrowserStationsTable.stationId, purgeStationId),
    );
    await db.delete(spinsTable).where(eq(spinsTable.stationId, purgeStationId));
    await db.delete(showsTable).where(eq(showsTable.stationId, purgeStationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, purgeStationId));
  });

  it("removes a failing radio_browser station and all dependents without FK violations", async (ctx) => {
    skip(ctx);
    // The documented FK order in lore-station-deletion-fk-order.md:
    //   spins → shows → radio_browser_stations → station_quality → stations
    // purgeNonQualifyingStations must follow this order or hit a 23503.
    await expect(purgeNonQualifyingStations()).resolves.not.toThrow();

    // Verify the station row is gone.
    const stationRows = await db
      .select({ id: stationsTable.id })
      .from(stationsTable)
      .where(eq(stationsTable.slug, purgeSlug));
    expect(stationRows).toHaveLength(0);

    // Verify spins are gone.
    const { rows: spinRows } = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM spins WHERE station_id = ${purgeStationId!}
    `);
    expect(Number(spinRows[0]?.count ?? 0)).toBe(0);

    // Verify radio_browser_stations row is gone.
    const rbRows = await db
      .select({ id: radioBrowserStationsTable.id })
      .from(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.stationId, purgeStationId!));
    expect(rbRows).toHaveLength(0);
  });
});
