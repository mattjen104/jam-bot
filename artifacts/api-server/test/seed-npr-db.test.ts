import { describe, it, expect, beforeAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  stationsTable,
  radioBrowserStationsTable,
} from "@workspace/db";
import { seedStations, ensureIcyHealthRows } from "../src/lore/seed.js";

/**
 * Integration test for the NPR-list station enrollment being deterministic in
 * code — the exact gap that made earlier hand-inserted stations invisible in
 * a fresh environment. Verifies that after `seedStations()` (the same call
 * boot makes):
 *   - all four stations exist with source="curated" (purge-exempt) and their
 *     verified now-playing wiring;
 *   - the Radiojar pair polls the JSON API (config {streamId}), never the
 *     tokenized stream;
 *   - the ICY pair's nowPlayingConfig carries BOTH streamUrl and a
 *     radioBrowserId that points at a real radio_browser_stations health row
 *     linked back to the station (the silent-never-polls failure mode);
 *   - re-running the seed converges (idempotent, no duplicate health rows).
 * Runs against the real seed rows on purpose (they're canonical data, not
 * fixtures), so there is no cleanup. Self-skips without a real DB.
 */
const SLUGS = [
  "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f", // KCHUNG
  "rb-308a9f58-fb54-44dc-b95d-bb40fe4f3631", // Radio AlHara
  "radio-nopal",
  "lookout-fm",
] as const;

let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
  if (dbAvailable) {
    await seedStations();
  }
}, 60_000);

describe("NPR-list station seed enrollment", () => {
  it("enrolls all four stations as curated with homepage link-outs", async () => {
    if (!dbAvailable) return;
    const rows = await db
      .select()
      .from(stationsTable)
      .where(inArray(stationsTable.slug, [...SLUGS]));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.source).toBe("curated");
      expect(row.stationClass).toBe("curated");
      expect(row.homepageUrl).toBeTruthy();
      expect(row.streamUrl).toBeTruthy();
      // GET /api/stations filters active=true — an inactive row is invisible.
      expect(row.active).toBe(true);
    }
  });

  it("reactivates a legacy row a previous ICY failure deactivated", async () => {
    if (!dbAvailable) return;
    // Simulate production: KCHUNG's old dead stream tripped the ICY error
    // threshold and the row was deactivated — hidden from GET /api/stations.
    const slug = "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f";
    await db
      .update(stationsTable)
      .set({ active: false })
      .where(eq(stationsTable.slug, slug));
    await seedStations();
    const [row] = await db
      .select({ active: stationsTable.active })
      .from(stationsTable)
      .where(eq(stationsTable.slug, slug))
      .limit(1);
    expect(row?.active).toBe(true);
  });

  it("wires the Radiojar pair to the JSON API adapter, not ICY", async () => {
    if (!dbAvailable) return;
    const expected: Record<string, string> = {
      "rb-308a9f58-fb54-44dc-b95d-bb40fe4f3631": "78cxy6wkxtzuv",
      "lookout-fm": "5f3y7sbg342vv",
    };
    for (const [slug, streamId] of Object.entries(expected)) {
      const [row] = await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.slug, slug))
        .limit(1);
      expect(row?.nowPlayingSource).toBe("radiojar");
      expect((row?.nowPlayingConfig as Record<string, unknown>)?.streamId).toBe(
        streamId,
      );
    }
  });

  it("gives each ICY station a linked, active health row and a complete config", async () => {
    if (!dbAvailable) return;
    const icySlugs = [
      "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f",
      "radio-nopal",
    ];
    for (const slug of icySlugs) {
      const [station] = await db
        .select()
        .from(stationsTable)
        .where(eq(stationsTable.slug, slug))
        .limit(1);
      expect(station?.nowPlayingSource).toBe("radio_browser_icy");

      const config = station?.nowPlayingConfig as Record<string, unknown>;
      // The radio_browser_icy adapter reads config.streamUrl only — a config
      // without it silently never polls.
      expect(config?.streamUrl).toBe(station?.streamUrl);
      expect(typeof config?.radioBrowserId).toBe("number");

      const [rbRow] = await db
        .select()
        .from(radioBrowserStationsTable)
        .where(eq(radioBrowserStationsTable.id, config.radioBrowserId as number))
        .limit(1);
      expect(rbRow?.stationId).toBe(station?.id);
      expect(rbRow?.streamUrl).toBe(station?.streamUrl);
      expect(rbRow?.icyStatus).toBe("active");
    }
  });

  it("flips a previously auto-enrolled row back to source=curated (purge exemption)", async () => {
    if (!dbAvailable) return;
    // Simulate the production state: KCHUNG was auto-enrolled by the
    // radio-browser sync with source="radio_browser", which puts it in scope
    // for the whitelist purge. The seed must reclaim it as curated.
    const slug = "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f";
    await db
      .update(stationsTable)
      .set({ source: "radio_browser" })
      .where(eq(stationsTable.slug, slug));
    await seedStations();
    const [row] = await db
      .select({ source: stationsTable.source })
      .from(stationsTable)
      .where(eq(stationsTable.slug, slug))
      .limit(1);
    expect(row?.source).toBe("curated");
  });

  it("is idempotent — re-running ensureIcyHealthRows creates no duplicate rows", async () => {
    if (!dbAvailable) return;
    const uuids = ["b58a4aaa-d5be-4925-be71-f69d1cccc13f", "manual-radio-nopal"];
    const before = await db
      .select({ id: radioBrowserStationsTable.id })
      .from(radioBrowserStationsTable)
      .where(inArray(radioBrowserStationsTable.radioBrowserUuid, uuids));
    await ensureIcyHealthRows();
    const after = await db
      .select({ id: radioBrowserStationsTable.id })
      .from(radioBrowserStationsTable)
      .where(inArray(radioBrowserStationsTable.radioBrowserUuid, uuids));
    expect(after.map((r) => r.id).sort()).toEqual(
      before.map((r) => r.id).sort(),
    );
    expect(after).toHaveLength(2);
  });
});
