import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  artistMerchProductsTable,
  artistMerchSourceTargetsTable,
  db,
} from "@workspace/db";
import { applyArtistMerchMigration } from "../src/lore/artist-merch-migration.js";
import {
  collectArtistMerchPage,
  loadArtistMerch,
  publicMerchProduct,
} from "../src/lore/artist-merch.js";

const ADMIN_TOKEN = "artist-merch-admin-test-token";
const artistMbid = "11111111-1111-4111-8111-111111111111";
const sourceUrl = "https://artist.bandcamp.com/";

process.env.LORE_ADMIN_TOKEN = ADMIN_TOKEN;

describe("artist merch operator enrollment", () => {
  let app: express.Express;

  beforeAll(async () => {
    await applyArtistMerchMigration();
    const { default: adminRouter } = await import("../src/routes/lore/admin.js");
    app = express();
    app.use(express.json());
    app.use(adminRouter);
  });

  afterAll(async () => {
    await db.delete(artistMerchProductsTable).where(
      eq(artistMerchProductsTable.artistMbid, artistMbid),
    );
    await db.delete(artistMerchSourceTargetsTable).where(
      eq(artistMerchSourceTargetsTable.artistMbid, artistMbid),
    );
  });

  it("enrolls an approved source and persists a collected product", async () => {
    const enrolled = await request(app)
      .post("/admin/artist-merch/sources")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({ artistMbid, sourceUrl, source: "bandcamp" });
    expect(enrolled.status).toBe(201);
    expect(enrolled.body).toMatchObject({
      artistMbid,
      sourceUrl,
      source: "bandcamp",
      status: "active",
    });

    const collected = await collectArtistMerchPage(
      {
        artistMbid,
        sourceUrl,
        source: "bandcamp",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
      {
        fetchFn: async () => new Response(
          '<a href="/merch/tour-shirt">Official merch</a>',
          { headers: { "content-type": "text/html" } },
        ),
      },
    );
    expect(collected).toBe(1);

    const products = await loadArtistMerch([artistMbid]);
    expect(products).toHaveLength(1);
    expect(publicMerchProduct(products[0]!, "Test Artist")).toMatchObject({
      artistMbid,
      artist: "Test Artist",
      destinationUrl: "https://artist.bandcamp.com/merch/tour-shirt",
    });
  });

  it("rejects unsafe, invalid, and source-policy-invalid enrollment", async () => {
    const invalidMbid = await request(app)
      .post("/admin/artist-merch/sources")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({ artistMbid: "not-an-mbid", sourceUrl, source: "bandcamp" });
    expect(invalidMbid.status).toBe(400);

    const unsafeUrl = await request(app)
      .post("/admin/artist-merch/sources")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({
        artistMbid,
        sourceUrl: "javascript:alert(1)",
        source: "artist_store",
      });
    expect(unsafeUrl.status).toBe(400);

    const wrongBandcampHost = await request(app)
      .post("/admin/artist-merch/sources")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({
        artistMbid,
        sourceUrl: "https://artist.example.com/store",
        source: "bandcamp",
      });
    expect(wrongBandcampHost.status).toBe(400);

    const unauthorized = await request(app)
      .post("/admin/artist-merch/sources")
      .send({ artistMbid, sourceUrl, source: "bandcamp" });
    expect(unauthorized.status).toBe(401);
  });
});