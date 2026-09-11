// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pickersTable,
  scrapedShowsTable,
  showsTable,
  stationsTable,
} from "@workspace/db";
import { syncScrapedShowRowsAndPickers } from "../src/lore/scraped-shows-sync.js";
import { parseKzsuSchedule } from "../src/lore/schedule-scraper.js";
import { applyStationScheduleMigration } from "../src/lore/station-schedule-migration.js";

describe("scraped show multi-DJ sync", () => {
  const suffix = randomUUID().slice(0, 8);
  const stationSlug = `multi-dj-sync-${suffix}`;
  const compositeHandle = `show-dj-${stationSlug}-alice-bob`;
  let stationId = 0;
  let compositePickerId = 0;

  beforeAll(async () => {
    await applyStationScheduleMigration();
    const commaNameShow = parseKzsuSchedule(JSON.stringify({
      days: [{
        date: "2025-01-09",
        shows: [{
          title: "Comma Name",
          dj_name: "Smith, Jr.",
          start_time: "0900",
          duration: 60,
          special: false,
        }],
      }],
    }))!.recurringShows[0]!;
    const [station] = await db
      .insert(stationsTable)
      .values({
        slug: stationSlug,
        name: `Multi DJ Sync ${suffix}`,
        streamUrl: `https://example.com/${suffix}.mp3`,
        stationClass: "curated",
      })
      .returning({ id: stationsTable.id });
    stationId = station!.id;

    const [picker] = await db
      .insert(pickersTable)
      .values({
        pickerType: "dj",
        name: "Alice, Bob",
        handle: compositeHandle,
        sourceRef: { stationSlug, djName: "Alice, Bob" },
        trustTier: 2,
        active: true,
      })
      .returning({ id: pickersTable.id });
    compositePickerId = picker!.id;

    await db.insert(showsTable).values({
      stationId,
      name: "Co-Hosted",
      djName: "Alice, Bob",
      pickerId: compositePickerId,
    });
    await db.insert(showsTable).values({
      stationId,
      name: "Comma Name",
      djNames: ["Smith", "Jr."],
    });
    await db.insert(pickersTable).values([
      {
        pickerType: "dj",
        name: "Smith",
        handle: `show-dj-${stationSlug}-smith`,
        sourceRef: { stationSlug, djName: "Smith" },
        trustTier: 2,
        active: true,
      },
      {
        pickerType: "dj",
        name: "Jr.",
        handle: `show-dj-${stationSlug}-jr`,
        sourceRef: { stationSlug, djName: "Jr." },
        trustTier: 2,
        active: true,
      },
    ]);
    await db.insert(scrapedShowsTable).values([
      {
        stationId,
        showName: "Co-Hosted",
        dayOfWeek: "Mon",
        startTime: "09:00",
        endTime: "10:00",
        djName: "Alice, Bob",
        hostIdentityReviewNeeded: true,
        sourceUrl: "https://example.com/schedule",
        extraction: "manual",
      },
      {
        stationId,
        showName: "Solo",
        dayOfWeek: "Tue",
        startTime: "09:00",
        endTime: "10:00",
        djName: "Diane Kamikaze",
        sourceUrl: "https://example.com/schedule",
        extraction: "manual",
      },
      {
        stationId,
        showName: "Recovered Co-Hosted",
        dayOfWeek: "Fri",
        startTime: "09:00",
        endTime: "10:00",
        djName: null,
        djNames: ["Alice", "Bob"],
        sourceUrl: "https://example.com/schedule",
        extraction: "manual",
      },
      {
        stationId,
        ...commaNameShow,
        hostIdentityCheckedAt: new Date(),
        hostIdentityLegacyCredit: "Smith, Jr.",
        sourceUrl: "https://example.com/schedule",
        extraction: "manual",
      },
      {
        stationId,
        showName: "Generic Block",
        dayOfWeek: "Wed",
        startTime: "09:00",
        endTime: "10:00",
        djName: "Automation",
        sourceUrl: "https://example.com/schedule",
        extraction: "manual",
      },
    ]);
  });

  afterAll(async () => {
    if (!stationId) return;
    await db.delete(showsTable).where(eq(showsTable.stationId, stationId));
    await db
      .delete(scrapedShowsTable)
      .where(eq(scrapedShowsTable.stationId, stationId));
    await db.execute(sql`
      DELETE FROM pickers
      WHERE handle LIKE ${`show-dj-${stationSlug}-%`}
    `);
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  });

  it("leaves ambiguous legacy comma credits unchanged and syncs atomic names", async () => {
    await syncScrapedShowRowsAndPickers();
    await syncScrapedShowRowsAndPickers();

    const shows = await db
      .select({
        name: showsTable.name,
        djName: showsTable.djName,
        djNames: showsTable.djNames,
        pickerId: showsTable.pickerId,
      })
      .from(showsTable)
      .where(eq(showsTable.stationId, stationId));

    expect(shows.find((show) => show.name === "Co-Hosted")).toMatchObject({
      djName: "Alice, Bob",
      djNames: null,
      pickerId: compositePickerId,
    });
    expect(shows.find((show) => show.name === "Solo")).toMatchObject({
      djName: "Diane Kamikaze",
      djNames: null,
    });
    expect(shows.find((show) => show.name === "Solo")?.pickerId).not.toBeNull();
    expect(shows.find((show) => show.name === "Recovered Co-Hosted")).toMatchObject({
      djName: null,
      djNames: ["Alice", "Bob"],
      pickerId: null,
    });
    expect(shows.find((show) => show.name === "Generic Block")).toMatchObject({
      djName: null,
      djNames: null,
      pickerId: null,
    });
    expect(shows.find((show) => show.name === "Comma Name")).toMatchObject({
      djName: "Smith, Jr.",
      djNames: null,
    });

    const pickerHandles = [
      `show-dj-${stationSlug}-alice`,
      `show-dj-${stationSlug}-bob`,
      `show-dj-${stationSlug}-diane-kamikaze`,
      `show-dj-${stationSlug}-smith-jr`,
      `show-dj-${stationSlug}-smith`,
      `show-dj-${stationSlug}-jr`,
    ];
    const pickers = await db
      .select({
        handle: pickersTable.handle,
        active: pickersTable.active,
      })
      .from(pickersTable)
      .where(inArray(pickersTable.handle, [
        compositeHandle,
        ...pickerHandles,
      ]));
    expect(
      pickers
        .filter((picker) => pickerHandles.includes(picker.handle))
        .map((picker) => picker.handle)
        .sort(),
    ).toEqual(pickerHandles.sort());
    expect(pickers.find((picker) => picker.handle === compositeHandle)?.active).toBe(true);
    expect(
      pickers.find((picker) => picker.handle === `show-dj-${stationSlug}-smith`)?.active,
    ).toBe(false);
    expect(
      pickers.find((picker) => picker.handle === `show-dj-${stationSlug}-jr`)?.active,
    ).toBe(false);
    expect(
      pickers.find((picker) => picker.handle === `show-dj-${stationSlug}-alice`)?.active,
    ).toBe(true);
    expect(
      pickers.find((picker) => picker.handle === `show-dj-${stationSlug}-bob`)?.active,
    ).toBe(true);
    expect(
      pickers.find(
        (picker) =>
          picker.handle === `show-dj-${stationSlug}-diane-kamikaze`,
      )?.active,
    ).toBe(true);
  });
});