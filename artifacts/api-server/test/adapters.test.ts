import { describe, it, expect } from "vitest";
import {
  pickPath,
  parseStationPage,
  parseKexpPlays,
  parseSpinitronSpins,
  parseSpinitronPlaylists,
  parseBbcSegments,
} from "../src/lore/adapters.js";

describe("pickPath", () => {
  it("reads nested object + array dot-paths", () => {
    const obj = { now: { song: { artist: "A", title: "B" } }, list: [{ x: 1 }] };
    expect(pickPath(obj, "now.song.artist")).toBe("A");
    expect(pickPath(obj, "list.0.x")).toBe(1);
  });

  it("returns undefined for missing / invalid paths", () => {
    expect(pickPath({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(pickPath(null, "a")).toBeUndefined();
    expect(pickPath({ a: [1] }, "a.5")).toBeUndefined();
  });
});

describe("parseStationPage", () => {
  const config = {
    artistPath: "now.artist",
    titlePath: "now.title",
    albumPath: "now.album",
    artworkPath: "now.art",
  };

  it("maps a published now-playing body via config paths", () => {
    const body = {
      now: { artist: "Khruangbin", title: "Maria También", album: "Con Todo", art: "http://x/y.jpg" },
    };
    expect(parseStationPage(body, config)).toEqual({
      rawArtist: "Khruangbin",
      rawTitle: "Maria También",
      album: "Con Todo",
      artworkUrl: "http://x/y.jpg",
    });
  });

  it("returns null when artist or title is missing", () => {
    expect(parseStationPage({ now: { artist: "A" } }, config)).toBeNull();
    expect(parseStationPage({}, config)).toBeNull();
  });

  it("returns null when config lacks required paths", () => {
    expect(parseStationPage({ now: { artist: "A", title: "B" } }, {})).toBeNull();
  });
});

describe("parseKexpPlays", () => {
  it("keeps trackplays, carries recording_id, drops airbreaks", () => {
    const body = {
      results: [
        {
          id: 42,
          play_type: "trackplay",
          artist: "Sharon Van Etten",
          song: "Seventeen",
          album: "Remind Me Tomorrow",
          airdate: "2026-07-01T12:00:00Z",
          recording_id: "mbid-rec-1",
          image_uri: "http://img/1.jpg",
          show: 7,
        },
        { id: 43, play_type: "airbreak" },
      ],
    };
    const showMap = new Map([[7, { name: "Morning Show", djName: "John R." }]]);
    const spins = parseKexpPlays(body, showMap);
    expect(spins).toHaveLength(1);
    expect(spins[0]).toMatchObject({
      rawArtist: "Sharon Van Etten",
      rawTitle: "Seventeen",
      externalId: "kexp:42",
      recordingId: "mbid-rec-1",
      album: "Remind Me Tomorrow",
      artworkUrl: "http://img/1.jpg",
      show: { name: "Morning Show", djName: "John R." },
    });
    expect(spins[0]!.playedAt?.toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });

  it("omits show attribution when the show id is not in the map", () => {
    const body = {
      results: [{ id: 1, artist: "A", song: "B", show: 99 }],
    };
    const spins = parseKexpPlays(body);
    expect(spins[0]!.show).toBeUndefined();
  });
});

describe("parseSpinitronSpins", () => {
  it("maps spins with duration + attribution from the playlist map", () => {
    const body = {
      items: [
        {
          id: 555,
          artist: "Yo La Tengo",
          song: "Autumn Sweater",
          release: "I Can Hear the Heart",
          start: "2026-07-01T09:30:00Z",
          duration: 372,
          image: "http://img/s.jpg",
          isrc: "USABC1234567",
          playlist_id: 3,
        },
      ],
    };
    const playlistMap = new Map([[3, { name: "Freeform", djName: "DJ Pat" }]]);
    const spins = parseSpinitronSpins(body, playlistMap);
    expect(spins[0]).toMatchObject({
      rawArtist: "Yo La Tengo",
      rawTitle: "Autumn Sweater",
      externalId: "spinitron:555",
      album: "I Can Hear the Heart",
      isrc: "USABC1234567",
      durationMs: 372_000,
      show: { name: "Freeform", djName: "DJ Pat" },
    });
  });

  it("skips items missing artist or title", () => {
    const body = { items: [{ id: 1, artist: "A" }, { id: 2, song: "B" }] };
    expect(parseSpinitronSpins(body)).toHaveLength(0);
  });
});

describe("parseSpinitronPlaylists", () => {
  it("builds an id -> {show, dj} map, reading persona name as DJ", () => {
    const body = {
      items: [
        { id: 3, title: "Freeform", persona: { name: "DJ Pat" } },
        { id: 4, title: "Jazz Hours", dj: "Sam" },
        { id: 5 },
      ],
    };
    const map = parseSpinitronPlaylists(body);
    expect(map.get(3)).toEqual({ name: "Freeform", djName: "DJ Pat" });
    expect(map.get(4)).toEqual({ name: "Jazz Hours", djName: "Sam" });
    expect(map.has(5)).toBe(false);
  });
});

describe("parseBbcSegments", () => {
  it("keeps music segments (primary=artist, secondary=title) and dedups by id", () => {
    const body = {
      data: [
        {
          id: "seg-1",
          segment_type: "music",
          titles: { primary: "Little Simz", secondary: "Introvert" },
        },
        { id: "seg-2", segment_type: "speech", titles: { primary: "Host" } },
      ],
    };
    const spins = parseBbcSegments(body);
    expect(spins).toHaveLength(1);
    expect(spins[0]).toEqual({
      rawArtist: "Little Simz",
      rawTitle: "Introvert",
      externalId: "bbc:seg-1",
    });
  });
});
