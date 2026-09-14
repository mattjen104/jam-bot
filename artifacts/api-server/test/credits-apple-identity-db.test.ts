import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  appleLibraryItemsTable,
  creditEnrichmentQueueTable,
  db,
  loreUsersTable,
} from "@workspace/db";
import { applyAppleLibraryItemsMigration } from "../src/lore/apple-library-items-migration.js";
import { seedCreditEnrichmentQueue } from "../src/lore/credits.js";

const run = randomUUID().slice(0, 8);
const sid = `credits-apple-${run}`;
const appleId = `apple-catalog-${run}`;
let dbAvailable = false;
let userId: number | undefined;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return;
  }
  dbAvailable = true;
  await applyAppleLibraryItemsMigration();
  const [user] = await db
    .insert(loreUsersTable)
    .values({ deviceKey: sid })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;
  await db.insert(appleLibraryItemsTable).values({
    userId: userId!,
    appleId,
    title: "Apple Exact Track",
    artist: `Apple Artist ${run}`,
    albumName: "Apple Exact Album",
    providerReleaseId: `apple-release-${run}`,
    providerReleaseDate: "2025-02-03",
    providerReleasePrecision: "day",
    isrc: `US-APL-${run}`,
  });
});

afterAll(async () => {
  if (!dbAvailable || userId == null) return;
  await db.delete(creditEnrichmentQueueTable).where(
    eq(creditEnrichmentQueueTable.recordingMbid, appleId),
  );
  await db.delete(appleLibraryItemsTable).where(eq(appleLibraryItemsTable.userId, userId));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
});

describe("Apple provider identity boundary", () => {
  it("preserves exact provider evidence and never seeds Apple IDs as MBIDs", async () => {
    if (!dbAvailable) return;
    await seedCreditEnrichmentQueue(100);
    const [appleRow] = await db
      .select({
        appleId: appleLibraryItemsTable.appleId,
        providerReleaseId: appleLibraryItemsTable.providerReleaseId,
        providerReleaseDate: appleLibraryItemsTable.providerReleaseDate,
        isrc: appleLibraryItemsTable.isrc,
      })
      .from(appleLibraryItemsTable)
      .where(eq(appleLibraryItemsTable.appleId, appleId));
    expect(appleRow).toEqual({
      appleId,
      providerReleaseId: `apple-release-${run}`,
      providerReleaseDate: "2025-02-03",
      isrc: `US-APL-${run}`,
    });
    const queueRows = await db
      .select({ recordingMbid: creditEnrichmentQueueTable.recordingMbid })
      .from(creditEnrichmentQueueTable)
      .where(eq(creditEnrichmentQueueTable.recordingMbid, appleId));
    expect(queueRows).toEqual([]);
  });
});