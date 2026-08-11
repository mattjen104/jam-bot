import { describe, it, expect, beforeAll } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { db, stationsTable } from "@workspace/db";
import { seedStations } from "../src/lore/seed.js";
import { applyStationBlocklistHideMigration } from "../src/lore/station-blocklist-hide-migration.js";

/**
 * DB regression test: CHMR/CISM restore path survives server restarts.
 *
 * Scenario: an operator has confirmed a now-playing source for CHMR/CISM,
 * configured it via PATCH /api/admin/stations/:id/now-playing-source, and
 * unhidden the station. The next boot must NOT:
 *   a) wipe the configured nowPlayingSource/nowPlayingConfig (the seed upsert
 *      used COALESCE before the fix but {} is non-null so it always picked the
 *      seed's empty config — this regression covers that exact bug)
 *   b) re-hide the station (the blocklist migration now gates on source IS NULL)
 *
 * The test simulates a full restart by calling seedStations() then
 * applyStationBlocklistHideMigration() after the manual admin configuration.
 */

let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
  if (dbAvailable) {
    // Start from a clean seed state.
    await seedStations();
    await applyStationBlocklistHideMigration();
  }
}, 90_000);

describe("CHMR/CISM restore path", () => {
  it("CHMR and CISM are hidden with null source after initial seed + migration", async () => {
    if (!dbAvailable) return;
    const rows = await db
      .select({
        slug: stationsTable.slug,
        hidden: stationsTable.hidden,
        nowPlayingSource: stationsTable.nowPlayingSource,
      })
      .from(stationsTable)
      .where(inArray(stationsTable.slug, ["chmr", "cism"]));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.hidden).toBe(true);
      expect(row.nowPlayingSource).toBeNull();
    }
  });

  it("survives a full restart cycle after an operator configures a source — source, config, and visibility all persist", async () => {
    if (!dbAvailable) return;

    // ── Step 1: Simulate operator configuring a source + unhiding ──────────
    // Use a real pollable source value with a non-trivial config to exercise
    // the config-preservation path.  spinitron_web with a callsign is a
    // realistic example of what a future CHMR/CISM operator might choose.
    await db
      .update(stationsTable)
      .set({
        nowPlayingSource: "spinitron_web",
        nowPlayingConfig: { callsign: "CHMR" },
        hidden: false,
        updatedAt: new Date(),
      })
      .where(sql`${stationsTable.slug} = ${"chmr"}`);

    await db
      .update(stationsTable)
      .set({
        nowPlayingSource: "spinitron_web",
        nowPlayingConfig: { callsign: "CISM" },
        hidden: false,
        updatedAt: new Date(),
      })
      .where(sql`${stationsTable.slug} = ${"cism"}`);

    // Sanity-check the pre-restart state.
    const preRestart = await db
      .select({
        slug: stationsTable.slug,
        hidden: stationsTable.hidden,
        nowPlayingSource: stationsTable.nowPlayingSource,
        nowPlayingConfig: stationsTable.nowPlayingConfig,
      })
      .from(stationsTable)
      .where(inArray(stationsTable.slug, ["chmr", "cism"]));
    for (const row of preRestart) {
      expect(row.hidden).toBe(false);
      expect(row.nowPlayingSource).toBe("spinitron_web");
    }

    // ── Step 2: Simulate server restart ────────────────────────────────────
    await seedStations();
    await applyStationBlocklistHideMigration();

    // ── Step 3: Assert operator config survived ─────────────────────────────
    const postRestart = await db
      .select({
        slug: stationsTable.slug,
        hidden: stationsTable.hidden,
        nowPlayingSource: stationsTable.nowPlayingSource,
        nowPlayingConfig: stationsTable.nowPlayingConfig,
      })
      .from(stationsTable)
      .where(inArray(stationsTable.slug, ["chmr", "cism"]));

    expect(postRestart).toHaveLength(2);
    for (const row of postRestart) {
      // Station must NOT be re-hidden — the blocklist migration is a no-op
      // when nowPlayingSource is non-null.
      expect(row.hidden).toBe(
        false,
        `${row.slug} was re-hidden after restart despite having a configured source`,
      );

      // Source must NOT be wiped by the seed's null value.
      expect(row.nowPlayingSource).toBe(
        "spinitron_web",
        `${row.slug} nowPlayingSource was overwritten by seed restart`,
      );

      // Config must NOT be overwritten with the seed's empty object {}.
      // This is the specific regression the CASE fix addresses: COALESCE on {}
      // always picked the seed's {}, silently erasing the callsign.
      const config = row.nowPlayingConfig as Record<string, unknown> | null;
      expect(config?.callsign).toBe(
        row.slug === "chmr" ? "CHMR" : "CISM",
        `${row.slug} nowPlayingConfig.callsign was erased by seed restart (regression: COALESCE picked seed {} over DB value)`,
      );
    }
  });

  it("the hide migration is a no-op once nowPlayingSource is set (predicate requires source IS NULL)", async () => {
    if (!dbAvailable) return;
    // At this point CHMR/CISM have nowPlayingSource="spinitron_web" (set by the
    // previous test) and hidden=false. Running the migration again must leave them
    // visible — the `OR (slug IN ('chmr','cism') AND now_playing_source IS NULL)`
    // predicate evaluates false when source is non-null.
    await applyStationBlocklistHideMigration();

    const rows = await db
      .select({ slug: stationsTable.slug, hidden: stationsTable.hidden })
      .from(stationsTable)
      .where(inArray(stationsTable.slug, ["chmr", "cism"]));
    for (const row of rows) {
      expect(row.hidden).toBe(
        false,
        `${row.slug} was unexpectedly re-hidden by the migration even though nowPlayingSource is non-null`,
      );
    }
  });

  it("the hide migration still hides CHMR/CISM when source is cleared back to null", async () => {
    if (!dbAvailable) return;
    // Reset to null to confirm the migration picks them up again in that state.
    await db
      .update(stationsTable)
      .set({ nowPlayingSource: null, nowPlayingConfig: {}, hidden: false, updatedAt: new Date() })
      .where(inArray(stationsTable.slug, ["chmr", "cism"]));

    await applyStationBlocklistHideMigration();

    const rows = await db
      .select({ slug: stationsTable.slug, hidden: stationsTable.hidden })
      .from(stationsTable)
      .where(inArray(stationsTable.slug, ["chmr", "cism"]));
    for (const row of rows) {
      expect(row.hidden).toBe(true);
    }
  });
});
