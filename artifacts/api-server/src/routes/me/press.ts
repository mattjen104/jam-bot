import { Router, type IRouter } from "express";
import {
  GetMyPressQueryParams, GetMyPressResponse, GetMySavedPressQueryParams,
  GetMySavedPressResponse, SavePressArticleParams, SavePressArticleResponse,
  UnsavePressArticleParams, UnsavePressArticleResponse,
  GetMyPressPublicationsResponse, GetMyPressPublicationParams,
  GetMyPressPublicationQueryParams, GetMyPressPublicationResponse,
} from "@workspace/api-zod";
import {
  db, rssArticlesTable, rssArticleBookmarksTable, pickersTable, tasteSeedsTable,
  spotifyLibraryItemsTable, libraryItemsTable, recordingsTable,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";
import {
  classifyPressDiscoveryArticle,
  isSafeArticleUrl,
} from "../../lore/blog.js";

const router: IRouter = Router();
const norm = (value: string | null) => (value ?? "")
  .normalize("NFKD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase()
  .replace(/^the\s+/, "")
  .replace(/[\s\p{P}]+/gu, "");
const page = (value: unknown, fallback: number) => {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : fallback;
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

interface PressTaste {
  /** Active Lore keeps and active Spotify imports are direct library taste. */
  direct: Set<string>;
  /** Seeds are useful taste overlap, but are not library keeps. */
  seeded: Set<string>;
}

async function taste(userId: number): Promise<PressTaste> {
  const [seeds, soft, library] = await Promise.all([
    db.select({ artist: tasteSeedsTable.artistName }).from(tasteSeedsTable).where(eq(tasteSeedsTable.userId, userId)),
    db.select({ artist: spotifyLibraryItemsTable.artist }).from(spotifyLibraryItemsTable)
      .where(and(eq(spotifyLibraryItemsTable.userId, userId), isNull(spotifyLibraryItemsTable.removedAt))),
    db.select({ artist: recordingsTable.artist }).from(libraryItemsTable)
      .innerJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
      .where(and(eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt))),
  ]);
  return {
    direct: new Set([...soft, ...library].map((r) => norm(r.artist)).filter(Boolean)),
    seeded: new Set(seeds.map((r) => norm(r.artist)).filter(Boolean)),
  };
}

async function rowsFor(userId: number, pickerId?: number) {
  const articles = await db.select({
    id: rssArticlesTable.id, title: rssArticlesTable.title, url: rssArticlesTable.url,
    guid: rssArticlesTable.guid, publishedAt: rssArticlesTable.publishedAt,
    author: rssArticlesTable.author, imageUrl: rssArticlesTable.imageUrl,
    excerpt: rssArticlesTable.excerpt,
    tags: rssArticlesTable.tags, matchedArtist: rssArticlesTable.matchedArtist,
    matchedWork: rssArticlesTable.matchedWork, pickerId: pickersTable.id,
    publication: pickersTable.name, handle: pickersTable.handle,
  }).from(rssArticlesTable).innerJoin(pickersTable, eq(rssArticlesTable.pickerId, pickersTable.id))
    .where(and(eq(pickersTable.active, true), eq(pickersTable.pickerType, "blog"), ...(pickerId ? [eq(pickersTable.id, pickerId)] : [])))
    // PostgreSQL DESC otherwise puts null publication dates first.
    .orderBy(sql`${rssArticlesTable.publishedAt} DESC NULLS LAST`, desc(rssArticlesTable.id));
  const saved = await db.select({ articleId: rssArticleBookmarksTable.articleId, savedAt: rssArticleBookmarksTable.savedAt })
    .from(rssArticleBookmarksTable).where(eq(rssArticleBookmarksTable.userId, userId));
  const savedById = new Map(saved.map((r) => [r.articleId, r.savedAt]));
  const artists = await taste(userId);
  return articles.filter((a) => isSafeArticleUrl(a.url)).map((a) => ({
    ...a, publishedAt: a.publishedAt?.toISOString() ?? null,
    imageUrl: a.imageUrl && isSafeArticleUrl(a.imageUrl) ? a.imageUrl : null,
    overlap: Boolean(
      a.matchedArtist &&
      (artists.direct.has(norm(a.matchedArtist)) || artists.seeded.has(norm(a.matchedArtist))),
    ),
    saved: savedById.has(a.id), savedAt: savedById.get(a.id)?.toISOString() ?? null,
  }));
}

type PressRow = Awaited<ReturnType<typeof rowsFor>>[number];

function compareNewestFirst(a: PressRow, b: PressRow): number {
  const dateA = a.publishedAt ?? "";
  const dateB = b.publishedAt ?? "";
  return dateB.localeCompare(dateA) || b.id - a.id;
}

/**
 * Apply the complete discovery policy before offset pagination. This keeps an
 * older direct-library story ahead of newer weakly related coverage and avoids
 * page boundaries splitting the relevance bands.
 */
async function discoveryRowsFor(userId: number): Promise<PressRow[]> {
  const [rows, artists] = await Promise.all([rowsFor(userId), taste(userId)]);
  return rows
    .filter((row) => classifyPressDiscoveryArticle(row).eligible)
    .sort((a, b) => {
      const aKey =
        a.matchedArtist && artists.direct.has(norm(a.matchedArtist)) ? 0 :
        a.matchedArtist && artists.seeded.has(norm(a.matchedArtist)) ? 1 : 2;
      const bKey =
        b.matchedArtist && artists.direct.has(norm(b.matchedArtist)) ? 0 :
        b.matchedArtist && artists.seeded.has(norm(b.matchedArtist)) ? 1 : 2;
      return aKey - bKey || compareNewestFirst(a, b);
    });
}

function pagination(items: Awaited<ReturnType<typeof rowsFor>>, req: Parameters<typeof page>[0]) {
  const offset = page(req, 0);
  return { items: items.slice(offset, offset + 30), offset, limit: 30, total: items.length,
    nextOffset: offset + 30 < items.length ? offset + 30 : null };
}

/** Overlap articles lead; each partition remains strictly newest-first. */
router.get("/me/press", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const query = GetMyPressQueryParams.parse(req.query);
  res.json(GetMyPressResponse.parse(pagination(await discoveryRowsFor(user.id), query.offset)));
}));

router.get("/me/press/saved", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const query = GetMySavedPressQueryParams.parse(req.query);
  const items = (await rowsFor(user.id)).filter((a) => a.saved)
    .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
  res.json(GetMySavedPressResponse.parse(pagination(items, query.offset)));
}));

router.put("/me/press/articles/:articleId/bookmark", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const articleId = SavePressArticleParams.parse(req.params).articleId;
  if (!Number.isInteger(articleId)) return void res.status(400).json({ error: "Invalid article id" });
  const [article] = await db.select({ id: rssArticlesTable.id, url: rssArticlesTable.url })
    .from(rssArticlesTable).where(eq(rssArticlesTable.id, articleId)).limit(1);
  if (!article || !isSafeArticleUrl(article.url)) {
    return void res.status(404).json({ error: "Article not found" });
  }
  await db.insert(rssArticleBookmarksTable).values({ userId: user.id, articleId }).onConflictDoNothing();
  return void res.json(SavePressArticleResponse.parse({ articleId, saved: true }));
}));
router.delete("/me/press/articles/:articleId/bookmark", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const articleId = UnsavePressArticleParams.parse(req.params).articleId;
  if (!Number.isInteger(articleId)) return void res.status(400).json({ error: "Invalid article id" });
  await db.delete(rssArticleBookmarksTable).where(and(eq(rssArticleBookmarksTable.userId, user.id), eq(rssArticleBookmarksTable.articleId, articleId)));
  return void res.json(UnsavePressArticleResponse.parse({ articleId, saved: false }));
}));

router.get("/me/press/publications", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const publications = await db.select({ id: pickersTable.id, name: pickersTable.name, handle: pickersTable.handle, tags: pickersTable.tags, health: pickersTable.health, sourceRef: pickersTable.sourceRef })
    .from(pickersTable).where(and(eq(pickersTable.active, true), eq(pickersTable.pickerType, "blog")));
  const articleRows = await rowsFor(user.id);
  const byPicker = new Map<number, number>();
  const overlaps = new Map<number, number>();
  for (const row of articleRows) {
    byPicker.set(row.pickerId, (byPicker.get(row.pickerId) ?? 0) + 1);
    if (row.overlap) overlaps.set(row.pickerId, (overlaps.get(row.pickerId) ?? 0) + 1);
  }
  res.json(GetMyPressPublicationsResponse.parse({ items: publications
    .filter((p) => typeof p.sourceRef?.["feedUrl"] === "string")
    .map((p) => ({
    ...p, articleCount: byPicker.get(p.id) ?? 0, overlapCount: overlaps.get(p.id) ?? 0,
  })) }));
}));

router.get("/me/press/publications/:handle", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const handle = GetMyPressPublicationParams.parse(req.params).handle;
  const query = GetMyPressPublicationQueryParams.parse(req.query);
  const [publication] = await db.select({ id: pickersTable.id, name: pickersTable.name, handle: pickersTable.handle })
    .from(pickersTable).where(and(eq(pickersTable.handle, handle), eq(pickersTable.pickerType, "blog"), eq(pickersTable.active, true))).limit(1);
  if (!publication) return void res.status(404).json({ error: "Publication not found" });
  return void res.json(GetMyPressPublicationResponse.parse({
    publication, ...pagination(await rowsFor(user.id, publication.id), query.offset),
  }));
}));

export default router;