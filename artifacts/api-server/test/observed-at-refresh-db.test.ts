import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db, stationsTable, spinsTable } from "@workspace/db";
import { logSpinIfChanged, ingestRawSpins } from "../src/lore/resolve.js";
import { classifyFreshness } from "../src/lore/freshness.js";

/**
 * Freshness observation-refresh coverage: a healthy station that keeps
 * reporting the SAME current track must stay fresh — each unchanged poll is a
 * confirmation the track is still on air, so it refreshes the latest spin's
 * observed_at without writing a new spin. A station with NO successful
 * observations goes stale.
 *
 * Rows are fully isolated (unique slug) and cleaned up. Tests skip gracefully
 * when no DB is reachable.
 */
const run = randomUUID().slice(0, 8);
const SLUG = `test-obsrefresh-${run}`;

let dbAvailable = false;
let stationId: number | undefined;
let station: typeof stationsTable.$inferSelect | undefined;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [row] = await db
    .insert(stationsTable)
    .values({
      slug: SLUG,
      name: `Test ObsRefresh ${run}`,
      streamUrl: "http://example.invalid/obsrefresh",
      stationClass: "community",
      nowPlayingSource: "radio_browser_icy",
    })
    .returning();
  station = row!;
  stationId = row!.id;
});

afterAll(async () => {
  if (!dbAvailable || !stationId) return;
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, [stationId]));
  await db.execute(sql`DELETE FROM station_quality WHERE station_id = ${stationId}`);
  await db.delete(stationsTable).where(inArray(stationsTable.id, [stationId]));
});

describe("observed_at refresh on unchanged observations", () => {
  it("logSpinIfChanged refreshes observed_at when the same track is re-observed past 2× cadence (stays fresh, no new spin)", async (ctx) => {
    if (!dbAvailable || !station || !stationId) return ctx.skip();

    // Seed the current spin with an observation 4 minutes old — well past
    // 2× the 30s ICY cadence, i.e. it would classify stale without a refresh.
    const oldObserved = new Date(Date.now() - 4 * 60_000);
    const [seeded] = await db
      .insert(spinsTable)
      .values({
        stationId,
        rawArtist: "Fleetwood Mac",
        rawTitle: "Go Your Own Way",
        source: "radio_browser_icy",
        confidence: "unresolved",
        playedAt: oldObserved,
        observedAt: oldObserved,
      })
      .returning({ id: spinsTable.id });
    expect(classifyFreshness("radio_browser_icy", oldObserved)).toBe("stale");

    // Same track reported again: dedup path, no new spin…
    const wrote = await logSpinIfChanged(station, {
      rawArtist: "Fleetwood Mac",
      rawTitle: "Go Your Own Way",
    });
    expect(wrote).toBe(false);
    const all = await db
      .select({ id: spinsTable.id, observedAt: spinsTable.observedAt })
      .from(spinsTable)
      .where(eq(spinsTable.stationId, stationId));
    expect(all).toHaveLength(1);

    // …but the observation timestamp was refreshed, so it classifies fresh
    // (hit flags therefore keep gating exactly as today — no downgrade).
    const refreshed = all.find((r) => r.id === seeded!.id)!;
    expect(refreshed.observedAt!.getTime()).toBeGreaterThan(oldObserved.getTime());
    expect(classifyFreshness("radio_browser_icy", refreshed.observedAt!)).toBe("fresh");
  });

  it("ingestRawSpins refreshes observed_at for a re-reported current play (stable-id dedup), but backfill does not", async (ctx) => {
    if (!dbAvailable || !station || !stationId) return ctx.skip();

    const oldObserved = new Date(Date.now() - 40 * 60_000);
    const externalId = `ext-${run}`;
    await db.insert(spinsTable).values({
      stationId,
      rawArtist: "Nina Simone",
      rawTitle: "Sinnerman",
      source: "spinitron",
      confidence: "unresolved",
      externalId,
      playedAt: oldObserved,
      observedAt: oldObserved,
    });

    // Live poll re-reports the same play id → observation refresh only.
    const logged = await ingestRawSpins(
      station,
      [{ rawArtist: "Nina Simone", rawTitle: "Sinnerman", externalId, playedAt: oldObserved }],
      "spinitron",
    );
    expect(logged).toBe(0);
    const [row] = await db
      .select({ observedAt: spinsTable.observedAt })
      .from(spinsTable)
      .where(eq(spinsTable.externalId, externalId));
    expect(row!.observedAt!.getTime()).toBeGreaterThan(oldObserved.getTime());

    // Reset, then a backfill sweep of the same id must NOT refresh — a
    // historical slice is not a "still on air" confirmation.
    await db
      .update(spinsTable)
      .set({ observedAt: oldObserved })
      .where(eq(spinsTable.externalId, externalId));
    await ingestRawSpins(
      station,
      [{ rawArtist: "Nina Simone", rawTitle: "Sinnerman", externalId, playedAt: oldObserved }],
      "spinitron",
      { backfill: true },
    );
    const [after] = await db
      .select({ observedAt: spinsTable.observedAt })
      .from(spinsTable)
      .where(eq(spinsTable.externalId, externalId));
    expect(after!.observedAt!.getTime()).toBe(oldObserved.getTime());
  });

  it("a spin with no further observations goes stale", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const observed = new Date(Date.now() - 4 * 60_000);
    expect(classifyFreshness("radio_browser_icy", observed)).toBe("stale");
  });
});
