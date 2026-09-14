import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  claimCreditEnrichmentRows,
  seedCreditEnrichmentQueue,
  withMusicBrainzRateLease,
} from "../src/lore/credits.js";
import { applyCreditsMigration } from "../src/lore/credits-migration.js";
import {
  creditEnrichmentQueueTable,
  db,
  libraryItemsTable,
  loreUsersTable,
  recordingsTable,
} from "@workspace/db";

const run = randomUUID().slice(0, 8);
const sid = `credits-queue-${run}`;
const mbids = Array.from({ length: 5 }, (_, index) => `credits-queue-${run}-${index}`);
const backlogMbids = Array.from(
  { length: 100 },
  (_, index) => `credits-queue-${run}-backlog-${index}`,
);
const allMbids = [...mbids, ...backlogMbids];
let userId: number | undefined;
let dbAvailable = false;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return;
  }
  dbAvailable = true;
  await applyCreditsMigration();
  const [user] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: sid })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;
  await db.insert(recordingsTable).values(allMbids.map((mbid) => ({
    mbid,
    title: mbid,
    artist: "Queue Fixture",
  })));
  await db.insert(libraryItemsTable).values(
    mbids.map((mbid, index) => ({
      userId: userId!,
      mbid,
      provenance: { kind: "import" },
      addedAt: new Date(Date.UTC(2025, 0, index + 1)),
    })),
  );
  await db.insert(libraryItemsTable).values(
    backlogMbids.map((mbid, index) => ({
      userId: userId!,
      mbid,
      provenance: { kind: "import" },
      addedAt: new Date(Date.UTC(2024, 0, index + 1)),
    })),
  );
  await db.insert(creditEnrichmentQueueTable).values({
    recordingMbid: mbids[0]!,
    priority: 0,
    status: "pending",
    nextAttemptAt: new Date(0),
  });
});

afterAll(async () => {
  if (!dbAvailable || userId == null) return;
  await db.delete(creditEnrichmentQueueTable).where(inArray(creditEnrichmentQueueTable.recordingMbid, allMbids));
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, allMbids));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
});

describe("credit queue convergence and claims", () => {
  it("SQL-bounds newest-first selections and converges across a large backlog", async () => {
    if (!dbAvailable) return;
    await seedCreditEnrichmentQueue(2);
    let rows = await db
      .select({
        recordingMbid: creditEnrichmentQueueTable.recordingMbid,
        priority: creditEnrichmentQueueTable.priority,
      })
      .from(creditEnrichmentQueueTable)
      .where(inArray(creditEnrichmentQueueTable.recordingMbid, mbids));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.recordingMbid)).toContain(mbids[4]);
    await seedCreditEnrichmentQueue(2);
    rows = await db
      .select({
        recordingMbid: creditEnrichmentQueueTable.recordingMbid,
        priority: creditEnrichmentQueueTable.priority,
      })
      .from(creditEnrichmentQueueTable)
      .where(inArray(creditEnrichmentQueueTable.recordingMbid, mbids));
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.recordingMbid)).toContain(mbids[3]);
    await seedCreditEnrichmentQueue(2);
    const backlogRows = await db
      .select({ recordingMbid: creditEnrichmentQueueTable.recordingMbid })
      .from(creditEnrichmentQueueTable)
      .where(inArray(creditEnrichmentQueueTable.recordingMbid, backlogMbids));
    expect(backlogRows).toHaveLength(2);
    rows = await db
      .select({
        recordingMbid: creditEnrichmentQueueTable.recordingMbid,
        priority: creditEnrichmentQueueTable.priority,
      })
      .from(creditEnrichmentQueueTable)
      .where(inArray(creditEnrichmentQueueTable.recordingMbid, mbids))
      .orderBy(sql`${creditEnrichmentQueueTable.priority} asc`);
    expect(new Set(rows.map((row) => row.recordingMbid))).toEqual(new Set(mbids));
    expect(rows[0]?.priority).toBe(0);
    expect(rows.slice(1).every((row) => row.priority > 0)).toBe(true);
  });

  it("claims rows atomically across overlapping callers", async () => {
    if (!dbAvailable) return;
    await db
      .update(creditEnrichmentQueueTable)
      .set({ status: "pending", nextAttemptAt: new Date(0), attempts: 0 })
      .where(inArray(creditEnrichmentQueueTable.recordingMbid, mbids.slice(1)));
    const [first, second] = await Promise.all([
      claimCreditEnrichmentRows(1),
      claimCreditEnrichmentRows(1),
    ]);
    const claimed = [...first, ...second];
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed.map((row) => row.recordingMbid)).size).toBe(2);
    const rows = await db
      .select({
        recordingMbid: creditEnrichmentQueueTable.recordingMbid,
        status: creditEnrichmentQueueTable.status,
        attempts: creditEnrichmentQueueTable.attempts,
      })
      .from(creditEnrichmentQueueTable)
      .where(inArray(creditEnrichmentQueueTable.recordingMbid, claimed.map((row) => row.recordingMbid)));
    expect(rows.every((row) => row.status === "running" && row.attempts >= 1)).toBe(true);
  });

  it("serializes concurrent provider starts with the database-backed lease", async () => {
    if (!dbAvailable) return;
    const starts: number[] = [];
    const work = () => withMusicBrainzRateLease(async () => {
      starts.push(Date.now());
    });
    await Promise.all([work(), work()]);
    expect(starts).toHaveLength(2);
    expect(Math.abs(starts[1]! - starts[0]!)).toBeGreaterThanOrEqual(900);
  });
});