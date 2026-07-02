import { describe, it, expect } from "vitest";
import {
  parseLabelReleaseRecordings,
  parseDiscogsList,
} from "@workspace/song-enrichment";
import { parseFeedItems, extractArtistTrack } from "../src/lore/blog.js";
import { slugify } from "../src/lore/picks.js";

/**
 * Pure-unit tests for the source-agnostic pickers/picks parsers. These are the
 * only source-specific code in the generalization, so their edge cases (messy
 * feeds, dedup, editorial headline shapes, conservative skips) are where the
 * bugs hide. No DB, no network.
 */

describe("slugify", () => {
  it("lowercases, strips accents, and hyphenates", () => {
    expect(slugify("Sacred Bones Records")).toBe("sacred-bones-records");
    expect(slugify("RVNG Intl.")).toBe("rvng-intl");
    expect(slugify("Café Tacvba")).toBe("cafe-tacvba");
  });
});

describe("parseLabelReleaseRecordings", () => {
  it("flattens releases -> recordings with canonical ids + artist credit", () => {
    const body = {
      releases: [
        {
          id: "rel-1",
          title: "First LP",
          date: "1999-05-01",
          media: [
            {
              tracks: [
                {
                  recording: {
                    id: "rec-a",
                    title: "Opener",
                    "artist-credit": [
                      { name: "The Band", artist: { id: "art-1", name: "The Band" } },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const out = parseLabelReleaseRecordings(body);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      recordingId: "rec-a",
      title: "Opener",
      artist: "The Band",
      artistMbid: "art-1",
      releaseId: "rel-1",
      releaseTitle: "First LP",
      year: 1999,
    });
  });

  it("de-dupes a recording pressed on multiple releases (earliest wins)", () => {
    const body = {
      releases: [
        {
          id: "rel-reissue",
          title: "Reissue",
          date: "2010-01-01",
          media: [{ tracks: [{ recording: { id: "rec-x", title: "Song" } }] }],
        },
        {
          id: "rel-orig",
          title: "Original",
          date: "1990-01-01",
          media: [{ tracks: [{ recording: { id: "rec-x", title: "Song" } }] }],
        },
      ],
    };
    const out = parseLabelReleaseRecordings(body);
    expect(out).toHaveLength(1);
    expect(out[0]!.releaseId).toBe("rel-orig"); // earliest pressing
    expect(out[0]!.year).toBe(1990);
  });

  it("skips tracks with no recording id or title, and honors the cap", () => {
    const body = {
      releases: [
        {
          id: "rel-1",
          media: [
            {
              tracks: [
                { recording: { id: "", title: "no id" } },
                { recording: { id: "rec-1", title: "" } },
                { recording: { id: "rec-2", title: "Keep" } },
              ],
            },
          ],
        },
      ],
    };
    expect(parseLabelReleaseRecordings(body)).toHaveLength(1);
    const many = {
      releases: [
        {
          id: "rel",
          media: [
            {
              tracks: Array.from({ length: 10 }, (_, i) => ({
                recording: { id: `r${i}`, title: `T${i}` },
              })),
            },
          ],
        },
      ],
    };
    expect(parseLabelReleaseRecordings(many, 3)).toHaveLength(3);
  });

  it("returns [] on junk input", () => {
    expect(parseLabelReleaseRecordings(null)).toEqual([]);
    expect(parseLabelReleaseRecordings({})).toEqual([]);
  });
});

describe("parseDiscogsList", () => {
  it("extracts id + display title + url, skipping incomplete items", () => {
    const body = {
      name: "My Crate",
      items: [
        { id: 111, display_title: "Artist - Album", uri: "/r/111", comment: "fave" },
        { id: 222, display_title: "" },
        { display_title: "no id" },
      ],
    };
    const list = parseDiscogsList(body);
    expect(list.name).toBe("My Crate");
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: "111",
      displayTitle: "Artist - Album",
      url: "/r/111",
      comment: "fave",
    });
  });
});

describe("parseFeedItems", () => {
  it("parses RSS items (title, link, guid, pubDate, categories)", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>Big Blog Premiere</title>
        <link>https://blog.example/post-1</link>
        <guid>guid-1</guid>
        <pubDate>Wed, 01 Jan 2020 00:00:00 GMT</pubDate>
        <category>Post-Punk</category>
        <category>New Music</category>
      </item>
    </channel></rss>`;
    const items = parseFeedItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Big Blog Premiere");
    expect(items[0]!.link).toBe("https://blog.example/post-1");
    expect(items[0]!.guid).toBe("guid-1");
    expect(items[0]!.tags).toContain("Post-Punk");
    expect(items[0]!.publishedAt?.getUTCFullYear()).toBe(2020);
  });

  it("parses Atom entries (href link, id, CDATA title)", () => {
    const xml = `<feed>
      <entry>
        <title><![CDATA[Cool Track]]></title>
        <link href="https://blog.example/atom-1" rel="alternate"/>
        <id>atom-id-1</id>
        <updated>2021-06-15T00:00:00Z</updated>
      </entry>
    </feed>`;
    const items = parseFeedItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Cool Track");
    expect(items[0]!.link).toBe("https://blog.example/atom-1");
    expect(items[0]!.guid).toBe("atom-id-1");
  });

  it("falls back to link as guid and skips items missing title/link", () => {
    const xml = `<rss><channel>
      <item><title>Has no link</title></item>
      <item><title>Good</title><link>https://blog.example/g</link></item>
    </channel></rss>`;
    const items = parseFeedItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.guid).toBe("https://blog.example/g");
  });
});

describe("extractArtistTrack", () => {
  it("splits Artist – Track on dash family", () => {
    expect(extractArtistTrack("Godspeed You! Black Emperor – Storm")).toEqual({
      artist: "Godspeed You! Black Emperor",
      title: "Storm",
    });
    expect(extractArtistTrack("Boards of Canada - Roygbiv")).toEqual({
      artist: "Boards of Canada",
      title: "Roygbiv",
    });
  });

  it("strips editorial prefixes and trailing annotations", () => {
    expect(extractArtistTrack("Premiere: Slowdive – Alison (Official Video)")).toEqual(
      { artist: "Slowdive", title: "Alison" },
    );
    expect(extractArtistTrack('Listen: Low — "Days of Innocence"')).toEqual({
      artist: "Low",
      title: "Days of Innocence",
    });
  });

  it("handles Artist \"Track\" with no dash", () => {
    expect(extractArtistTrack('Bjork "Hyperballad"')).toEqual({
      artist: "Bjork",
      title: "Hyperballad",
    });
  });

  it("uses an artist tag + a quoted track when the title has no split", () => {
    expect(
      extractArtistTrack('Our review of the new single "Teardrop"', ["Massive Attack"]),
    ).toEqual({ artist: "Massive Attack", title: "Teardrop" });
  });

  it("returns null (skip, never guess) when there is no confident match", () => {
    expect(extractArtistTrack("Our favorite albums of the year")).toBeNull();
    expect(extractArtistTrack("")).toBeNull();
    expect(extractArtistTrack("Premiere:")).toBeNull();
  });
});
