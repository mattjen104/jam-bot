import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  db,
  attendanceTable,
  embedResolutionMetricsTable,
  embedResolutionQueueTable,
  libraryItemsTable,
  listSourcesTable,
  listensTable,
  listenSessionsTable,
  loreUsersTable,
  radioBrowserStationsTable,
  recordingsTable,
  showsTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import {
  auditStationFixtures,
  cleanupStationFixtures,
} from "../src/lore/station-fixture-audit.js";
import { createStationFixtureTracker } from "./station-fixtures.js";

describe("station fixture lifecycle", () => {
  it("audits by independent signals and leaves visible inventory unchanged across repeated cleanup", async () => {
    try {
      await db.execute(sql`select 1`);
    } catch {
      return;
    }

    const run = randomUUID().slice(0, 8);
    const mbid = `fixture-lifecycle-${run}`;
    const fixtures = createStationFixtureTracker();
    const baseline = await db
      .select({ value: count() })
      .from(stationsTable)
      .where(sql`${stationsTable.active} = true AND ${stationsTable.hidden} = false`);

    const fixture = await fixtures.insert({
      slug: `test-fixture-lifecycle-${run}`,
      name: `Lifecycle fixture ${run}`,
      streamUrl: `https://example.invalid/${run}`,
      active: true,
      hidden: false,
      source: "radio_browser",
    });
    const [decoy] = await db.insert(stationsTable).values({
      slug: `legitimate-decoy-${run}`,
      name: `Test of the Emergency Broadcast System ${run}`,
      streamUrl: `https://radio.example.org/${run}`,
      active: true,
      hidden: false,
      source: "curated",
    }).returning();
    const [user] = await db.insert(loreUsersTable).values({
      deviceKey: `fixture-lifecycle-${run}`,
    }).returning();
    await db.insert(recordingsTable).values({
      mbid,
      title: "Fixture Lifecycle Track",
      artist: "Fixture Lifecycle Artist",
    });
    const [listSource] = await db.insert(listSourcesTable).values({
      kind: "station",
      name: `Fixture list source ${run}`,
      stationId: fixture.id,
    }).returning();

    try {
      const [show] = await db
        .insert(showsTable)
        .values({ stationId: fixture.id, name: `Fixture show ${run}` })
        .returning();
      const [spin] = await db.insert(spinsTable).values({
        stationId: fixture.id,
        showId: show!.id,
        mbid,
        rawArtist: "Fixture Artist",
        rawTitle: "Fixture Title",
      }).returning();
      const [session] = await db.insert(listenSessionsTable).values({
        userId: user!.id,
        stationId: fixture.id,
      }).returning();
      await db.insert(attendanceTable).values({
        userId: user!.id,
        spinId: spin!.id,
        sessionId: session!.id,
        dwellSeconds: 60,
      });
      const [listen] = await db.insert(listensTable).values({
        userId: user!.id,
        mbid,
        spinId: spin!.id,
        stationId: fixture.id,
        showId: show!.id,
        context: "broadcast",
        outputService: "broadcast",
        startedAt: new Date(),
      }).returning();
      const [libraryItem] = await db.insert(libraryItemsTable).values({
        userId: user!.id,
        mbid,
        provenance: { kind: "keep" },
        spinId: spin!.id,
      }).returning();
      await db.insert(embedResolutionQueueTable).values({
        recordingMbid: mbid,
        provider: "bandcamp",
        role: "provenance",
        stationId: fixture.id,
      });
      await db.insert(embedResolutionMetricsTable).values({
        stationId: fixture.id,
        weekStart: new Date("2026-08-30T00:00:00Z"),
        provider: "bandcamp",
        role: "provenance",
        rung: 1,
        outcome: "fixture",
      });
      await db.insert(radioBrowserStationsTable).values({
        radioBrowserUuid: `fixture-${run}`,
        streamUrl: fixture.streamUrl,
        name: fixture.name,
        stationId: fixture.id,
      });

      const audit = await auditStationFixtures();
      expect(audit.find((row) => row.id === fixture.id)?.signals).toEqual(
        expect.arrayContaining(["fixture_slug", "placeholder_stream"]),
      );
      expect(audit.some((row) => row.id === decoy!.id)).toBe(false);

      expect(await cleanupStationFixtures([decoy!.id])).toBe(0);
      expect(await cleanupStationFixtures()).toBeGreaterThanOrEqual(1);
      expect(await cleanupStationFixtures()).toBe(0);
      const [preservedListSource] = await db
        .select({ stationId: listSourcesTable.stationId })
        .from(listSourcesTable)
        .where(eq(listSourcesTable.id, listSource!.id));
      expect(preservedListSource?.stationId).toBeNull();
      const [preservedListen] = await db
        .select({
          spinId: listensTable.spinId,
          stationId: listensTable.stationId,
          showId: listensTable.showId,
        })
        .from(listensTable)
        .where(eq(listensTable.id, listen!.id));
      expect(preservedListen).toMatchObject({
        spinId: null,
        stationId: null,
        showId: null,
      });
      const [preservedLibraryItem] = await db
        .select({ spinId: libraryItemsTable.spinId })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.id, libraryItem!.id));
      expect(preservedLibraryItem?.spinId).toBeNull();

      const [visibleAfterFixtureCleanup] = await db
        .select({ value: count() })
        .from(stationsTable)
        .where(sql`${stationsTable.active} = true AND ${stationsTable.hidden} = false`);
      expect(Number(visibleAfterFixtureCleanup?.value ?? 0)).toBe(
        Number(baseline[0]?.value ?? 0) + 1,
      );
    } finally {
      await fixtures.cleanup();
      await db.delete(listSourcesTable).where(eq(listSourcesTable.id, listSource!.id));
      await db.delete(stationsTable).where(eq(stationsTable.id, decoy!.id));
      await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, user!.id));
      await db.delete(listensTable).where(eq(listensTable.userId, user!.id));
      await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
      await db.delete(loreUsersTable).where(eq(loreUsersTable.id, user!.id));
    }

    const [visibleAfter] = await db
      .select({ value: count() })
      .from(stationsTable)
      .where(sql`${stationsTable.active} = true AND ${stationsTable.hidden} = false`);
    expect(Number(visibleAfter?.value ?? 0)).toBe(Number(baseline[0]?.value ?? 0));
    const leaked = await db
      .select({ id: stationsTable.id })
      .from(stationsTable)
      .where(eq(stationsTable.id, fixture.id));
    expect(leaked).toHaveLength(0);
  });
});