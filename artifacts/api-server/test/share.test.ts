import { describe, it, expect } from "vitest";
import { parseSomaFmSongs, parseKcrwTrack } from "../src/lore/adapters.js";
import {
  escapeHtml,
  renderShareHtml,
  loreBasePath,
  isPrivateIp,
  isSafeArtworkUrl,
  _odesliQueryForRecording,
  type SharePayload,
} from "../src/lore/share.js";

describe("parseSomaFmSongs", () => {
  const body = {
    songs: [
      {
        title: "Silence",
        artist: "Delerium",
        album: "Karma",
        albumArt: "https://somafm.com/img/karma.jpg",
        date: "1751470000",
      },
      { title: "Break / Station ID", artist: "SomaFM", date: "1751469900" },
      { title: "No Date Song", artist: "Boards of Canada" },
      { title: "", artist: "Ghost" },
    ],
  };

  it("maps songs newest-first with stable channel+epoch external ids", () => {
    const spins = parseSomaFmSongs(body, "groovesalad");
    expect(spins).toHaveLength(2);
    expect(spins[0]).toMatchObject({
      rawArtist: "Delerium",
      rawTitle: "Silence",
      album: "Karma",
      artworkUrl: "https://somafm.com/img/karma.jpg",
      externalId: "somafm:groovesalad:1751470000",
    });
    expect(spins[0]!.playedAt).toEqual(new Date(1751470000 * 1000));
  });

  it("drops SomaFM station-ID breaks and empty titles", () => {
    const spins = parseSomaFmSongs(body, "groovesalad");
    expect(spins.some((s) => /somafm/i.test(s.rawArtist))).toBe(false);
    expect(spins.some((s) => s.rawTitle === "")).toBe(false);
  });

  it("keeps songs without a date (no externalId, no playedAt)", () => {
    const spins = parseSomaFmSongs(body, "groovesalad");
    const noDate = spins.find((s) => s.rawArtist === "Boards of Canada");
    expect(noDate).toBeDefined();
    expect(noDate!.externalId).toBeUndefined();
    expect(noDate!.playedAt).toBeUndefined();
  });

  it("returns [] for malformed bodies", () => {
    expect(parseSomaFmSongs(null, "x")).toEqual([]);
    expect(parseSomaFmSongs({}, "x")).toEqual([]);
    expect(parseSomaFmSongs({ songs: "nope" }, "x")).toEqual([]);
  });
});

describe("parseKcrwTrack", () => {
  it("maps the current track with play_id external id and show attribution", () => {
    const body = {
      play_id: 987654,
      artist: "Sault",
      title: "Wildfires",
      album: "Untitled (Black Is)",
      albumImage: "https://kcrw.com/small.jpg",
      albumImageLarge: "https://kcrw.com/large.jpg",
      datetime: "2026-07-02T16:20:00Z",
      program_title: "Eclectic 24",
      host: "KCRW DJs",
    };
    const spins = parseKcrwTrack(body, "Music");
    expect(spins).toHaveLength(1);
    expect(spins[0]).toMatchObject({
      rawArtist: "Sault",
      rawTitle: "Wildfires",
      album: "Untitled (Black Is)",
      artworkUrl: "https://kcrw.com/large.jpg",
      externalId: "kcrw:Music:987654",
      show: { name: "Eclectic 24", djName: "KCRW DJs" },
    });
    expect(spins[0]!.playedAt).toEqual(new Date("2026-07-02T16:20:00Z"));
  });

  it("returns [] during talk programming (no artist/title)", () => {
    expect(parseKcrwTrack({ program_title: "News" }, "Simulcast")).toEqual([]);
    expect(parseKcrwTrack({ artist: "X", title: null }, "Music")).toEqual([]);
    expect(parseKcrwTrack(null, "Music")).toEqual([]);
  });

  it("omits show when program metadata is absent", () => {
    const spins = parseKcrwTrack({ artist: "A", title: "B" }, "Music");
    expect(spins[0]!.show).toBeUndefined();
    expect(spins[0]!.externalId).toBeUndefined();
  });
});

describe("share HTML", () => {
  const payload: SharePayload = {
    title: `Enemy — Jesca Hoop · Lore`,
    description: 'A song with "quotes" & <angles>',
    redirectPath: "/lore/song/abc-123",
    card: {
      kicker: "One song",
      title: "Enemy",
      subtitle: "Jesca Hoop",
      footer: "lore",
    },
  };

  it("escapes HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("renders absolute og:url/og:image and an instant SPA redirect", () => {
    const html = renderShareHtml(
      payload,
      "https://lore.example",
      "/api/share/songs/abc-123",
      "/api/share/songs/abc-123/card.png",
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://lore.example/api/share/songs/abc-123">',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://lore.example/api/share/songs/abc-123/card.png">',
    );
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
    expect(html).toContain(
      'A song with &quot;quotes&quot; &amp; &lt;angles&gt;',
    );
    expect(html).toContain('http-equiv="refresh" content="0;url=/lore/song/abc-123"');
    expect(html).toContain('location.replace("/lore/song/abc-123")');
  });

  it("derives the SPA base path from env with default /lore", () => {
    expect(loreBasePath()).toBe("/lore");
  });
});

describe("_odesliQueryForRecording (Odesli lookup vector selection)", () => {
  it("prefers ISRC when present", () => {
    const q = _odesliQueryForRecording("US-S1Z-99-00001", [], "Artist", "Title");
    expect(q).toBe("isrc=US-S1Z-99-00001");
  });

  it("URL-encodes ISRC with special characters", () => {
    const q = _odesliQueryForRecording("GBAYE0601498", [], "The Beatles", "Hey Jude");
    expect(q).toBe("isrc=GBAYE0601498");
  });

  it("falls back to Spotify track ID extracted from existing links when ISRC is absent", () => {
    const links = [
      { name: "Spotify", url: "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh", kind: "exact" as const },
    ];
    const q = _odesliQueryForRecording(null, links, "Artist", "Title");
    expect(q).toBe("url=spotify%3Atrack%3A4iV5W9uYEdYUVa79Axb7Rh");
  });

  it("ignores Spotify search URLs (not exact track URLs) when extracting track ID", () => {
    const links = [
      { name: "Spotify", url: "https://open.spotify.com/search/Artist%20Title", kind: "search" as const },
    ];
    const q = _odesliQueryForRecording(null, links, "Madeleine Peyroux", "Dance Me to the End of Love");
    expect(q).toBe("q=Madeleine%20Peyroux%20Dance%20Me%20to%20the%20End%20of%20Love");
  });

  it("uses artist+title free-text query when ISRC and Spotify track URL are both absent", () => {
    const q = _odesliQueryForRecording(null, [], "Khruangbin", "White Gloves");
    expect(q).toBe("q=Khruangbin%20White%20Gloves");
  });

  it("uses artist+title even when ISRC is an empty string", () => {
    const q = _odesliQueryForRecording("  ", [], "FIP Station Artist", "Ambient Track");
    expect(q).toBe("q=FIP%20Station%20Artist%20Ambient%20Track");
  });

  it("returns null when no lookup vector is available", () => {
    expect(_odesliQueryForRecording(null, [], "", "")).toBeNull();
    expect(_odesliQueryForRecording("", [], "  ", "  ")).toBeNull();
    expect(_odesliQueryForRecording(null, [], "", "Title Only")).toBeNull();
  });

  it("ISRC takes priority over a Spotify link already in the stored links", () => {
    const links = [
      { name: "Spotify", url: "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh", kind: "exact" as const },
    ];
    const q = _odesliQueryForRecording("GBAYE0601498", links, "Artist", "Title");
    expect(q).toBe("isrc=GBAYE0601498");
  });
});

describe("artwork SSRF guard", () => {
  it("flags private, loopback, link-local, CGNAT, and multicast IPs", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.9.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fd12::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:192.168.0.1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPs", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "172.32.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("rejects non-https schemes, credentials, and local hostnames", async () => {
    for (const url of [
      "http://example.com/a.jpg",
      "file:///etc/passwd",
      "ftp://example.com/a.jpg",
      "https://user:pass@example.com/a.jpg",
      "https://localhost/a.jpg",
      "https://foo.localhost/a.jpg",
      "https://printer.local/a.jpg",
      "https://db.internal/a.jpg",
      "not a url",
    ]) {
      expect(await isSafeArtworkUrl(url), url).toBe(false);
    }
  });

  it("rejects https URLs pointing at private IP literals", async () => {
    for (const url of [
      "https://127.0.0.1/a.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://10.1.2.3/a.jpg",
      "https://[::1]/a.jpg",
      "https://[fe80::1]/a.jpg",
    ]) {
      expect(await isSafeArtworkUrl(url), url).toBe(false);
    }
  });

  it("allows https URLs to public IP literals", async () => {
    expect(await isSafeArtworkUrl("https://93.184.216.34/a.jpg")).toBe(true);
  });
});
