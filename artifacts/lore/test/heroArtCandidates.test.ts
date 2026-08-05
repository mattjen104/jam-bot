/**
 * Hero art pipeline — verified against a real library case (task: confirm the
 * fullscreen hero cover shows the right album).
 *
 * Real-world failure this guards: the avatar album "Spitting Off the Edge of
 * the World" (Yeah Yeah Yeahs, original single) has no exact match on iTunes;
 * the fuzzy text search returns the "(Lush Version) [feat. Perfume Genius] -
 * Single" — a different release with completely different artwork. The iTunes
 * tier must reject near-misses so the release-exact CAA tier (derived from the
 * mbid embedded in the library artwork URL) wins instead.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  heroArtCandidates,
  itunesTitleMatches,
  caaReleaseMbidFromUrl,
  highResArtUrl,
} from "../src/lib/artRes";

const LIB_ART =
  "https://ia802508.us.archive.org/8/items/mbid-e1e9506e-a1ae-41c8-87e4-8cdddba7c16d/mbid-e1e9506e-a1ae-41c8-87e4-8cdddba7c16d-32672425059_thumb500.jpg";

const ALBUM = {
  artist: "Yeah Yeah Yeahs",
  albumTitle: "Spitting Off the Edge of the World",
  releaseGroupMbid: null,
  artworkUrl: LIB_ART,
};

function itunesResponse(results: unknown[]) {
  return {
    ok: true,
    json: async () => ({ results }),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("itunesTitleMatches", () => {
  it("accepts an exact title and the '- Single'/'- EP' suffix", () => {
    expect(itunesTitleMatches("Cool It Down", "Cool It Down")).toBe(true);
    expect(itunesTitleMatches("Maps", "Maps - Single")).toBe(true);
    expect(itunesTitleMatches("IS IS", "IS IS - EP")).toBe(true);
  });

  it("rejects alternate versions, deluxe editions, and feat. qualifiers", () => {
    expect(
      itunesTitleMatches(
        "Spitting Off the Edge of the World",
        "Spitting Off the Edge of the World (Lush Version) [feat. Perfume Genius] - Single",
      ),
    ).toBe(false);
    expect(itunesTitleMatches("Mosquito", "Mosquito (Deluxe Edition)")).toBe(false);
  });

  it("ignores punctuation/case differences", () => {
    expect(itunesTitleMatches("Doin’ the Cockroach", "Doin' The Cockroach - Single")).toBe(true);
  });
});

describe("caaReleaseMbidFromUrl", () => {
  it("extracts the release mbid from an archive.org CAA mirror URL", () => {
    expect(caaReleaseMbidFromUrl(LIB_ART)).toBe(
      "e1e9506e-a1ae-41c8-87e4-8cdddba7c16d",
    );
  });

  it("returns null for non-CAA hosts and unparseable strings", () => {
    expect(
      caaReleaseMbidFromUrl("https://img.radioparadise.com/covers/l/29191.jpg"),
    ).toBeNull();
    expect(caaReleaseMbidFromUrl("/local/art.jpg")).toBeNull();
  });
});

describe("heroArtCandidates", () => {
  it("skips a wrong-album iTunes match and leads with the release-exact CAA URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        itunesResponse([
          {
            collectionName:
              "Spitting Off the Edge of the World (Lush Version) [feat. Perfume Genius] - Single",
            artistName: "Yeah Yeah Yeahs",
            artworkUrl100: "https://is1-ssl.mzstatic.com/wrong/100x100bb.jpg",
          },
        ]),
      ),
    );
    const urls = await heroArtCandidates(ALBUM);
    expect(urls[0]).toBe(
      "https://coverartarchive.org/release/e1e9506e-a1ae-41c8-87e4-8cdddba7c16d/front-1200",
    );
    expect(urls.some((u) => u.includes("mzstatic"))).toBe(false);
    // library URL (unknown host → not upgraded) remains the last fallback
    expect(urls[urls.length - 1]).toBe(LIB_ART);
  });

  it("uses a validated iTunes match at 1200x1200 as tier 1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        itunesResponse([
          {
            collectionName: "Cool It Down",
            artistName: "Yeah Yeah Yeahs",
            artworkUrl100: "https://is1-ssl.mzstatic.com/right/100x100bb.jpg",
          },
        ]),
      ),
    );
    const urls = await heroArtCandidates({ ...ALBUM, albumTitle: "Cool It Down" });
    expect(urls[0]).toBe("https://is1-ssl.mzstatic.com/right/1200x1200bb.jpg");
  });

  it("scans past a wrong-artist result to a correct later match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        itunesResponse([
          {
            collectionName: "Cool It Down",
            artistName: "Some Cover Band",
            artworkUrl100: "https://is1-ssl.mzstatic.com/cover-band/100x100bb.jpg",
          },
          {
            collectionName: "Cool It Down",
            artistName: "Yeah Yeah Yeahs",
            artworkUrl100: "https://is1-ssl.mzstatic.com/right/100x100bb.jpg",
          },
        ]),
      ),
    );
    const urls = await heroArtCandidates({ ...ALBUM, albumTitle: "Cool It Down" });
    expect(urls[0]).toBe("https://is1-ssl.mzstatic.com/right/1200x1200bb.jpg");
  });

  it("survives a blocked iTunes tier (network failure) with CAA + original fallbacks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const urls = await heroArtCandidates(ALBUM);
    expect(urls).toEqual([
      "https://coverartarchive.org/release/e1e9506e-a1ae-41c8-87e4-8cdddba7c16d/front-1200",
      LIB_ART,
    ]);
  });

  it("still includes the release-group CAA tier when provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => itunesResponse([])),
    );
    const urls = await heroArtCandidates({
      artist: "A",
      albumTitle: "B",
      releaseGroupMbid: "11111111-2222-3333-4444-555555555555",
      artworkUrl: "https://i.scdn.co/image/ab67616d00001e02abc",
    });
    expect(urls).toEqual([
      "https://coverartarchive.org/release-group/11111111-2222-3333-4444-555555555555/front-1200",
      highResArtUrl("https://i.scdn.co/image/ab67616d00001e02abc"),
      "https://i.scdn.co/image/ab67616d00001e02abc",
    ]);
  });
});
