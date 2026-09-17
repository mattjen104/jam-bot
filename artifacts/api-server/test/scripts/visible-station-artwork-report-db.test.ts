// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, stationsTable } from "@workspace/db";
import { selectVisibleStationArtworkRows } from "../../src/scripts/generate-visible-station-artwork-report.js";
import { createStationFixtureTracker } from "../station-fixtures.js";

const run = randomUUID().slice(0, 8);
const fixtures = createStationFixtureTracker();
let dbAvailable = false;

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
        slug: `test-artwork-${run}-z`,
        name: `Artwork Alpha ${run}`,
        streamUrl: `https://artwork-${run}.example.invalid/z`,
        active: true,
        hidden: false,
        logoSource: "curated",
        logoWidth: 1200,
        logoHeight: 800,
        stationIconSource: "website",
        stationIconWidth: 96,
        stationIconHeight: 96,
      },
      {
        slug: `test-artwork-${run}-a`,
        name: `Artwork Alpha ${run}`,
        streamUrl: `https://artwork-${run}.example.invalid/a`,
        active: true,
        hidden: false,
        logoSource: "website",
        logoWidth: 640,
        logoHeight: 480,
        stationIconSource: "radio_browser",
        stationIconWidth: 64,
        stationIconHeight: 64,
      },
      {
        slug: `test-artwork-${run}-beta`,
        name: `Artwork Beta ${run}`,
        streamUrl: `https://artwork-${run}.example.invalid/beta`,
        active: true,
        hidden: false,
        logoUrl: "https://example.invalid/logo.png",
      },
      {
        slug: `test-artwork-${run}-gamma`,
        name: `Artwork Gamma ${run}`,
        streamUrl: `https://artwork-${run}.example.invalid/gamma`,
        active: true,
        hidden: false,
        stationIconUrl: "https://example.invalid/icon.png",
      },
      {
        slug: `test-artwork-${run}-complete`,
        name: `Artwork Complete ${run}`,
        streamUrl: `https://artwork-${run}.example.invalid/complete`,
        active: true,
        hidden: false,
        logoUrl: "https://example.invalid/logo-complete.png",
        stationIconUrl: "https://example.invalid/icon-complete.png",
      },
      {
        slug: `test-artwork-${run}-hidden`,
        name: `Artwork Hidden ${run}`,
        streamUrl: `https://artwork-${run}.example.invalid/hidden`,
        active: true,
        hidden: true,
      },
      {
        slug: `test-artwork-${run}-inactive`,
        name: `Artwork Inactive ${run}`,
        streamUrl: `https://artwork-${run}.example.invalid/inactive`,
        active: false,
        hidden: false,
      },
    ])
    .returning({ id: stationsTable.id });
  for (const station of stations) fixtures.track(station.id);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await fixtures.cleanup();
});

describe("visible station artwork report query", () => {
  it("includes active visible stations missing either artwork role, excludes complete stations, and orders by name then slug", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const rows = await selectVisibleStationArtworkRows();
    const fixtureRows = rows.filter((row) => row.slug.startsWith(`test-artwork-${run}-`));

    expect(fixtureRows.map((row) => row.slug)).toEqual([
      `test-artwork-${run}-a`,
      `test-artwork-${run}-z`,
      `test-artwork-${run}-beta`,
      `test-artwork-${run}-gamma`,
    ]);
    expect(fixtureRows).toEqual([
      {
        name: `Artwork Alpha ${run}`,
        slug: `test-artwork-${run}-a`,
        homepage_url: null,
        logo_url: null,
        logo_source: "website",
        logo_width: 640,
        logo_height: 480,
        logo_checked_at: null,
        logo_check_state: "never_checked",
        station_icon_url: null,
        station_icon_source: "radio_browser",
        station_icon_width: 64,
        station_icon_height: 64,
        station_icon_checked_at: null,
        station_icon_check_state: "never_checked",
      },
      {
        name: `Artwork Alpha ${run}`,
        slug: `test-artwork-${run}-z`,
        homepage_url: null,
        logo_url: null,
        logo_source: "curated",
        logo_width: 1200,
        logo_height: 800,
        logo_checked_at: null,
        logo_check_state: "never_checked",
        station_icon_url: null,
        station_icon_source: "website",
        station_icon_width: 96,
        station_icon_height: 96,
        station_icon_checked_at: null,
        station_icon_check_state: "never_checked",
      },
      {
        name: `Artwork Beta ${run}`,
        slug: `test-artwork-${run}-beta`,
        homepage_url: null,
        logo_url: "https://example.invalid/logo.png",
        logo_source: null,
        logo_width: null,
        logo_height: null,
        logo_checked_at: null,
        logo_check_state: "present",
        station_icon_url: null,
        station_icon_source: null,
        station_icon_width: null,
        station_icon_height: null,
        station_icon_checked_at: null,
        station_icon_check_state: "never_checked",
      },
      {
        name: `Artwork Gamma ${run}`,
        slug: `test-artwork-${run}-gamma`,
        homepage_url: null,
        logo_url: null,
        logo_source: null,
        logo_width: null,
        logo_height: null,
        logo_checked_at: null,
        logo_check_state: "never_checked",
        station_icon_url: "https://example.invalid/icon.png",
        station_icon_source: null,
        station_icon_width: null,
        station_icon_height: null,
        station_icon_checked_at: null,
        station_icon_check_state: "present",
      },
    ]);
  });
});