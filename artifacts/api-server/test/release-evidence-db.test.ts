// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  recordingReleaseEvidenceTable,
  recordingsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { applyReleaseYearMigration } from "../src/lore/release-year-migration.js";
import { recordProviderReleaseEvidence } from "../src/lore/release-evidence.js";
import {
  reconcileProviderReleaseEvidence,
  recordProviderReleaseFailure,
} from "../src/lore/release-evidence.js";

const run = Math.random().toString(36).slice(2, 10);
const providerTrackId = `provider-track-${run}`;
const firstMbid = `test-release-evidence-${run}-a`;
const conflictingMbid = `test-release-evidence-${run}-b`;
const concurrentTrackId = `provider-concurrent-${run}`;

beforeAll(async () => {
  await applyReleaseYearMigration();
  await db.insert(recordingsTable).values([
    { mbid: firstMbid, title: "Evidence Track", artist: "Evidence Artist" },
    { mbid: conflictingMbid, title: "Other Track", artist: "Other Artist" },
  ]);
});

afterAll(async () => {
  await db
    .delete(recordingReleaseEvidenceTable)
    .where(
      sql`${recordingReleaseEvidenceTable.providerTrackId} IN (${providerTrackId}, ${concurrentTrackId})`,
    );
  await db.execute(sql`DELETE FROM recordings WHERE mbid IN (${firstMbid}, ${conflictingMbid})`);
});

describe("provider release evidence", () => {
  it("deduplicates, links, and never advances MB sentinels", async () => {
    const fact = {
      provider: "spotify" as const,
      providerTrackId,
      providerReleaseId: `album-${run}`,
      isrc: `ISRC${run}`.toUpperCase(),
      releaseDate: "2024-03",
      precision: "month" as const,
      recordingMbid: firstMbid,
    };
    await recordProviderReleaseEvidence(fact);
    await recordProviderReleaseEvidence(fact);

    const rows = await db
      .select()
      .from(recordingReleaseEvidenceTable)
      .where(
        and(
          eq(recordingReleaseEvidenceTable.provider, "spotify"),
          eq(recordingReleaseEvidenceTable.providerTrackId, providerTrackId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recordingMbid).toBe(firstMbid);
    expect(rows[0]?.status).toBe("linked");

    const [recording] = await db
      .select()
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, firstMbid));
    expect(recording?.releaseYear).toBe(2024);
    expect(recording?.releaseDate).toBe("2024-03");
    expect(recording?.yearCheckedAt).toBeNull();
    expect(recording?.releaseDateCheckedAt).toBeNull();
  });

  it("does not relink an exact provider identity to a conflicting recording", async () => {
    await recordProviderReleaseEvidence({
      provider: "spotify",
      providerTrackId,
      isrc: `ISRC${run}`.toUpperCase(),
      releaseDate: "2024-03",
      precision: "month",
      recordingMbid: conflictingMbid,
    });

    const [row] = await db
      .select()
      .from(recordingReleaseEvidenceTable)
      .where(eq(recordingReleaseEvidenceTable.providerTrackId, providerTrackId));
    expect(row?.recordingMbid).toBe(firstMbid);
    expect(row?.isrc).toBe(`ISRC${run}`.toUpperCase());
    expect(row?.releaseDate).toBe("2024-03");

    const [conflicting] = await db
      .select()
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, conflictingMbid));
    expect(conflicting?.releaseYear).toBeNull();
    expect(conflicting?.releaseDate).toBeNull();
  });

  it("keeps one internally consistent evidence packet under concurrent conflicting links", async () => {
    await Promise.all([
      recordProviderReleaseEvidence({
        provider: "spotify",
        providerTrackId: concurrentTrackId,
        providerReleaseId: `release-a-${run}`,
        isrc: `CONA${run}`.toUpperCase(),
        releaseDate: "2001",
        precision: "year",
        recordingMbid: firstMbid,
      }),
      recordProviderReleaseEvidence({
        provider: "spotify",
        providerTrackId: concurrentTrackId,
        providerReleaseId: `release-b-${run}`,
        isrc: `CONB${run}`.toUpperCase(),
        releaseDate: "2002",
        precision: "year",
        recordingMbid: conflictingMbid,
      }),
    ]);
    const [row] = await db
      .select()
      .from(recordingReleaseEvidenceTable)
      .where(eq(recordingReleaseEvidenceTable.providerTrackId, concurrentTrackId));
    const expected =
      row?.recordingMbid === firstMbid
        ? { releaseId: `release-a-${run}`, isrc: `CONA${run}`.toUpperCase(), date: "2001" }
        : { releaseId: `release-b-${run}`, isrc: `CONB${run}`.toUpperCase(), date: "2002" };
    expect(row?.providerReleaseId).toBe(expected.releaseId);
    expect(row?.isrc).toBe(expected.isrc);
    expect(row?.releaseDate).toBe(expected.date);
  });

  it("preserves valid evidence after a later provider failure", async () => {
    await recordProviderReleaseFailure({
      provider: "spotify",
      providerTrackId,
      error: "HTTP 429",
    });
    const [row] = await db
      .select()
      .from(recordingReleaseEvidenceTable)
      .where(eq(recordingReleaseEvidenceTable.providerTrackId, providerTrackId));
    expect(row?.status).toBe("linked");
    expect(row?.releaseDate).toBe("2024-03");
    expect(row?.lastError).toBe("HTTP 429");
  });

  it("rejects ambiguous ISRC reconciliation and nulls links when a recording is deleted", async () => {
    await db
      .update(recordingsTable)
      .set({ isrc: `AMB${run}`.toUpperCase() })
      .where(sql`${recordingsTable.mbid} IN (${firstMbid}, ${conflictingMbid})`);
    expect(
      await reconcileProviderReleaseEvidence({
        recordingMbid: firstMbid,
        isrc: `AMB${run}`.toUpperCase(),
      }),
    ).toBe(0);

    await db.delete(recordingsTable).where(eq(recordingsTable.mbid, firstMbid));
    const [row] = await db
      .select()
      .from(recordingReleaseEvidenceTable)
      .where(eq(recordingReleaseEvidenceTable.providerTrackId, providerTrackId));
    expect(row?.recordingMbid).toBeNull();
  });
});