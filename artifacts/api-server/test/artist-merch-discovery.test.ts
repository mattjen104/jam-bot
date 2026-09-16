import { describe, expect, it } from "vitest";
import {
  automaticMerchSourceForUrl,
  parseAutomaticMerchSources,
} from "../src/lore/artist-merch-discovery.js";

describe("automatic artist merch source discovery", () => {
  it("accepts explicit Bandcamp and myshopify artist relationships", () => {
    expect(automaticMerchSourceForUrl("https://artist.bandcamp.com/merch")).toEqual({
      sourceUrl: "https://artist.bandcamp.com/merch",
      source: "bandcamp",
    });
    expect(
      automaticMerchSourceForUrl("https://diespitz.myshopify.com/?tracking=ignored"),
    ).toEqual({
      sourceUrl: "https://diespitz.myshopify.com/",
      source: "artist_store",
    });
  });

  it("never guesses or accepts unrelated commerce and social URLs", () => {
    expect(automaticMerchSourceForUrl("http://artist.bandcamp.com")).toBeNull();
    expect(automaticMerchSourceForUrl("https://myshopify.com/artist")).toBeNull();
    expect(automaticMerchSourceForUrl("https://shop.example.com/artist")).toBeNull();
    expect(automaticMerchSourceForUrl("https://instagram.com/artist")).toBeNull();
  });

  it("deduplicates normalized sources from MusicBrainz URL relations", () => {
    expect(parseAutomaticMerchSources({
      relations: [
        { type: "official homepage", url: { resource: "https://diespitz.myshopify.com/" } },
        { type: "purchase for mail-order", url: { resource: "https://diespitz.myshopify.com/?x=1" } },
        { type: "social network", url: { resource: "https://instagram.com/diespitz" } },
      ],
    })).toEqual([
      { sourceUrl: "https://diespitz.myshopify.com/", source: "artist_store" },
    ]);
  });
});