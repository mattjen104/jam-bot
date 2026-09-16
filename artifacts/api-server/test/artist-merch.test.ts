import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  artistMerchProductsTable,
  db,
} from "@workspace/db";
import { applyArtistMerchMigration } from "../src/lore/artist-merch-migration.js";
import {
  collectApprovedMerchEvidence,
  extractApprovedMerchLinks,
  normalizeMerchDestination,
  persistMerchEvidence,
  safeMerchUrl,
} from "../src/lore/artist-merch.js";

describe("artist merch evidence", () => {
  const expiresAt = new Date("2030-01-01T00:00:00.000Z");
  const testArtist = "artist-merch-source-scope-test";

  beforeAll(async () => {
    await applyArtistMerchMigration();
  });

  afterAll(async () => {
    await db.delete(artistMerchProductsTable).where(
      eq(artistMerchProductsTable.artistMbid, testArtist),
    );
  });

  it("keeps canonical, image-less products and deduplicates destinations", () => {
    const rows = collectApprovedMerchEvidence(
      [
        {
          artistMbid: "artist-a",
          title: "Tour shirt",
          destinationUrl: "https://artist.example.com/shirt/",
          imageUrl: null,
          source: "artist_store",
          sourceUrl: "https://artist.example.com/store",
          expiresAt,
        },
        {
          artistMbid: "artist-a",
          title: "Duplicate",
          destinationUrl: "https://artist.example.com/shirt",
          source: "artist_store",
          sourceUrl: "https://artist.example.com/store",
          expiresAt,
        },
        {
          artistMbid: "artist-b",
          title: "Name collision must remain separate",
          destinationUrl: "https://other.example.com/other",
          source: "artist_store",
          sourceUrl: "https://other.example.com/store",
          expiresAt,
        },
      ],
      new Date("2029-01-01T00:00:00.000Z"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ artistMbid: "artist-a", imageUrl: null });
    expect(rows[1]).toMatchObject({ artistMbid: "artist-b" });
  });

  it("rejects unsafe, stale, and ambiguous provenance", () => {
    expect(safeMerchUrl("javascript:alert(1)")).toBeNull();
    expect(safeMerchUrl("https://localhost/store")).toBeNull();
    expect(
      collectApprovedMerchEvidence(
        [
          {
            artistMbid: "artist-a",
            title: "stale",
            destinationUrl: "https://bandcamp.com/artist/stale",
            source: "bandcamp",
            sourceUrl: "https://artist.example.com",
            expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          },
          {
            artistMbid: "artist-a",
            title: "ambiguous",
            destinationUrl: "https://unrelated.example/store",
            source: "artist_store",
            sourceUrl: "https://artist.example.com",
            expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          },
        ],
        new Date("2025-01-01T00:00:00.000Z"),
      ),
    ).toEqual([]);
  });

  it("parses only explicit approved product links", () => {
    const rows = extractApprovedMerchLinks(
      `<a href="/store/shirt"><img src="/shirt.jpg">Official merch</a>
       <a href="https://bad.example/nope">Read the news</a>`,
      {
        artistMbid: "artist-a",
        sourceUrl: "https://artist.example.com",
        source: "artist_store",
        expiresAt,
      },
      new Date("2029-01-01T00:00:00.000Z"),
    );
    expect(rows).toHaveLength(1);
    expect(normalizeMerchDestination(rows[0]!.destinationUrl)).toBe(
      "https://artist.example.com/store/shirt",
    );
  });

  it("removes only the refreshed source snapshot", async () => {
    const sourceA = "https://artist.example.com/store";
    const sourceB = "https://artist.example.com/bandcamp";
    await persistMerchEvidence(testArtist, sourceA, [{
      artistMbid: testArtist,
      title: "Store shirt",
      destinationUrl: "https://artist.example.com/store/shirt",
      source: "artist_store",
      sourceUrl: sourceA,
      expiresAt,
    }]);
    await persistMerchEvidence(testArtist, sourceB, [{
      artistMbid: testArtist,
      title: "Bandcamp record",
      destinationUrl: "https://artist.bandcamp.com/album/record",
      source: "bandcamp",
      sourceUrl: sourceB,
      expiresAt,
    }]);
    await persistMerchEvidence(testArtist, sourceA, []);
    const rows = await db
      .select({
        sourceUrl: artistMerchProductsTable.sourceUrl,
        status: artistMerchProductsTable.status,
      })
      .from(artistMerchProductsTable)
      .where(eq(artistMerchProductsTable.artistMbid, testArtist));
    expect(rows).toEqual(expect.arrayContaining([
      { sourceUrl: sourceA, status: "removed" },
      { sourceUrl: sourceB, status: "active" },
    ]));
  });
});