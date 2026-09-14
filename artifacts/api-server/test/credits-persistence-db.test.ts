import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  musicbrainzReleasesTable,
  musicbrainzWorksTable,
  recordingCreditsTable,
  recordingWorksTable,
  recordingsTable,
  releaseLabelsTable,
} from "@workspace/db";
import { applyCreditsMigration } from "../src/lore/credits-migration.js";
import { persistRecordingCredits } from "../src/lore/credits.js";
import type { RecordingCredits } from "@workspace/song-enrichment";

const run = randomUUID().slice(0, 8);
const recordingMbid = `credits-persist-recording-${run}`;
const workMbid = `credits-persist-work-${run}`;
const releaseMbid = `credits-persist-release-${run}`;
const labelMbid = `credits-persist-label-${run}`;
let dbAvailable = false;

const payload = (
  fetchedAt: string,
  catalogNumber?: string,
  sourceUrl = `https://musicbrainz.org/recording/${recordingMbid}`,
  status: RecordingCredits["status"] = "complete",
): RecordingCredits => ({
  recordingId: recordingMbid,
  personnel: [{
    role: "producer",
    name: "Persistent Producer",
    artistId: `credits-persist-artist-${run}`,
  }],
  workIds: [workMbid],
  works: [{ id: workMbid, title: "Persistent Work" }],
  status,
  sourceUrl,
  provenance: {
    source: "musicbrainz",
    fetchedAt,
    parserVersion: "credits-v2",
  },
  releases: [{
    releaseId: releaseMbid,
    releaseGroupId: `credits-persist-group-${run}`,
    title: "Persistent Edition",
    date: "2024-01-01",
    labels: [{ labelId: labelMbid, name: "Persistent Label", catalogNumber }],
  }],
});

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return;
  }
  dbAvailable = true;
  await applyCreditsMigration();
  await db.insert(recordingsTable).values({
    mbid: recordingMbid,
    title: "Persistent Recording",
    artist: "Persistent Artist",
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(recordingCreditsTable).where(eq(recordingCreditsTable.recordingMbid, recordingMbid));
  await db.delete(recordingWorksTable).where(eq(recordingWorksTable.recordingMbid, recordingMbid));
  await db.delete(releaseLabelsTable).where(eq(releaseLabelsTable.releaseMbid, releaseMbid));
  await db.delete(musicbrainzReleasesTable).where(eq(musicbrainzReleasesTable.mbid, releaseMbid));
  await db.delete(musicbrainzWorksTable).where(eq(musicbrainzWorksTable.mbid, workMbid));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, recordingMbid));
});

describe("credits persistence provenance", () => {
  it("writes credits-v2 and refreshes provenance while preserving edition catalog details", async () => {
    if (!dbAvailable) return;
    await persistRecordingCredits(payload("2025-01-01T00:00:00.000Z", "CAT-EDITION"));
    await persistRecordingCredits(payload("2025-02-01T00:00:00.000Z"));

    const [work] = await db
      .select({
        parserVersion: musicbrainzWorksTable.parserVersion,
        provenance: musicbrainzWorksTable.provenance,
        fetchedAt: musicbrainzWorksTable.fetchedAt,
      })
      .from(musicbrainzWorksTable)
      .where(eq(musicbrainzWorksTable.mbid, workMbid));
    const [release] = await db
      .select({
        parserVersion: musicbrainzReleasesTable.parserVersion,
        provenance: musicbrainzReleasesTable.provenance,
        fetchedAt: musicbrainzReleasesTable.fetchedAt,
      })
      .from(musicbrainzReleasesTable)
      .where(eq(musicbrainzReleasesTable.mbid, releaseMbid));
    const [credit] = await db
      .select({
        parserVersion: recordingCreditsTable.parserVersion,
        provenance: recordingCreditsTable.provenance,
      })
      .from(recordingCreditsTable)
      .where(eq(recordingCreditsTable.recordingMbid, recordingMbid));
    const [edition] = await db
      .select({
        catalogNumber: releaseLabelsTable.catalogNumber,
        parserVersion: releaseLabelsTable.parserVersion,
        provenance: releaseLabelsTable.provenance,
      })
      .from(releaseLabelsTable)
      .where(eq(releaseLabelsTable.releaseMbid, releaseMbid));

    expect(work?.parserVersion).toBe("credits-v2");
    expect(work?.provenance).toMatchObject({ parserVersion: "credits-v2" });
    expect(work?.fetchedAt).toBeTruthy();
    expect(release?.parserVersion).toBe("credits-v2");
    expect(release?.provenance).toMatchObject({ parserVersion: "credits-v2" });
    expect(release?.fetchedAt).toBeTruthy();
    expect(credit?.parserVersion).toBe("credits-v2");
    expect(credit?.provenance).toMatchObject({ parserVersion: "credits-v2" });
    expect(edition).toMatchObject({
      catalogNumber: "CAT-EDITION",
      parserVersion: "credits-v2",
      provenance: { parserVersion: "credits-v2" },
    });
  });

  it("refreshes source citation and provenance across repeated partial payloads", async () => {
    if (!dbAvailable) return;
    await persistRecordingCredits(payload(
      "2025-03-01T00:00:00.000Z",
      "CAT-PARTIAL",
      "https://old.example/credit",
      "partial",
    ));
    await persistRecordingCredits(payload(
      "2025-04-01T00:00:00.000Z",
      "CAT-PARTIAL",
      "https://new.example/credit",
      "partial",
    ));
    const [credit] = await db
      .select({
        sourceUrl: recordingCreditsTable.sourceUrl,
        parserVersion: recordingCreditsTable.parserVersion,
        provenance: recordingCreditsTable.provenance,
      })
      .from(recordingCreditsTable)
      .where(eq(recordingCreditsTable.recordingMbid, recordingMbid));
    expect(credit).toMatchObject({
      sourceUrl: "https://new.example/credit",
      parserVersion: "credits-v2",
      provenance: {
        fetchedAt: "2025-04-01T00:00:00.000Z",
        parserVersion: "credits-v2",
      },
    });
  });
});