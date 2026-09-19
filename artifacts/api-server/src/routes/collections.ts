import { Router, type IRouter } from "express";
import { db, loreCollectionsTable, serviceTrackMapTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { h } from "../middlewares/asyncHandler.js";
import { requireUserMiddleware, type AuthedRequest } from "./me/auth.js";
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

router.get("/collections/:slug", h(async (req, res) => {
  const slug = String(req.params.slug);
  if (slug === COMPATIBILITY_SAMPLE_SLUG) return res.json(compatibilitySampleCollection);
  const [row] = await db.select().from(loreCollectionsTable).where(eq(loreCollectionsTable.slug, slug)).limit(1);
  if (!row) return res.status(404).json({ error: "Collection not found" });
  if (row.unpublishedAt) return res.status(410).json({ error: "This collection has been withdrawn", status: "withdrawn" });
  return res.json(publicCollection(row));
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