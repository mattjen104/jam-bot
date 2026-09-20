import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_SAMPLE_SLUG,
  compatibilitySampleCollection,
  enrichVerifiedSpotifyEntries,
  fromJspf,
  toJspf,
  validateCollectionInput,
} from "../src/lore/collection.js";
import { readLoreJspf } from "../../../tools/byom-jspf-reader/reader.mjs";

describe("lore.collection.v1 JSPF", () => {
  it("keeps the public compatibility sample ordered, complete, and listener-private-data-free", () => {
    expect(compatibilitySampleCollection.slug).toBe(COMPATIBILITY_SAMPLE_SLUG);
    expect(compatibilitySampleCollection.entries.map((entry) => entry.identity)).toEqual([
      "mbid",
      "isrc",
      "text",
      "unavailable",
    ]);

    const outside = readLoreJspf(toJspf(compatibilitySampleCollection));
    expect(outside.entries.map((entry) => entry.position)).toEqual([1, 2, 3, 4]);
    expect(outside.entries.map((entry) => entry.status)).toEqual([
      "resolved",
      "resolved",
      "unresolved",
      "unresolved",
    ]);
    expect(JSON.stringify(compatibilitySampleCollection)).not.toMatch(
      /owner|listener|userId|device|session|cookie|token|private/i,
    );
  });

  it("is consumed losslessly by the independent BYOM reader", () => {
    const jspf = toJspf({
      schema: "lore.collection.v1",
      kind: "playlist",
      slug: "outside-lore",
      title: "Outside Lore",
      description: "An interoperability proof",
      curatorNotes: null,
      coverArt: null,
      provenance: { authority: "lore", public: true },
      entries: [
        { identity: "mbid", mbid: "01234567-89ab-4cde-8123-456789abcdef", title: "Resolved first", artist: "A" },
        { identity: "text", title: "Unresolved middle", artist: "As broadcast" },
        { identity: "isrc", isrc: "USAAA1234567", title: "Resolved third", artist: "B" },
        { identity: "unavailable", title: "Intentional gap", unavailableReason: "No stable identity" },
      ],
    });

    const outside = readLoreJspf(jspf);

    expect(outside.entries.map((entry) => entry.title)).toEqual([
      "Resolved first",
      "Unresolved middle",
      "Resolved third",
      "Intentional gap",
    ]);
    expect(outside.entries.map((entry) => entry.position)).toEqual([1, 2, 3, 4]);
    expect(outside.entries.map((entry) => entry.status)).toEqual([
      "resolved",
      "unresolved",
      "resolved",
      "unresolved",
    ]);
    expect(outside.entries[3]?.unavailableReason).toBe("No stable identity");
  });

  it("round trips ordered identities, provenance, notes, and verified provider album handoffs", () => {
    const checked = validateCollectionInput({
      kind: "album", slug: "a-lossless-set", title: "A set", description: "desc",
      curatorNotes: "published note", entries: [
        {
          identity: "mbid", mbid: "01234567-89ab-4cde-8123-456789abcdef", title: "One", artist: "A",
          provenance: { source: "mb", confidence: "confirmed" }, spotifyTrackId: "0123456789012345678901",
          spotifyAlbumId: "0123456789012345678901",
          providerAlbumLinks: {
            spotify: "https://open.spotify.com/album/0123456789012345678901",
            appleMusic: "https://music.apple.com/us/album/rumours/594061854",
            qobuz: "https://www.qobuz.com/us-en/album/rumours-fleetwood-mac/0123456789012",
            bandcamp: "https://fleetwoodmac.bandcamp.com/album/rumours",
          },
        },
        { identity: "isrc", isrc: "USAAA1234567", title: "Two", artist: "B" },
        { identity: "text", title: "Three", artist: "C" },
        { identity: "unavailable", unavailableReason: "rights gap" },
      ],
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const original = { schema: "lore.collection.v1" as const, ...checked.value, provenance: { authority: "lore" as const, public: true as const } };
    const roundTrip = fromJspf(toJspf(original));
    expect(roundTrip.entries.map((e) => e.identity)).toEqual(["mbid", "isrc", "text", "unavailable"]);
    expect(roundTrip.entries[0]?.mbid).toBe(original.entries[0]?.mbid);
    expect(roundTrip.entries[3]?.unavailableReason).toBe("rights gap");
    expect(roundTrip.curatorNotes).toBe(original.curatorNotes);
    expect(toJspf(original).playlist.meta?.["lore:spotify-album"]).toContain("/album/");
    expect(toJspf(original).playlist.meta?.["lore:album-apple-music"]).toContain("music.apple.com");
    expect(toJspf(original).playlist.meta?.["lore:album-qobuz"]).toContain("qobuz.com");
    expect(toJspf(original).playlist.meta?.["lore:album-bandcamp"]).toContain("bandcamp.com");
    expect(roundTrip.entries[0]?.spotifyAlbumId).toBe("0123456789012345678901");
    expect(roundTrip.entries[0]?.providerAlbumLinks).toEqual(original.entries[0]?.providerAlbumLinks);
    expect(JSON.stringify(toJspf(original))).not.toMatch(/token|private/i);
  });

  it("drops unverified provider album metadata instead of importing it", () => {
    const roundTrip = fromJspf({
      playlist: {
        title: "Untrusted",
        meta: {
          "lore:album-spotify": "https://evil.example/album/123",
          "lore:album-apple-music": "http://music.apple.com/us/album/x/1",
          "lore:album-qobuz": "https://qobuz.com/album/x",
          "lore:album-bandcamp": "https://not-bandcamp.example/album/x",
          "lore:spotify-album": "https://open.spotify.com/album/0123456789012345678901",
        },
        track: [{ title: "Track", creator: "Artist" }],
      },
    });
    expect(roundTrip.entries[0]?.spotifyAlbumId).toBe("0123456789012345678901");
    expect(roundTrip.entries[0]?.providerAlbumLinks).toEqual({
      spotify: "https://open.spotify.com/album/0123456789012345678901",
    });
  });

  it("rejects spoofed links, identity mismatches, and oversized collections", () => {
    expect(validateCollectionInput({ kind: "playlist", slug: "ok-set", title: "x", entries: [{ identity: "isrc", isrc: "USAAA1234567", spotifyTrackId: "not-real", spotifyTrackUrl: "https://evil.example/track/not-real" }] }).ok).toBe(false);
    expect(validateCollectionInput({ kind: "playlist", slug: "ok-set", title: "x", entries: [{ identity: "mbid", mbid: "not-an-mbid" }] }).ok).toBe(false);
    expect(validateCollectionInput({ kind: "playlist", slug: "ok-set", title: "x", entries: Array.from({ length: 501 }, () => ({ identity: "text", title: "x", artist: "y" })) }).ok).toBe(false);
    expect(validateCollectionInput({ kind: "album", slug: "ok-set", title: "x", entries: [{ identity: "text", title: "x", artist: "y", providerAlbumLinks: { qobuz: "https://evil.example/album/x" } }] }).ok).toBe(false);
    expect(validateCollectionInput({ kind: "album", slug: "ok-set", title: "x", entries: [{ identity: "text", title: "x", artist: "y", providerAlbumLinks: { appleMusic: "https://music.apple.com/us/album/rumours/594061854" }, providerAvailability: { bandcamp: "unavailable" } }] }).ok).toBe(true);
  });

  it("enriches Spotify tracks only from exact verified durable mappings", () => {
    const entry = { identity: "mbid" as const, mbid: "01234567-89ab-4cde-8123-456789abcdef", title: "x" };
    const supplied = { ...entry, spotifyTrackId: "0123456789012345678901", spotifyTrackUrl: "https://evil.example/x" };
    expect(enrichVerifiedSpotifyEntries([supplied], [{
      recordingMbid: entry.mbid, service: "spotify", externalId: "0123456789012345678902",
      url: "https://open.spotify.com/track/0123456789012345678902", confidence: "exact", verification: "verified", deadLink: false,
    }])[0]).toMatchObject({ spotifyTrackId: "0123456789012345678902" });
    expect(enrichVerifiedSpotifyEntries([supplied], [{
      recordingMbid: entry.mbid, service: "spotify", externalId: "0123456789012345678902",
      url: "https://open.spotify.com/track/0123456789012345678902", confidence: "search", verification: "verified", deadLink: false,
    }])[0]).not.toHaveProperty("spotifyTrackId");
  });
});