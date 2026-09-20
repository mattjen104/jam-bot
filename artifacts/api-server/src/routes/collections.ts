import { Router, type IRouter } from "express";
import {
  db,
  loreCollectionsTable,
  musicbrainzLabelsTable,
  musicbrainzReleasesTable,
  musicbrainzWorksTable,
  recordingCreditsTable,
  recordingReleaseGroupsTable,
  releaseLabelsTable,
  serviceTrackMapTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { h } from "../middlewares/asyncHandler.js";
import { requireUserMiddleware, type AuthedRequest } from "./me/auth.js";
import { GetPublicCollectionCreditsResponse } from "@workspace/api-zod";
import {
  COMPATIBILITY_SAMPLE_SLUG,
  compatibilitySampleCollection,
  enrichVerifiedSpotifyEntries,
  fromJspf,
  playerCapability,
  toJspf,
  validateCollectionInput,
  type CollectionEntry,
  type CollectionKind,
  type LoreCollectionV1,
} from "../lore/collection.js";

const router: IRouter = Router();

type PublicCreditStatus = "pending" | "complete" | "partial" | "deferred" | "unavailable";

function publicTrackStatus(
  facts: Array<{ completeness?: string | null; attemptStatus?: string | null }>,
): PublicCreditStatus {
  if (!facts.length) return "unavailable";
  const values = facts.flatMap((fact) => [fact.completeness, fact.attemptStatus].filter(Boolean));
  if (values.some((value) => value === "partial" || value === "deferred")) return "partial";
  if (values.some((value) => value === "unavailable")) return "partial";
  return values.length > 0 && values.every((value) => value === "complete" || value === "success")
    ? "complete"
    : "partial";
}

function publicAlbumStatus(statuses: PublicCreditStatus[], hasFacts: boolean): PublicCreditStatus {
  const unique = new Set(statuses);
  if (unique.has("partial")) return "partial";
  if (unique.has("unavailable") && (hasFacts || unique.size > 1)) return "partial";
  if (unique.has("deferred") && hasFacts) return "partial";
  if (unique.has("deferred")) return "deferred";
  if (unique.has("unavailable")) return "unavailable";
  if (unique.has("pending")) return "pending";
  return unique.size === 1 && unique.has("complete") ? "complete" : hasFacts ? "partial" : "pending";
}

function publicCreditProvenance(
  rows: Array<{ source?: string | null; parserVersion?: string | null; fetchedAt?: Date | null }>,
) {
  const sources = [...new Set(rows.map((row) => row.source).filter((source): source is string => Boolean(source)))].sort();
  const versions = [...new Set(rows.map((row) => row.parserVersion).filter(Boolean))];
  const fetchedAt = rows
    .flatMap((row) => row.fetchedAt ? [row.fetchedAt.toISOString()] : [])
    .sort()
    .at(-1) ?? null;
  return {
    source: sources.length ? sources.join(" + ") : "musicbrainz",
    scope: "public-collection",
    parserVersion: versions.length === 1 ? versions[0] : null,
    fetchedAt,
  };
}

function publicCollection(row: typeof loreCollectionsTable.$inferSelect): LoreCollectionV1 {
  return {
    schema: "lore.collection.v1",
    kind: row.kind as CollectionKind,
    slug: row.slug,
    title: row.title,
    description: row.description,
    curatorNotes: row.curatorNotes,
    coverArt: row.coverArt,
    entries: row.entries as CollectionEntry[],
    provenance: { authority: "lore", public: true },
  };
}

async function canonicalCollectionIdentity(entries: CollectionEntry[]) {
  const mbids = [...new Set(entries
    .filter((entry): entry is CollectionEntry & { mbid: string } => entry.identity === "mbid" && typeof entry.mbid === "string")
    .map((entry) => entry.mbid))];
  if (!mbids.length) return { canonicalReleaseGroupMbid: null, canonicalAlbumHref: null };
  const bridges = await db.select({
    recordingMbid: recordingReleaseGroupsTable.recordingMbid,
    releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
    isPrimary: recordingReleaseGroupsTable.isPrimary,
  }).from(recordingReleaseGroupsTable).where(inArray(recordingReleaseGroupsTable.recordingMbid, mbids));
  const coverage = new Map<string, Set<string>>();
  for (const bridge of bridges) {
    const set = coverage.get(bridge.releaseGroupMbid) ?? new Set<string>();
    set.add(bridge.recordingMbid);
    coverage.set(bridge.releaseGroupMbid, set);
  }
  const groups = [...coverage.entries()]
    .filter(([, covered]) => covered.size === mbids.length)
    .map(([group]) => group);
  if (groups.length !== 1) return { canonicalReleaseGroupMbid: null, canonicalAlbumHref: null };
  const group = groups[0];
  return {
    canonicalReleaseGroupMbid: group,
    canonicalAlbumHref: `/album/${encodeURIComponent(group)}`,
  };
}

function managedCollection(row: typeof loreCollectionsTable.$inferSelect) {
  return {
    ...publicCollection(row),
    published: row.unpublishedAt == null,
    publishedAt: row.publishedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    unpublishedAt: row.unpublishedAt?.toISOString() ?? null,
  };
}

async function enrichEntries(entries: CollectionEntry[]): Promise<CollectionEntry[]> {
  const mbids = entries.flatMap((entry) => entry.mbid ? [entry.mbid] : []);
  const mappings = mbids.length ? await db.select({
    recordingMbid: serviceTrackMapTable.recordingMbid,
    service: serviceTrackMapTable.service,
    externalId: serviceTrackMapTable.externalId,
    url: serviceTrackMapTable.url,
    confidence: serviceTrackMapTable.confidence,
    verification: serviceTrackMapTable.verification,
    deadLink: serviceTrackMapTable.deadLink,
  }).from(serviceTrackMapTable).where(inArray(serviceTrackMapTable.recordingMbid, mbids)) : [];
  return enrichVerifiedSpotifyEntries(entries, mappings);
}

router.get("/collections", requireUserMiddleware, h(async (req, res) => {
  const owner = (req as AuthedRequest).loreUser;
  const rows = await db.select().from(loreCollectionsTable)
    .where(eq(loreCollectionsTable.ownerId, owner.id))
    .orderBy(desc(loreCollectionsTable.updatedAt));
  res.json(rows.map(managedCollection));
}));

router.post("/collections", requireUserMiddleware, h(async (req, res) => {
  const checked = validateCollectionInput(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const body = checked.value;
  if (body.slug === COMPATIBILITY_SAMPLE_SLUG) {
    return res.status(409).json({ error: "Collection slug is reserved" });
  }
  const owner = (req as AuthedRequest).loreUser;
  const [existing] = await db.select().from(loreCollectionsTable)
    .where(eq(loreCollectionsTable.slug, body.slug)).limit(1);
  if (existing) {
    if (existing.ownerId === owner.id) {
      return res.status(409).json({
        error: "You already published this collection. Update the existing page instead.",
        code: "COLLECTION_OWNED",
        slug: body.slug,
      });
    }
    return res.status(409).json({
      error: "That public link is already in use. Choose a different slug.",
      code: "SLUG_TAKEN",
      suggestedSlug: `${body.slug.slice(0, 70)}-${String(owner.id)}`,
    });
  }
  body.entries = await enrichEntries(body.entries);
  const [row] = await db.insert(loreCollectionsTable).values({
    ownerId: owner.id, kind: body.kind, slug: body.slug, title: body.title,
    description: body.description ?? null, curatorNotes: body.curatorNotes ?? null,
    coverArt: body.coverArt ?? null, entries: body.entries,
  }).returning();
  return res.status(201).json(publicCollection(row));
}));

router.put("/collections/:slug", requireUserMiddleware, h(async (req, res) => {
  const slug = String(req.params.slug);
  const checked = validateCollectionInput({ ...req.body, slug });
  if (!checked.ok) {
    res.status(400).json({ error: checked.error });
    return;
  }
  const owner = (req as AuthedRequest).loreUser;
  const [existing] = await db.select().from(loreCollectionsTable)
    .where(eq(loreCollectionsTable.slug, slug)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Collection not found" });
    return;
  }
  if (existing.ownerId !== owner.id) {
    res.status(403).json({ error: "Only the collection owner can update it" });
    return;
  }
  const body = checked.value;
  body.entries = await enrichEntries(body.entries);
  const [row] = await db.update(loreCollectionsTable).set({
    kind: body.kind,
    title: body.title,
    description: body.description ?? null,
    curatorNotes: body.curatorNotes ?? null,
    coverArt: body.coverArt ?? null,
    entries: body.entries,
    updatedAt: new Date(),
    unpublishedAt: null,
  }).where(and(eq(loreCollectionsTable.slug, slug), eq(loreCollectionsTable.ownerId, owner.id))).returning();
  res.json(publicCollection(row));
  return;
}));

router.delete("/collections/:slug", requireUserMiddleware, h(async (req, res) => {
  const slug = String(req.params.slug);
  const owner = (req as AuthedRequest).loreUser;
  const [existing] = await db.select().from(loreCollectionsTable)
    .where(eq(loreCollectionsTable.slug, slug)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Collection not found" });
    return;
  }
  if (existing.ownerId !== owner.id) {
    res.status(403).json({ error: "Only the collection owner can withdraw it" });
    return;
  }
  await db.update(loreCollectionsTable).set({ unpublishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(loreCollectionsTable.slug, slug), eq(loreCollectionsTable.ownerId, owner.id)));
  res.status(204).send();
  return;
}));

router.get("/collections/:slug.jspf", h(async (req, res) => {
  const slug = String(req.params.slug);
  if (slug === COMPATIBILITY_SAMPLE_SLUG) {
    return res.type("application/json").send(JSON.stringify(toJspf(compatibilitySampleCollection)));
  }
  const [row] = await db.select().from(loreCollectionsTable).where(eq(loreCollectionsTable.slug, slug)).limit(1);
  if (!row) return res.status(404).json({ error: "Collection not found" });
  if (row.unpublishedAt) return res.status(410).json({ error: "This collection has been withdrawn", status: "withdrawn" });
  return res.type("application/json").send(JSON.stringify(toJspf(publicCollection(row))));
}));

router.get("/collections/:slug/credits", h(async (req, res) => {
  const slug = String(req.params.slug);
  const [row] = await db.select().from(loreCollectionsTable)
    .where(eq(loreCollectionsTable.slug, slug)).limit(1);
  if (!row) return res.status(404).json({ error: "Collection not found" });
  if (row.unpublishedAt) {
    return res.status(410).json({ error: "This collection has been withdrawn", status: "withdrawn" });
  }
  if (row.kind !== "album") {
    return res.status(400).json({ error: "Credits are available only for album collections" });
  }

  const entries = row.entries as CollectionEntry[];
  const canonicalEntries = entries.filter(
    (entry): entry is CollectionEntry & { mbid: string } =>
      entry.identity === "mbid" && typeof entry.mbid === "string",
  );
  const recordingMbids = [...new Set(canonicalEntries.map((entry) => entry.mbid))];
  if (!recordingMbids.length) {
    return res.json({
      album: null,
      tracks: [],
      releases: [],
      status: "unavailable",
      provenance: publicCreditProvenance([]),
    });
  }

  const bridges = await db.select({
    recordingMbid: recordingReleaseGroupsTable.recordingMbid,
    releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
    title: recordingReleaseGroupsTable.title,
    releaseYear: recordingReleaseGroupsTable.releaseYear,
    isPrimary: recordingReleaseGroupsTable.isPrimary,
  }).from(recordingReleaseGroupsTable)
    .where(inArray(recordingReleaseGroupsTable.recordingMbid, recordingMbids));
  const coverage = new Map<string, Set<string>>();
  for (const bridge of bridges) {
    const covered = coverage.get(bridge.releaseGroupMbid) ?? new Set<string>();
    covered.add(bridge.recordingMbid);
    coverage.set(bridge.releaseGroupMbid, covered);
  }
  const sharedGroups = [...coverage.entries()]
    .filter(([, covered]) => covered.size === recordingMbids.length)
    .map(([releaseGroupMbid]) => releaseGroupMbid);
  const releaseGroupMbid = sharedGroups.find((candidate) =>
    bridges
      .filter((bridge) => bridge.releaseGroupMbid === candidate)
      .every((bridge) => bridge.isPrimary),
  ) ?? sharedGroups[0];
  if (!releaseGroupMbid) {
    return res.json({
      album: null,
      tracks: canonicalEntries.map((entry) => ({
        mbid: entry.mbid,
        title: entry.title ?? null,
        artist: entry.artist ?? null,
        credits: [],
        status: "unavailable",
      })),
      releases: [],
      status: "unavailable",
      provenance: publicCreditProvenance([]),
    });
  }

  const credits = await db.select({
    recordingMbid: recordingCreditsTable.recordingMbid,
    creditedName: recordingCreditsTable.creditedName,
    role: recordingCreditsTable.role,
    roleGroup: recordingCreditsTable.roleGroup,
    artistMbid: recordingCreditsTable.artistMbid,
    workMbid: recordingCreditsTable.workMbid,
    workTitle: musicbrainzWorksTable.title,
    source: recordingCreditsTable.source,
    sourceUrl: recordingCreditsTable.sourceUrl,
    parserVersion: recordingCreditsTable.parserVersion,
    provenance: recordingCreditsTable.provenance,
    completeness: recordingCreditsTable.completeness,
    attemptStatus: recordingCreditsTable.attemptStatus,
    fetchedAt: recordingCreditsTable.fetchedAt,
  }).from(recordingCreditsTable)
    .leftJoin(musicbrainzWorksTable, eq(musicbrainzWorksTable.mbid, recordingCreditsTable.workMbid))
    .where(inArray(recordingCreditsTable.recordingMbid, recordingMbids))
    .orderBy(
      asc(recordingCreditsTable.recordingMbid),
      asc(recordingCreditsTable.roleGroup),
      asc(recordingCreditsTable.creditedName),
    );
  const releases = await db.select({
    releaseMbid: musicbrainzReleasesTable.mbid,
    releaseGroupMbid: musicbrainzReleasesTable.releaseGroupMbid,
    title: musicbrainzReleasesTable.title,
    releaseDate: musicbrainzReleasesTable.releaseDate,
    status: musicbrainzReleasesTable.status,
    country: musicbrainzReleasesTable.country,
    source: musicbrainzReleasesTable.source,
    parserVersion: musicbrainzReleasesTable.parserVersion,
    fetchedAt: musicbrainzReleasesTable.fetchedAt,
    provenance: musicbrainzReleasesTable.provenance,
    completeness: musicbrainzReleasesTable.completeness,
    labelMbid: musicbrainzLabelsTable.mbid,
    labelName: musicbrainzLabelsTable.name,
    catalogNumber: releaseLabelsTable.catalogNumber,
    labelParserVersion: releaseLabelsTable.parserVersion,
    labelFetchedAt: releaseLabelsTable.fetchedAt,
    labelProvenance: releaseLabelsTable.provenance,
  }).from(musicbrainzReleasesTable)
    .leftJoin(releaseLabelsTable, eq(releaseLabelsTable.releaseMbid, musicbrainzReleasesTable.mbid))
    .leftJoin(musicbrainzLabelsTable, eq(musicbrainzLabelsTable.mbid, releaseLabelsTable.labelMbid))
    .where(eq(musicbrainzReleasesTable.releaseGroupMbid, releaseGroupMbid));
  const tracks = canonicalEntries.map((entry) => {
    const trackCredits = credits
      .filter((credit) => credit.recordingMbid === entry.mbid)
      .map((credit) => ({
        ...credit,
        fetchedAt: credit.fetchedAt?.toISOString() ?? null,
        identity: credit.artistMbid
          ? { id: credit.artistMbid, type: "artist", name: credit.creditedName }
          : undefined,
        work: credit.workMbid
          ? { id: credit.workMbid, type: "work", name: credit.workTitle ?? credit.workMbid }
          : undefined,
      }));
    return {
      mbid: entry.mbid,
      title: entry.title ?? null,
      artist: entry.artist ?? null,
      credits: trackCredits,
      status: publicTrackStatus(trackCredits),
    };
  });
  const trackStatuses = tracks.map((track) => track.status);
  const hasFacts = credits.length > 0 || releases.length > 0;
  const albumBridge = bridges.find((bridge) => bridge.releaseGroupMbid === releaseGroupMbid);
  return res.json(GetPublicCollectionCreditsResponse.parse({
    album: {
      releaseGroupMbid,
      canonicalAlbumHref: `/album/${encodeURIComponent(releaseGroupMbid)}`,
      title: albumBridge?.title ?? row.title,
      releaseYear: albumBridge?.releaseYear ?? null,
    },
    tracks,
    releases: releases.map((release) => ({
      ...release,
      fetchedAt: release.fetchedAt?.toISOString() ?? null,
      labelFetchedAt: release.labelFetchedAt?.toISOString() ?? null,
    })),
    status: publicAlbumStatus(trackStatuses, hasFacts),
    provenance: publicCreditProvenance([
      ...credits,
      ...releases.map((release) => ({
        source: release.source,
        parserVersion: release.parserVersion,
        fetchedAt: release.fetchedAt,
      })),
    ]),
  }));
}));

router.get("/collections/:slug", h(async (req, res) => {
  const slug = String(req.params.slug);
  if (slug === COMPATIBILITY_SAMPLE_SLUG) return res.json(compatibilitySampleCollection);
  const [row] = await db.select().from(loreCollectionsTable).where(eq(loreCollectionsTable.slug, slug)).limit(1);
  if (!row) return res.status(404).json({ error: "Collection not found" });
  if (row.unpublishedAt) return res.status(410).json({ error: "This collection has been withdrawn", status: "withdrawn" });
  const identity = row.kind === "album"
    ? await canonicalCollectionIdentity(row.entries as CollectionEntry[])
    : { canonicalReleaseGroupMbid: null, canonicalAlbumHref: null };
  return res.json({ ...publicCollection(row), ...identity });
}));

router.post("/collections/parse-jspf", requireUserMiddleware, h(async (req, res) => {
  // This endpoint is an import helper only. Its provenance is explicitly
  // untrusted and is never persisted or treated as archival authority.
  if (!req.body?.playlist) return res.status(400).json({ error: "JSPF playlist required" });
  return res.json({ collection: fromJspf(req.body), archivalAuthority: "lore" });
}));

router.get("/collections/:slug/player", h(async (req, res) => {
  const slug = String(req.params.slug);
  if (slug !== COMPATIBILITY_SAMPLE_SLUG) {
    const [row] = await db.select({ unpublishedAt: loreCollectionsTable.unpublishedAt })
      .from(loreCollectionsTable).where(eq(loreCollectionsTable.slug, slug)).limit(1);
    if (!row) return res.status(404).json({ error: "Collection not found" });
    if (row.unpublishedAt) return res.status(410).json({ error: "This collection has been withdrawn", status: "withdrawn" });
  }
  return res.json(playerCapability);
}));

export default router;