import { describe, it, expect } from "vitest";
import {
  streamOrigin,
  mountPath,
  parseIcecastStatus,
  parseAzuraStations,
  extractAzuraNowPlaying,
  matchAzuraShortcode,
} from "../src/lore/host-multiplex.js";

describe("streamOrigin / mountPath", () => {
  it("extracts origin including explicit port", () => {
    expect(streamOrigin("http://radio.example.com:8000/stream")).toBe(
      "http://radio.example.com:8000",
    );
    expect(streamOrigin("https://radio.example.com/live.mp3")).toBe(
      "https://radio.example.com",
    );
  });

  it("rejects non-http(s) and unparseable URLs", () => {
    expect(streamOrigin("ftp://x/y")).toBeNull();
    expect(streamOrigin("not a url")).toBeNull();
  });

  it("mountPath returns pathname, '/' for bare hosts", () => {
    expect(mountPath("http://x:8000/stream")).toBe("/stream");
    expect(mountPath("http://x:8000")).toBe("/");
    expect(mountPath("::bad::")).toBeNull();
  });
});

describe("parseIcecastStatus", () => {
  it("handles source as an array with artist+title and title-only mounts", () => {
    const body = {
      icestats: {
        source: [
          {
            listenurl: "http://radio.example.com:8000/a",
            artist: "Air",
            title: "Photograph",
          },
          { listenurl: "http://radio.example.com:8000/b", title: "Blondie - Heart Of Glass" },
          { listenurl: "http://radio.example.com:8000/silent" },
        ],
      },
    };
    const mounts = parseIcecastStatus(body);
    expect(mounts).toEqual([
      { path: "/a", streamTitle: "Air - Photograph" },
      { path: "/b", streamTitle: "Blondie - Heart Of Glass" },
      { path: "/silent", streamTitle: null },
    ]);
  });

  it("handles source as a single object", () => {
    const body = {
      icestats: {
        source: { listenurl: "http://h/stream", title: "X - Y" },
      },
    };
    expect(parseIcecastStatus(body)).toEqual([
      { path: "/stream", streamTitle: "X - Y" },
    ]);
  });

  it("returns [] for missing icestats/source or junk bodies", () => {
    expect(parseIcecastStatus(null)).toEqual([]);
    expect(parseIcecastStatus({})).toEqual([]);
    expect(parseIcecastStatus({ icestats: {} })).toEqual([]);
    expect(parseIcecastStatus({ icestats: { source: 42 } })).toEqual([]);
  });
});

describe("parseAzuraStations", () => {
  it("collects shortcode, listen_url, and mount urls", () => {
    const body = [
      {
        station: {
          shortcode: "main",
          listen_url: "https://az.example.com/listen/main/radio.mp3",
          mounts: [
            { url: "https://az.example.com/listen/main/radio.mp3" },
            { url: "https://az.example.com/listen/main/lofi.mp3" },
          ],
        },
      },
      { station: { shortcode: "second", listen_url: "https://az.example.com/listen/second/radio.mp3" } },
      { station: {} }, // no shortcode → skipped
    ];
    const parsed = parseAzuraStations(body);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      shortcode: "main",
      urls: [
        "https://az.example.com/listen/main/radio.mp3",
        "https://az.example.com/listen/main/radio.mp3",
        "https://az.example.com/listen/main/lofi.mp3",
      ],
    });
  });

  it("returns [] for non-array bodies (not an AzuraCast host)", () => {
    expect(parseAzuraStations({ icestats: {} })).toEqual([]);
    expect(parseAzuraStations("nope")).toEqual([]);
  });
});

describe("extractAzuraNowPlaying", () => {
  it("prefers structured artist/title fields", () => {
    const np = {
      station: { shortcode: "main" },
      now_playing: { song: { artist: "Air", title: "Photograph", text: "ignored" } },
    };
    expect(extractAzuraNowPlaying(np)).toEqual({
      shortcode: "main",
      rawArtist: "Air",
      rawTitle: "Photograph",
    });
  });

  it("falls back to the combined text field", () => {
    const np = {
      station: { shortcode: "main" },
      now_playing: { song: { text: "Blondie - Heart Of Glass" } },
    };
    expect(extractAzuraNowPlaying(np)).toEqual({
      shortcode: "main",
      rawArtist: "Blondie",
      rawTitle: "Heart Of Glass",
    });
  });

  it("returns null when there is no usable song info", () => {
    expect(extractAzuraNowPlaying(null)).toBeNull();
    expect(extractAzuraNowPlaying({ station: { shortcode: "x" } })).toBeNull();
    expect(
      extractAzuraNowPlaying({ station: { shortcode: "x" }, now_playing: { song: {} } }),
    ).toBeNull();
  });
});

describe("matchAzuraShortcode", () => {
  const az = [
    { shortcode: "main", urls: ["https://az.example.com/listen/main/radio.mp3"] },
    { shortcode: "second", urls: ["https://az.example.com/listen/second/radio.mp3"] },
  ];

  it("matches by mount path even across host aliases", () => {
    expect(
      matchAzuraShortcode("https://cdn.az.example.com/listen/second/radio.mp3", az),
    ).toBe("second");
  });

  it("returns null when no mount path matches", () => {
    expect(matchAzuraShortcode("https://az.example.com/listen/other/radio.mp3", az)).toBeNull();
  });
});
