// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import { db, pickersTable, rssArticlesTable } from "@workspace/db";
import app from "../../src/app.js";
import {
  classifyPressDiscoveryArticle,
  ingestBlogFeed,
} from "../../src/lore/blog.js";
import {
  STATION_PRESS_PUBLICATIONS,
  STATION_EDITORIAL_RSS_LINK_FIXTURES,
  seedStations,
  seedStationPressPublications,
  seedStationEditorialRssLinks,
} from "../../src/lore/seed.js";

const STATION_SLUG_BY_HANDLE = new Map(
  STATION_EDITORIAL_RSS_LINK_FIXTURES.map((fixture) => [
    fixture.pickerHandle,
    fixture.stationSlug,
  ]),
);

let server: Server;
let baseUrl = "";
const sid = `station-press-real-${Date.now()}`;

async function request(path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie: `lore_sid=${sid}` },
  });
  return {
    status: response.status,
    body: await response.json() as any,
  };
}

beforeAll(async () => {
  // This focused check intentionally does not run globalSetup or migrations.
  // It verifies the already-booted development schema and real public feeds.
  await db.execute(sql`select 1`);
  server = app.listen(0);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server?.close();
});

describe("station-owned Press feed batch", () => {
  it("serially retains every live feed and exposes reviewed ownership on every Press read model", async () => {
    await seedStations();
    await seedStationPressPublications();
    for (const source of STATION_PRESS_PUBLICATIONS) {
      const poll = await ingestBlogFeed(source);
      expect(poll.handle).toBe(source.handle);
      expect(poll.success, source.handle).toBe(true);
      expect(poll.items, source.handle).toBeGreaterThan(0);
    }

    const fixtures = STATION_PRESS_PUBLICATIONS.map((source) => {
      const fixture = STATION_EDITORIAL_RSS_LINK_FIXTURES.find(
        (link) => link.pickerHandle === source.handle,
      );
      expect(fixture, source.handle).toBeDefined();
      return fixture!;
    });
    await seedStationEditorialRssLinks(fixtures);

    const directory = await request("/api/me/press/publications");
    expect(directory.status).toBe(200);

    for (const source of STATION_PRESS_PUBLICATIONS) {
      const stationSlug = STATION_SLUG_BY_HANDLE.get(source.handle);
      expect(stationSlug, source.handle).toBeDefined();
      const [picker] = await db.select({
        id: pickersTable.id,
        sourceRef: pickersTable.sourceRef,
      })
        .from(pickersTable)
        .where(eq(pickersTable.handle, source.handle))
        .limit(1);
      expect(picker, source.handle).toBeDefined();
      expect(picker!.sourceRef?.["feedUrl"]).toBe(source.feedUrl);

      const retained = await db.select({
        title: rssArticlesTable.title,
        tags: rssArticlesTable.tags,
        excerpt: rssArticlesTable.excerpt,
        matchedArtist: rssArticlesTable.matchedArtist,
        matchedWork: rssArticlesTable.matchedWork,
      })
        .from(rssArticlesTable)
        .where(eq(rssArticlesTable.pickerId, picker!.id));
      expect(retained.length, source.handle).toBeGreaterThan(0);
      expect(
        retained.some((article) => classifyPressDiscoveryArticle(article).eligible),
        `${source.handle} should retain discoverable music-editorial coverage`,
      ).toBe(true);

      expect(
        directory.body.items.find(
          (publication: any) => publication.handle === source.handle,
        ),
      ).toMatchObject({
        stationOwner: {
          station: { slug: stationSlug },
          show: null,
        },
      });

      const archive = await request(`/api/me/press/publications/${source.handle}`);
      expect(archive.status, source.handle).toBe(200);
      expect(archive.body.total, source.handle).toBeGreaterThan(0);
      expect(archive.body.publication.stationOwner.station.slug).toBe(stationSlug);
      expect(
        archive.body.items.every(
          (article: any) => article.stationOwner?.station.slug === stationSlug,
        ),
      ).toBe(true);
    }
  }, 240_000);
});