// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  attendanceTable,
  db,
  libraryItemsTable,
  listenSessionsTable,
  loreUsersTable,
  recordingsTable,
  spinsTable,
  stationsTable,
} from "@workspace/db";
import {
  getCompletedWeekWindow,
  getWeeklyRecap,
} from "../src/lore/weekly-recap.js";

const run = randomUUID().slice(0, 8);
const DEVICE_KEY = `weekly-recap-${run}`;
const EMPTY_DEVICE_KEY = `weekly-recap-empty-${run}`;
const STATION_A = `weekly-recap-a-${run}`;
const STATION_GHOST = `weekly-recap-ghost-${run}`;
const MBID_OLD = `weekly-old-${run}`;
const MBID_FIRST = `weekly-first-${run}`;
const MBID_RIPENED = `weekly-ripened-${run}`;
const MBID_PRIOR_ARTIST = `weekly-prior-artist-${run}`;
const MBID_GHOST = `weekly-ghost-${run}`;
const ARTIST = `weekly-artist-${run}`;

let dbAvailable = false;
let userId = 0;
let emptyUserId = 0;
let stationAId = 0;
let ghostStationId = 0;

const week = getCompletedWeekWindow(
  new Date("2026-08-10T12:00:00.000Z"),
  "2026-08-02",
)!;

async function seedAttendance(user: number, spinId: number, stationId: number, playedAt: Date) {
  const [session] = await db
    .insert(listenSessionsTable)
    .values({
      userId: user,
      stationId,
      startedAt: playedAt,
      lastHeartbeatAt: playedAt,
    })
    .returning({ id: listenSessionsTable.id });
  await db.insert(attendanceTable).values({
    userId: user,
    spinId,
    sessionId: session!.id,
    dwellSeconds: 60,
    spinDurationSeconds: 240,
    rollupCounted: true,
    creditedThrough: playedAt,
  });
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [user, emptyUser] = await Promise.all([
    db.insert(loreUsersTable).values({ deviceKey: DEVICE_KEY }).returning({ id: loreUsersTable.id }),
    db.insert(loreUsersTable).values({ deviceKey: EMPTY_DEVICE_KEY }).returning({ id: loreUsersTable.id }),
  ]);
  userId = user[0]!.id;
  emptyUserId = emptyUser[0]!.id;

  const [stationA, ghostStation] = await db.insert(stationsTable).values([
    {
      slug: STATION_A,
      name: "Weekly Station A",
      streamUrl: "https://example.invalid/a",
    },
    {
      slug: STATION_GHOST,
      name: "Weekly Ghost Station",
      streamUrl: "https://example.invalid/ghost",
    },
  ]).returning({ id: stationsTable.id });
  stationAId = stationA!.id;
  ghostStationId = ghostStation!.id;

  await db.insert(recordingsTable).values([
    { mbid: MBID_OLD, title: "Heard Before", artist: "Old Artist" },
    { mbid: MBID_FIRST, title: "First This Week", artist: "New Artist" },
    { mbid: MBID_RIPENED, title: "Ripened Song", artist: "Ripened Artist", artistMbid: ARTIST },
    { mbid: MBID_PRIOR_ARTIST, title: "Prior Crossing Song", artist: "Ripened Artist", artistMbid: ARTIST },
    { mbid: MBID_GHOST, title: "Missed Song", artist: "Ripened Artist", artistMbid: ARTIST },
  ]);

  const [oldSpin] = await db.insert(spinsTable).values({
    stationId: stationAId,
    mbid: MBID_OLD,
    confidence: "recording_id",
    playedAt: new Date("2026-07-30T10:00:00.000Z"),
  }).returning({ id: spinsTable.id });
  const [oldWeekSpin] = await db.insert(spinsTable).values({
    stationId: stationAId,
    mbid: MBID_OLD,
    confidence: "recording_id",
    playedAt: new Date("2026-08-03T10:00:00.000Z"),
  }).returning({ id: spinsTable.id });
  const [firstSpin] = await db.insert(spinsTable).values({
    stationId: stationAId,
    mbid: MBID_FIRST,
    confidence: "recording_id",
    playedAt: new Date("2026-08-04T10:00:00.000Z"),
  }).returning({ id: spinsTable.id });
  const [priorRipenedSpin] = await db.insert(spinsTable).values({
    stationId: stationAId,
    mbid: MBID_PRIOR_ARTIST,
    confidence: "recording_id",
    playedAt: new Date("2026-07-31T10:00:00.000Z"),
  }).returning({ id: spinsTable.id });
  const [ripenedSpin] = await db.insert(spinsTable).values({
    stationId: stationAId,
    mbid: MBID_RIPENED,
    confidence: "recording_id",
    playedAt: new Date("2026-08-05T10:00:00.000Z"),
  }).returning({ id: spinsTable.id });
  const [earlierRipenedSpin] = await db.insert(spinsTable).values({
    stationId: stationAId,
    mbid: MBID_RIPENED,
    confidence: "recording_id",
    playedAt: new Date("2026-07-29T10:00:00.000Z"),
  }).returning({ id: spinsTable.id });
  await db.insert(spinsTable).values({
    stationId: ghostStationId,
    mbid: MBID_GHOST,
    confidence: "recording_id",
    playedAt: new Date("2026-08-06T10:00:00.000Z"),
  });

  await seedAttendance(userId, oldSpin!.id, stationAId, new Date("2026-07-30T10:00:00.000Z"));
  await seedAttendance(userId, oldWeekSpin!.id, stationAId, new Date("2026-08-03T10:00:00.000Z"));
  await seedAttendance(userId, firstSpin!.id, stationAId, new Date("2026-08-04T10:00:00.000Z"));
  await seedAttendance(userId, priorRipenedSpin!.id, stationAId, new Date("2026-07-31T10:00:00.000Z"));
  await seedAttendance(userId, ripenedSpin!.id, stationAId, new Date("2026-08-05T10:00:00.000Z"));
  await seedAttendance(userId, earlierRipenedSpin!.id, stationAId, new Date("2026-07-29T10:00:00.000Z"));

  await db.insert(libraryItemsTable).values([
    {
      userId,
      mbid: MBID_RIPENED,
      provenance: { kind: "keep" },
      addedAt: new Date("2026-08-05T12:00:00.000Z"),
    },
  ]);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(attendanceTable).where(inArray(
    attendanceTable.userId,
    [userId, emptyUserId],
  ));
  await db.delete(listenSessionsTable).where(inArray(
    listenSessionsTable.userId,
    [userId, emptyUserId],
  ));
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  await db.delete(spinsTable).where(inArray(spinsTable.stationId, [stationAId, ghostStationId]));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [
    MBID_OLD,
    MBID_FIRST,
    MBID_RIPENED,
    MBID_PRIOR_ARTIST,
    MBID_GHOST,
  ]));
  await db.delete(stationsTable).where(inArray(stationsTable.id, [stationAId, ghostStationId]));
  await db.delete(loreUsersTable).where(inArray(loreUsersTable.id, [userId, emptyUserId]));
});

describe("weekly recap read model", () => {
  it("counts confirmed stations, classifies first-heards/ripening, and chooses one missed replay", async () => {
    if (!dbAvailable) return;

    const recap = await getWeeklyRecap(userId, week);

    expect(recap.stationsAttended).toEqual({
      count: 1,
      stations: [{ slug: STATION_A, name: "Weekly Station A" }],
    });
    expect(recap.firstEverHeards.items.map((item) => item.mbid)).toEqual([MBID_FIRST]);
    expect(recap.ripenedCrossings.items.map((item) => item.mbid)).toEqual([MBID_RIPENED]);
    expect(recap.missedGhostReplay).toMatchObject({
      station: { slug: STATION_GHOST, name: "Weekly Ghost Station" },
    });
    expect(recap.missedGhostReplay?.replayId).toBeGreaterThan(0);
  });

  it("returns honest empty categories for a listener with no attendance or library", async () => {
    if (!dbAvailable) return;

    const recap = await getWeeklyRecap(emptyUserId, week);

    expect(recap.stationsAttended).toEqual({ count: 0, stations: [] });
    expect(recap.firstEverHeards).toEqual({ count: 0, items: [] });
    expect(recap.ripenedCrossings).toEqual({ count: 0, items: [] });
    expect(recap.missedGhostReplay).toBeNull();
  });
});