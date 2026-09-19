import { describe, expect, it } from "vitest";
import { enrichVerifiedSpotifyEntries, fromJspf, toJspf, validateCollectionInput } from "../src/lore/collection.js";
import { readLoreJspf } from "../../../tools/byom-jspf-reader/reader.mjs";

describe("lore.collection.v1 JSPF", () => {
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

  it("round trips ordered identities, provenance, notes, and verified Spotify handoffs", () => {
    const checked = validateCollectionInput({
      kind: "album", slug: "a-lossless-set", title: "A set", description: "desc",
      curatorNotes: "published note", entries: [
        { identity: "mbid", mbid: "01234567-89ab-4cde-8123-456789abcdef", title: "One", artist: "A", provenance: { source: "mb", confidence: "confirmed" }, spotifyTrackId: "0123456789012345678901", spotifyAlbumId: "0123456789012345678901" },
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
    expect(JSON.stringify(toJspf(original))).not.toMatch(/token|private/i);
  });

  it("rejects spoofed links, identity mismatches, and oversized collections", () => {
    expect(validateCollectionInput({ kind: "playlist", slug: "ok-set", title: "x", entries: [{ identity: "isrc", isrc: "USAAA1234567", spotifyTrackId: "not-real", spotifyTrackUrl: "https://evil.example/track/not-real" }] }).ok).toBe(false);
    expect(validateCollectionInput({ kind: "playlist", slug: "ok-set", title: "x", entries: [{ identity: "mbid", mbid: "not-an-mbid" }] }).ok).toBe(false);
    expect(validateCollectionInput({ kind: "playlist", slug: "ok-set", title: "x", entries: Array.from({ length: 501 }, () => ({ identity: "text", title: "x", artist: "y" })) }).ok).toBe(false);
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