import { Router, type IRouter } from "express";
import { db, loreCollectionsTable, serviceTrackMapTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
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

router.post("/collections", requireUserMiddleware, h(async (req, res) => {
  const checked = validateCollectionInput(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const body = checked.value;
  if (body.slug === COMPATIBILITY_SAMPLE_SLUG) {
    return res.status(409).json({ error: "Collection slug is reserved" });
  }
  const mbids = body.entries.flatMap((entry) => entry.mbid ? [entry.mbid] : []);
  const mappings = mbids.length ? await db.select({
    recordingMbid: serviceTrackMapTable.recordingMbid,
    service: serviceTrackMapTable.service,
    externalId: serviceTrackMapTable.externalId,
    url: serviceTrackMapTable.url,
    confidence: serviceTrackMapTable.confidence,
    verification: serviceTrackMapTable.verification,
    deadLink: serviceTrackMapTable.deadLink,
  }).from(serviceTrackMapTable).where(inArray(serviceTrackMapTable.recordingMbid, mbids)) : [];
  body.entries = enrichVerifiedSpotifyEntries(body.entries, mappings);
  const owner = (req as AuthedRequest).loreUser;
  const [row] = await db.insert(loreCollectionsTable).values({
    ownerId: owner.id, kind: body.kind, slug: body.slug, title: body.title,
    description: body.description ?? null, curatorNotes: body.curatorNotes ?? null,
    coverArt: body.coverArt ?? null, entries: body.entries,
  }).returning();
  return res.status(201).json(publicCollection(row));
}));

router.get("/collections/:slug.jspf", h(async (req, res) => {
  const slug = String(req.params.slug);
  if (slug === COMPATIBILITY_SAMPLE_SLUG) {
    return res.type("application/json").send(JSON.stringify(toJspf(compatibilitySampleCollection)));
  }
  const [row] = await db.select().from(loreCollectionsTable).where(eq(loreCollectionsTable.slug, slug)).limit(1);
  if (!row) return res.status(404).json({ error: "Collection not found" });
  return res.type("application/json").send(JSON.stringify(toJspf(publicCollection(row))));
}));

router.get("/collections/:slug", h(async (req, res) => {
  const slug = String(req.params.slug);
  if (slug === COMPATIBILITY_SAMPLE_SLUG) return res.json(compatibilitySampleCollection);
  const [row] = await db.select().from(loreCollectionsTable).where(eq(loreCollectionsTable.slug, slug)).limit(1);
  if (!row) return res.status(404).json({ error: "Collection not found" });
  return res.json(publicCollection(row));
}));

router.post("/collections/parse-jspf", requireUserMiddleware, h(async (req, res) => {
  // This endpoint is an import helper only. Its provenance is explicitly
  // untrusted and is never persisted or treated as archival authority.
  if (!req.body?.playlist) return res.status(400).json({ error: "JSPF playlist required" });
  return res.json({ collection: fromJspf(req.body), archivalAuthority: "lore" });
}));

router.get("/collections/:slug/player", h(async (_req, res) => res.json(playerCapability)));

export default router;