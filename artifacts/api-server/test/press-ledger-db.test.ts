// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, loreUsersTable, pickersTable, rssArticlesTable, rssArticleBookmarksTable,
  tasteSeedsTable, picksTable, blogListCandidatesTable, recordingsTable,
  libraryItemsTable, spotifyLibraryItemsTable,
} from "@workspace/db";
import app from "../src/app.js";
import { ingestBlogFeed } from "../src/lore/blog.js";
import { applyRssArticlesMigration } from "../src/lore/rss-articles-migration.js";

const run = randomUUID().slice(0, 8);
const sidA = `press-a-${run}`, sidB = `press-b-${run}`;
let userA = 0, userB = 0, pressPicker = 0, emptyPicker = 0, ingestPicker = 0;
let rankingPicker = 0;
let server: Server, baseUrl = "", dbAvailable = false;
const ids: number[] = [];
const rankingIds: number[] = [];
const rankingMbids: string[] = [];

async function request(path: string, sid: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", `lore_sid=${sid}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  return { status: response.status, body: await response.json() as any };
}

beforeAll(async () => {
  try { await db.execute(sql`select 1`); dbAvailable = true; } catch { return; }
  const users = await db.insert(loreUsersTable).values([
    { deviceKey: sidA }, { deviceKey: sidB },
  ]).returning({ id: loreUsersTable.id });
  userA = users[0]!.id; userB = users[1]!.id;
  await db.insert(tasteSeedsTable).values({ userId: userA, artistName: `Matched Artist ${run}` });
  const pickers = await db.insert(pickersTable).values([
    { pickerType: "blog", name: `Press ${run}`, handle: `press-${run}`, sourceRef: { feedUrl: `https://feed.example/${run}` } },
    { pickerType: "blog", name: `Empty ${run}`, handle: `empty-${run}`, sourceRef: { feedUrl: `https://empty.example/${run}` } },
    { pickerType: "blog", name: `Ranking ${run}`, handle: `ranking-${run}`, sourceRef: { feedUrl: `https://ranking.example/${run}` } },
  ]).returning({ id: pickersTable.id });
  pressPicker = pickers[0]!.id; emptyPicker = pickers[1]!.id; rankingPicker = pickers[2]!.id;

  // Future fixture dates keep this test's pagination deterministic even on a
  // shared development database.  Two crossings must precede every unmatched
  // article; each partition still sorts newest first.
  const articles = Array.from({ length: 33 }, (_, i) => ({
    pickerId: pressPicker, guid: `g-${run}-${i}`, url: `https://press.example/${run}/${i}`,
    title: `Music article ${i} ${run}`, tags: ["music"],
    publishedAt: i === 32 ? null : new Date(Date.UTC(2099, 0, 31 - i)),
    matchedArtist: i < 2 ? `Matched Artist ${run}` : null,
    matchedWork: i < 2 ? `Work ${i}` : null,
    author: i === 0 ? `Writer ${run}` : null,
    imageUrl: i === 0 ? `https://press.example/${run}/cover.jpg` : null,
    excerpt: i === 0 ? `Excerpt ${run}` : null,
  }));
  const inserted = await db.insert(rssArticlesTable).values(articles).returning({ id: rssArticlesTable.id });
  ids.push(...inserted.map((r) => r.id));

  const directMbid = `press-direct-${run}`;
  const removedMbid = `press-removed-${run}`;
  rankingMbids.push(directMbid, removedMbid);
  await db.insert(recordingsTable).values([
    { mbid: directMbid, title: "Older story", artist: `Direct Library Artist ${run}` },
    { mbid: removedMbid, title: "Removed story", artist: `Removed Library Artist ${run}` },
  ]);
  await db.insert(libraryItemsTable).values([
    { userId: userA, mbid: directMbid, provenance: { kind: "keep" } },
    {
      userId: userA,
      mbid: removedMbid,
      provenance: { kind: "keep" },
      removedAt: new Date(),
    },
  ]);
  await db.insert(spotifyLibraryItemsTable).values({
    userId: userA,
    spotifyId: `press-spotify-${run}`,
    title: "Imported story",
    artist: `Imported Library Artist ${run}`,
  });
  const rankingArticles = await db.insert(rssArticlesTable).values([
    {
      pickerId: rankingPicker, guid: `ranking-direct-${run}`,
      url: `https://press.example/${run}/ranking-direct`,
      title: "An older story", tags: ["news"],
      publishedAt: new Date(Date.UTC(2090, 0, 1)),
      matchedArtist: `Direct Library Artist ${run}`, matchedWork: "Older story",
    },
    {
      pickerId: rankingPicker, guid: `ranking-import-${run}`,
      url: `https://press.example/${run}/ranking-import`,
      title: "An imported story", tags: ["news"],
      publishedAt: new Date(Date.UTC(2091, 0, 1)),
      matchedArtist: `Imported Library Artist ${run}`, matchedWork: "Imported story",
    },
    {
      pickerId: rankingPicker, guid: `ranking-generic-${run}`,
      url: `https://press.example/${run}/ranking-generic`,
      title: "New music news", tags: ["music"],
      publishedAt: new Date(Date.UTC(2099, 0, 1)),
    },
    {
      pickerId: rankingPicker, guid: `ranking-removed-${run}`,
      url: `https://press.example/${run}/ranking-removed`,
      title: "A removed-library story", tags: ["news"],
      publishedAt: new Date(Date.UTC(2089, 0, 1)),
      matchedArtist: `Removed Library Artist ${run}`, matchedWork: "Removed story",
    },
    {
      pickerId: rankingPicker, guid: `ranking-game-${run}`,
      url: `https://press.example/${run}/ranking-gaming`,
      title: "Nintendo – The next console reviewed", tags: ["gaming"],
      publishedAt: new Date(Date.UTC(2100, 0, 1)),
      matchedArtist: "Nintendo", matchedWork: "The next console",
    },
    {
      pickerId: rankingPicker, guid: `ranking-city-${run}`,
      url: `https://press.example/${run}/ranking-generic-news`,
      title: "City council approves a new transit plan", tags: ["news"],
      publishedAt: new Date(Date.UTC(2101, 0, 1)),
    },
  ]).returning({ id: rssArticlesTable.id });
  rankingIds.push(...rankingArticles.map((r) => r.id));

  server = app.listen(0);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 120_000);

afterAll(async () => {
  if (!dbAvailable) return;
  server?.close();
  await db.delete(rssArticleBookmarksTable).where(inArray(rssArticleBookmarksTable.articleId, ids));
  await db.delete(rssArticlesTable).where(inArray(rssArticlesTable.id, ids));
  for (const id of [pressPicker, emptyPicker, rankingPicker, ingestPicker]) if (id) {
    // Article rows reference the publication; remove their bookmarks first.
    const articleRows = await db.select({ id: rssArticlesTable.id }).from(rssArticlesTable).where(eq(rssArticlesTable.pickerId, id));
    if (articleRows.length) {
      await db.delete(rssArticleBookmarksTable).where(inArray(rssArticleBookmarksTable.articleId, articleRows.map((r) => r.id)));
      await db.delete(rssArticlesTable).where(eq(rssArticlesTable.pickerId, id));
    }
    await db.delete(blogListCandidatesTable).where(eq(blogListCandidatesTable.pickerId, id));
    await db.delete(picksTable).where(eq(picksTable.pickerId, id));
    await db.delete(pickersTable).where(eq(pickersTable.id, id));
  }
  await db.delete(libraryItemsTable).where(inArray(libraryItemsTable.mbid, rankingMbids));
  await db.delete(spotifyLibraryItemsTable).where(eq(spotifyLibraryItemsTable.userId, userA));
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, rankingMbids));
  await db.delete(tasteSeedsTable).where(inArray(tasteSeedsTable.userId, [userA, userB]));
  await db.delete(loreUsersTable).where(inArray(loreUsersTable.id, [userA, userB]));
}, 120_000);

describe("RSS article ledger ingestion", () => {
  it("retains matched and unmatched items, dedups guid/link, and creates no picks or list jobs", async () => {
    if (!dbAvailable) return;
    const feedUrl = `https://ingest.example/${run}.xml`;
    const xml = `<rss><channel><item><guid>one</guid><title>Matched Artist ${run} – Work</title><link>https://article.example/${run}/one</link></item><item><guid>two</guid><title>A roundup with no parsable work</title><link>https://article.example/${run}/two</link></item><item><guid>unsafe</guid><title>Unsafe link</title><link>javascript:alert(1)</link></item></channel></rss>`;
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml, { status: 200 })));
    try {
      const first = await ingestBlogFeed({ feedUrl, name: `Ingest ${run}` });
      ingestPicker = first.pickerId;
      const second = await ingestBlogFeed({ feedUrl, name: `Ingest ${run}` });
      expect(first.inserted).toBe(2);
      expect(first.matched).toBe(1);
      expect(second.inserted).toBe(0);
      const rows = await db.select().from(rssArticlesTable).where(eq(rssArticlesTable.pickerId, ingestPicker));
      expect(rows).toHaveLength(2);
      expect(rows.some((r) => r.matchedArtist == null)).toBe(true);
      const enrichedXml = xml.replace(
        "<guid>one</guid>",
        `<guid>one</guid><dc:creator>Feed Writer ${run}</dc:creator><media:thumbnail url="https://article.example/${run}/cover.jpg"/><description><![CDATA[<p>Feed excerpt ${run}</p>]]></description>`,
      );
      vi.stubGlobal("fetch", vi.fn(async () => new Response(enrichedXml, { status: 200 })));
      expect((await ingestBlogFeed({ feedUrl, name: `Ingest ${run}` })).inserted).toBe(0);
      const [enriched] = await db.select().from(rssArticlesTable)
        .where(and(eq(rssArticlesTable.pickerId, ingestPicker), eq(rssArticlesTable.guid, "one")));
      expect(enriched).toMatchObject({
        author: `Feed Writer ${run}`,
        imageUrl: `https://article.example/${run}/cover.jpg`,
        excerpt: `Feed excerpt ${run}`,
      });
      // Same URL with a changed GUID is also idempotent per publication.
      const dupUrl = xml.replace("<guid>two</guid>", "<guid>different-guid</guid>");
      vi.stubGlobal("fetch", vi.fn(async () => new Response(dupUrl, { status: 200 })));
      expect((await ingestBlogFeed({ feedUrl, name: `Ingest ${run}` })).inserted).toBe(0);
      const dupGuid = xml.replace(`https://article.example/${run}/two`, `https://article.example/${run}/moved`);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(dupGuid, { status: 200 })));
      expect((await ingestBlogFeed({ feedUrl, name: `Ingest ${run}` })).inserted).toBe(0);
      expect(await db.select().from(picksTable).where(eq(picksTable.pickerId, ingestPicker))).toHaveLength(0);
      expect(await db.select().from(blogListCandidatesTable).where(eq(blogListCandidatesTable.pickerId, ingestPicker))).toHaveLength(0);
    } finally {
      vi.stubGlobal("fetch", original);
    }
  });

  it("retires pending RSS list candidates without deleting their history", async () => {
    if (!dbAvailable) return;
    const [candidate] = await db.insert(blogListCandidatesTable).values({
      pickerId: pressPicker,
      guid: `retire-${run}`,
      url: `https://press.example/${run}/legacy-list`,
      title: "Legacy RSS list candidate",
    }).returning();
    await applyRssArticlesMigration();
    const [retired] = await db.select().from(blogListCandidatesTable)
      .where(eq(blogListCandidatesTable.id, candidate!.id));
    expect(retired?.status).toBe("skipped");
    expect(retired?.note).toMatch(/source-directed Press articles/);
  });
});

describe("ledger-backed Press reads", () => {
  it("partitions crossings, retains cold-listener unmatched items, and pages without duplicates", async () => {
    if (!dbAvailable) return;
    const first = await request("/api/me/press", sidA);
    expect(first.status).toBe(200);
    const firstNonOverlap = first.body.items.findIndex((a: any) => !a.overlap);
    expect(firstNonOverlap).toBeGreaterThan(0);
    expect(first.body.items.slice(0, firstNonOverlap).every((a: any) => a.overlap)).toBe(true);
    expect(first.body.items.slice(firstNonOverlap).every((a: any) => !a.overlap)).toBe(true);
    const enriched = first.body.items.find((a: any) => a.id === ids[0]);
    expect(enriched).toMatchObject({
      author: `Writer ${run}`,
      imageUrl: `https://press.example/${run}/cover.jpg`,
      excerpt: `Excerpt ${run}`,
      relevance: "seed",
    });
    const seen = new Set<number>();
    let offset: number | null = 0;
    for (let pageNumber = 0; offset !== null && pageNumber < 100; pageNumber++) {
      const page = await request(`/api/me/press?offset=${offset}`, sidA);
      for (const item of page.body.items.filter((a: any) => a.pickerId === pressPicker)) {
        expect(seen.has(item.id)).toBe(false); seen.add(item.id);
      }
      offset = page.body.nextOffset;
    }
    expect(seen.size).toBe(33);
    const cold = await request("/api/me/press", sidB);
    expect(cold.body.items.some((a: any) => a.pickerId === pressPicker && !a.overlap)).toBe(true);
    expect(cold.body.items.find((a: any) => a.pickerId === pressPicker)?.relevance).toBe("coverage");
  });

  it("ranks active library artists ahead of newer music coverage and ignores removed keeps", async () => {
    if (!dbAvailable) return;
    const allItems: any[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const response = await request(`/api/me/press?offset=${offset}`, sidA);
      expect(response.status).toBe(200);
      allItems.push(...response.body.items);
      offset = response.body.nextOffset;
    }
    const rankingItems = allItems.filter((a: any) => a.pickerId === rankingPicker);
    expect(rankingItems.map((a: any) => a.id)).toEqual([
      rankingIds[1],
      rankingIds[0],
      rankingIds[2],
      rankingIds[3],
    ]);
    expect(rankingItems[0].overlap).toBe(true);
    expect(rankingItems[1].overlap).toBe(true);
    expect(rankingItems[0].relevance).toBe("library");
    expect(rankingItems[1].relevance).toBe("library");
    expect(rankingItems[2].overlap).toBe(false);
    expect(rankingItems[3].overlap).toBe(false);
    expect(rankingItems[2].relevance).toBe("coverage");
    expect(rankingItems[3].relevance).toBe("coverage");

    const archive = await request(`/api/me/press/publications/ranking-${run}`, sidA);
    expect(archive.body.total).toBe(6);
    expect(archive.body.items.some((a: any) => a.title.includes("Nintendo"))).toBe(true);
  });

  it("keeps bookmarks per listener and orders saved newest first", async () => {
    if (!dbAvailable) return;
    const [older, newer] = ids;
    await request(`/api/me/press/articles/${older}/bookmark`, sidA, { method: "PUT" });
    await request(`/api/me/press/articles/${older}/bookmark`, sidA, { method: "PUT" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await request(`/api/me/press/articles/${newer}/bookmark`, sidA, { method: "PUT" });
    const saved = await request("/api/me/press/saved", sidA);
    expect(saved.body.items.slice(0, 2).map((a: any) => a.id)).toEqual([newer, older]);
    const other = await request("/api/me/press/saved", sidB);
    expect(other.body.items).toHaveLength(0);
  });

  it("lists zero-article RSS publications and returns complete publication history with saved state", async () => {
    if (!dbAvailable) return;
    const directory = await request("/api/me/press/publications", sidA);
    expect(directory.body.items.some((p: any) => p.handle === `empty-${run}` && p.articleCount === 0)).toBe(true);
    const history = await request(`/api/me/press/publications/press-${run}`, sidA);
    expect(history.body.total).toBe(33);
    expect(history.body.items[0].publishedAt > history.body.items[1].publishedAt).toBe(true);
    expect(history.body.items.some((a: any) => a.id === ids[0] && a.saved)).toBe(true);
    const finalPage = await request(`/api/me/press/publications/press-${run}?offset=30`, sidA);
    expect(finalPage.body.items.at(-1).publishedAt).toBeNull();
  });
});