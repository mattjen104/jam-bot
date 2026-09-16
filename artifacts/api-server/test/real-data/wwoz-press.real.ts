// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import { db, pickersTable, rssArticlesTable } from "@workspace/db";
import app from "../../src/app.js";
import { ingestBlogFeed } from "../../src/lore/blog.js";
import {
  STATION_EDITORIAL_RSS_LINK_FIXTURES,
  seedStationEditorialRssLinks,
} from "../../src/lore/seed.js";

const WWOZ_FEED_URL = "https://www.wwoz.org/rss.xml";
const WWOZ_HANDLE = "wwoz-stories";
const WWOZ_STATION_SLUG = "wwoz";

let server: Server;
let baseUrl = "";
const sid = `wwoz-press-real-${Date.now()}`;

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
  // This focused check intentionally does not run globalSetup or any migration.
  // It verifies the already-booted development schema and real public feed.
  await db.execute(sql`select 1`);
  server = app.listen(0);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server?.close();
});

describe("WWOZ station-owned Press feed", () => {
  it("retains live stories and exposes WWOZ ownership on every Press read model", async () => {
    const poll = await ingestBlogFeed({
      feedUrl: WWOZ_FEED_URL,
      name: "WWOZ Stories",
      homeUrl: "https://www.wwoz.org/",
    });
    expect(poll.success).toBe(true);
    expect(poll.items).toBeGreaterThan(0);

    const fixture = STATION_EDITORIAL_RSS_LINK_FIXTURES.find(
      (link) => link.pickerHandle === WWOZ_HANDLE,
    );
    expect(fixture).toBeDefined();
    await seedStationEditorialRssLinks([fixture!]);

    const [picker] = await db.select({ id: pickersTable.id })
      .from(pickersTable)
      .where(eq(pickersTable.handle, WWOZ_HANDLE))
      .limit(1);
    expect(picker).toBeDefined();

    const retained = await db.select({ id: rssArticlesTable.id })
      .from(rssArticlesTable)
      .where(eq(rssArticlesTable.pickerId, picker!.id));
    expect(retained.length).toBeGreaterThan(0);

    const directory = await request("/api/me/press/publications");
    expect(directory.status).toBe(200);
    expect(
      directory.body.items.find((publication: any) => publication.handle === WWOZ_HANDLE),
    ).toMatchObject({
      stationOwner: {
        station: { slug: WWOZ_STATION_SLUG, name: "WWOZ 90.7 FM" },
        show: null,
      },
    });
    expect(
      directory.body.items.find((publication: any) => publication.handle === WWOZ_HANDLE)
        .articleCount,
    ).toBeGreaterThan(0);

    // SelectorArchive renders this publication owner as a listener-facing
    // station link and PressArticleRow renders the same owner on every story.
    const archive = await request(`/api/me/press/publications/${WWOZ_HANDLE}`);
    expect(archive.status).toBe(200);
    expect(archive.body.total).toBeGreaterThan(0);
    expect(archive.body.publication.stationOwner.station.slug).toBe(WWOZ_STATION_SLUG);
    expect(archive.body.items[0].stationOwner.station.slug).toBe(WWOZ_STATION_SLUG);
  });
});