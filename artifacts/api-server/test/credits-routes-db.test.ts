import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  creditEnrichmentQueueTable,
  db,
  libraryItemsTable,
  loreCollectionsTable,
  loreUsersTable,
  musicbrainzLabelsTable,
  musicbrainzReleasesTable,
  recordingCreditsTable,
  recordingReleaseGroupsTable,
  recordingsTable,
  releaseLabelsTable,
} from "@workspace/db";
import app from "../src/app.js";
import { applyCreditsMigration } from "../src/lore/credits-migration.js";

const run = randomUUID().slice(0, 8);
const sid = `credits-routes-${run}`;
const keptMbid = `credits-kept-${run}`;
const removedMbid = `credits-removed-${run}`;
const releaseGroup = `credits-group-${run}`;
const secondaryReleaseGroup = `credits-secondary-group-${run}`;
const releaseMbid = `credits-release-${run}`;
const secondaryReleaseMbid = `credits-secondary-release-${run}`;
const labelMbid = `credits-label-${run}`;
const secondaryLabelMbid = `credits-secondary-label-${run}`;
const fillerReleaseGroups = Array.from(
  { length: 9 },
  (_, index) => `credits-filler-group-${index}-${run}`,
);
const fillerReleaseMbids = Array.from(
  { length: 9 },
  (_, index) => `credits-filler-release-${index}-${run}`,
);
const artistMbid = `credits-artist-${run}`;
const collectionSlug = `credits-album-${run}`;

let dbAvailable = false;
let userId: number | undefined;
let server: Server | undefined;
let baseUrl = "";

type CreditsBody = {
  status?: string;
  error?: string | null;
  credits?: unknown[];
  tracks?: Array<{ mbid: string }>;
  songs?: Array<{ mbid: string }>;
  releases?: Array<{ releaseMbid: string }>;
  completeCatalogue?: boolean;
  items?: Array<{
    creditKey: string;
    creditedName: string;
    recording: { mbid: string };
    releaseGroups: Array<{ mbid: string; isPrimary: boolean }>;
    releases: Array<{ mbid: string; label: { mbid: string } | null }>;
  }>;
  nextCursor?: string | null;
  coverage?: { scope: string; exhaustive: boolean };
};

async function get(path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie: `lore_sid=${sid}` },
  });
  return { status: response.status, body: await response.json() as CreditsBody };
}

beforeAll(async () => {
  try {
    await db.execute<{ ok: number }>(sql`select 1 as ok`);
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
  await db.insert(recordingsTable).values([
    { mbid: keptMbid, title: "Kept Track", artist: `Credits Artist ${run}`, artistMbid },
    { mbid: removedMbid, title: "Removed Track", artist: `Other Credits Artist ${run}`, artistMbid: `other-${artistMbid}` },
  ]);
  await db.insert(libraryItemsTable).values([
    {
      userId: userId!,
      mbid: keptMbid,
      provenance: { kind: "keep" },
    },
    {
      userId: userId!,
      mbid: removedMbid,
      provenance: { kind: "keep" },
      removedAt: new Date(),
    },
  ]);
  await db.insert(recordingReleaseGroupsTable).values([
    {
      recordingMbid: keptMbid,
      releaseGroupMbid: releaseGroup,
      isPrimary: true,
      title: "Mixed Keep Album",
      releaseYear: 2024,
    },
    {
      recordingMbid: removedMbid,
      releaseGroupMbid: releaseGroup,
      isPrimary: true,
      title: "Mixed Keep Album",
      releaseYear: 2024,
    },
    ...fillerReleaseGroups.map((fillerGroup, index) => ({
      recordingMbid: keptMbid,
      releaseGroupMbid: fillerGroup,
      isPrimary: false,
      title: `Filler Canonical Album ${index}`,
      releaseYear: 2000 + index,
    })),
    {
      recordingMbid: keptMbid,
      releaseGroupMbid: secondaryReleaseGroup,
      isPrimary: false,
      title: "Secondary Canonical Album",
      releaseYear: 2025,
    },
  ]);
  await db.insert(recordingCreditsTable).values([
    {
      creditKey: `${keptMbid}:producer:${artistMbid}`,
      recordingMbid: keptMbid,
      artistMbid,
      creditedName: "Verified Producer",
      role: "producer",
      roleGroup: "production",
      completeness: "partial",
      attemptStatus: "partial",
    },
    {
      creditKey: `${removedMbid}:producer:${artistMbid}`,
      recordingMbid: removedMbid,
      artistMbid,
      creditedName: "Removed Producer",
      role: "producer",
      roleGroup: "production",
      completeness: "complete",
      attemptStatus: "success",
    },
  ]);
  await db.insert(musicbrainzReleasesTable).values([
    {
      mbid: releaseMbid,
      releaseGroupMbid: releaseGroup,
      title: "Mixed Keep Album",
      releaseDate: "2024-01-01",
      completeness: "partial",
    },
    ...fillerReleaseMbids.map((fillerRelease, index) => ({
      mbid: fillerRelease,
      releaseGroupMbid: secondaryReleaseGroup,
      title: `Filler Edition ${index}`,
      releaseDate: `201${index}-01-01`,
      completeness: "complete",
    })),
    {
      mbid: secondaryReleaseMbid,
      releaseGroupMbid: secondaryReleaseGroup,
      title: "Secondary Canonical Album",
      releaseDate: "2025-01-01",
      completeness: "complete",
    },
  ]);
  await db.insert(musicbrainzLabelsTable).values([
    { mbid: labelMbid, name: "Verified Label" },
    { mbid: secondaryLabelMbid, name: "Secondary Verified Label" },
  ]);
  await db.insert(releaseLabelsTable).values([
    {
      releaseMbid,
      labelMbid,
      labelName: "Verified Label",
      catalogNumber: "CAT-CREDITS",
    },
    {
      releaseMbid: secondaryReleaseMbid,
      labelMbid: secondaryLabelMbid,
      labelName: "Secondary Verified Label",
      catalogNumber: "CAT-SECONDARY",
    },
  ]);
  await db.insert(creditEnrichmentQueueTable).values([
    {
      recordingMbid: keptMbid,
      status: "partial",
      completedAt: new Date(),
    },
    {
      recordingMbid: removedMbid,
      status: "deferred",
    },
  ]);
  await db.insert(loreCollectionsTable).values({
    ownerId: userId!,
    kind: "album",
    slug: collectionSlug,
    title: "Public Credits Album",
    entries: [
      { identity: "mbid", mbid: keptMbid, title: "Kept Track", artist: `Credits Artist ${run}` },
      { identity: "mbid", mbid: removedMbid, title: "Removed Track", artist: `Credits Artist ${run}` },
      { identity: "isrc", isrc: "USAAA1234567", title: "ISRC only", artist: "Unresolved Artist" },
    ],
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (!dbAvailable || userId == null) return;
  await db.delete(loreCollectionsTable).where(eq(loreCollectionsTable.slug, collectionSlug));
  await db.delete(creditEnrichmentQueueTable).where(
    inArray(creditEnrichmentQueueTable.recordingMbid, [keptMbid, removedMbid]),
  );
  await db.delete(recordingCreditsTable).where(
    inArray(recordingCreditsTable.recordingMbid, [keptMbid, removedMbid]),
  );
  await db.delete(releaseLabelsTable).where(
    inArray(releaseLabelsTable.releaseMbid, [releaseMbid, secondaryReleaseMbid]),
  );
  await db.delete(musicbrainzReleasesTable).where(
    inArray(musicbrainzReleasesTable.mbid, [
      releaseMbid,
      secondaryReleaseMbid,
      ...fillerReleaseMbids,
    ]),
  );
  await db.delete(musicbrainzLabelsTable).where(
    inArray(musicbrainzLabelsTable.mbid, [labelMbid, secondaryLabelMbid]),
  );
  await db.delete(recordingReleaseGroupsTable).where(
    inArray(recordingReleaseGroupsTable.recordingMbid, [keptMbid, removedMbid]),
  );
  await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [keptMbid, removedMbid]));
  await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
});

describe("kept-credit route boundaries", () => {
  it("allows active keeps, denies removed keeps, and reports partial status", async () => {
    if (!dbAvailable) return;
    const active = await get(`/api/me/credits/recordings/${keptMbid}`);
    expect(active.status).toBe(200);
    expect(active.body.status).toBe("partial");
    expect(active.body.credits).toHaveLength(1);

    const removed = await get(`/api/me/credits/recordings/${removedMbid}`);
    expect(removed.status).toBe(404);
  });

  it("returns only active kept tracks for a mixed album", async () => {
    if (!dbAvailable) return;
    const result = await get(`/api/me/credits/albums/${releaseGroup}`);
    expect(result.status).toBe(200);
    expect(result.body.tracks.map((track: { mbid: string }) => track.mbid)).toEqual([keptMbid]);
  });

  it("discovers verified identities and labels only through active keeps", async () => {
    if (!dbAvailable) return;
    const artist = await get(`/api/me/credits/artists/${artistMbid}`);
    expect(artist.status).toBe(200);
    expect(artist.body.songs.map((song: { mbid: string }) => song.mbid)).toEqual([keptMbid]);

    const label = await get(`/api/me/credits/labels/${labelMbid}`);
    expect(label.status).toBe(200);
    expect(label.body.completeCatalogue).toBe(false);
    expect(label.body.releases.map((release: { releaseMbid: string }) => release.releaseMbid))
      .toEqual([releaseMbid]);
  });

  it("publishes bounded, cursor-stable credit discovery across the indexed corpus", async () => {
    if (!dbAvailable) return;
    const first = await get(`/api/credits/discovery?artistMbid=${artistMbid}&limit=1`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(first.body.coverage).toMatchObject({
      scope: "lore-indexed-corpus",
      exhaustive: false,
    });

    const second = await get(
      `/api/credits/discovery?artistMbid=${artistMbid}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor!)}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items?.[0]?.creditKey).not.toBe(first.body.items?.[0]?.creditKey);
    expect(second.body.nextCursor).toBeNull();

    const role = await get(`/api/credits/discovery?role=PRODUCER`);
    expect(role.status).toBe(200);
    expect(role.body.items?.map((item) => item.recording.mbid))
      .toEqual(expect.arrayContaining([keptMbid, removedMbid]));

    const label = await get(`/api/credits/discovery?labelMbid=${labelMbid}`);
    expect(label.status).toBe(200);
    expect(label.body.items?.[0]?.releases[0]?.label?.mbid).toBe(labelMbid);

    const secondaryAlbum = await get(
      `/api/credits/discovery?releaseGroupMbid=${secondaryReleaseGroup}`,
    );
    expect(secondaryAlbum.status).toBe(200);
    expect(secondaryAlbum.body.items?.[0]?.releaseGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mbid: secondaryReleaseGroup, isPrimary: false }),
      ]),
    );

    const secondaryLabel = await get(
      `/api/credits/discovery?labelMbid=${secondaryLabelMbid}`,
    );
    expect(secondaryLabel.status).toBe(200);
    expect(secondaryLabel.body.items?.[0]?.recording.mbid).toBe(keptMbid);
    expect(secondaryLabel.body.items?.[0]?.releases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mbid: secondaryReleaseMbid,
          label: expect.objectContaining({ mbid: secondaryLabelMbid }),
        }),
      ]),
    );

    const otherArtists = await get(
      `/api/credits/discovery?artistMbid=${artistMbid}&otherArtists=true`,
    );
    expect(otherArtists.status).toBe(200);
    expect(otherArtists.body.items?.map((item) => item.recording.mbid)).toEqual([removedMbid]);

    const missingFilter = await get("/api/credits/discovery");
    expect(missingFilter.status).toBe(400);
  });

  it("does not turn a deferred enrichment attempt into a confirmed absence", async () => {
    if (!dbAvailable) return;
    await db
      .update(creditEnrichmentQueueTable)
      .set({ status: "deferred", lastError: "MusicBrainz 503" })
      .where(eq(creditEnrichmentQueueTable.recordingMbid, keptMbid));
    const result = await get(`/api/me/credits/recordings/${keptMbid}`);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("deferred");
    expect(result.body.error).toBe("MusicBrainz 503");
  });

  it("projects canonical album credits publicly without exposing Keep membership", async () => {
    if (!dbAvailable) return;
    const response = await fetch(`${baseUrl}/api/collections/${collectionSlug}/credits`);
    const body = await response.json() as CreditsBody & {
      provenance?: { scope?: string };
      tracks?: Array<{ mbid: string; status: string; credits: Array<{ creditedName: string }> }>;
    };
    expect(response.status).toBe(200);
    expect(body.provenance?.scope).toBe("public-collection");
    expect(body.tracks?.map((track) => track.mbid)).toEqual([keptMbid, removedMbid]);
    expect(body.tracks?.flatMap((track) => track.credits.map((credit) => credit.creditedName)))
      .toEqual(["Verified Producer", "Removed Producer"]);
    expect(body.tracks?.map((track) => track.status)).toEqual(["partial", "complete"]);
    expect(JSON.stringify(body)).not.toContain("userId");
    expect(JSON.stringify(body)).not.toContain("removedAt");
    expect(JSON.stringify(body)).not.toContain("USAAA1234567");
  });

  it("serves only the tombstone after a collection is withdrawn", async () => {
    if (!dbAvailable) return;
    await db.update(loreCollectionsTable)
      .set({ unpublishedAt: new Date() })
      .where(eq(loreCollectionsTable.slug, collectionSlug));
    const response = await fetch(`${baseUrl}/api/collections/${collectionSlug}/credits`);
    expect(response.status).toBe(410);
    await db.update(loreCollectionsTable)
      .set({ unpublishedAt: null })
      .where(eq(loreCollectionsTable.slug, collectionSlug));
  });
});