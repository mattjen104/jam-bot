import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  pickPath,
  parseStationPage,
  parseKexpPlays,
  parseSpinitronSpins,
  parseSpinitronPlaylists,
  parseBbcSegments,
  parseNtsLive,
  parseFipSteps,
  stationArchiveUrl,
  supportsBackfill,
  parseRadiojarNowPlaying,
  parseLotRadioSchedule,
  parseIcyNowPlaying,
  parseSpinitronWebPage,
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

  it("does not turn the current artist into a DJ when source metadata collides", () => {
    const spins = parseKexpPlays(
      { results: [{ id: 1, artist: "Björk", song: "Jóga", show: 7 }] },
      new Map([[7, { name: "Evening Radio", djName: "bjork!" }]]),
    );
    expect(spins[0]!.show).toEqual({ name: "Evening Radio" });
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

describe("show attribution guards", () => {
  it("keeps a one-word alias while removing title-shaped source attribution", () => {
    const alias = parseSpinitronSpins(
      { items: [{ id: 1, artist: "Sault", song: "Wildfires", playlist_id: 1 }] },
      new Map([[1, { name: "Night Shift", djName: "Wizzy" }]]),
    );
    expect(alias[0]!.show).toEqual({ name: "Night Shift", djName: "Wizzy" });

    const titleCollision = parseSpinitronSpins(
      { items: [{ id: 2, artist: "Sault", song: "Wildfires", playlist_id: 2 }] },
      new Map([[2, { name: "Night Shift", djName: "WILDFIRES" }]]),
    );
    expect(titleCollision[0]!.show).toEqual({ name: "Night Shift" });
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

  it("drops non-music segment types as returned by BBC 6 Music (speech, weather, etc.)", () => {
    const body = {
      data: [
        {
          id: "6m-1",
          segment_type: "music",
          titles: { primary: "Caribou", secondary: "Can't Do Without You" },
        },
        {
          id: "6m-2",
          segment_type: "speech",
          titles: { primary: "Lauren Laverne", secondary: "Morning show chat" },
        },
        {
          id: "6m-3",
          segment_type: "weather",
          titles: { primary: "Weather", secondary: "UK forecast" },
        },
        {
          id: "6m-4",
          segment_type: "music",
          titles: { primary: "Portishead", secondary: "Glory Box" },
        },
      ],
    };
    const spins = parseBbcSegments(body);
    expect(spins).toHaveLength(2);
    expect(spins[0]).toMatchObject({ rawArtist: "Caribou", rawTitle: "Can't Do Without You", externalId: "bbc:6m-1" });
    expect(spins[1]).toMatchObject({ rawArtist: "Portishead", rawTitle: "Glory Box", externalId: "bbc:6m-4" });
  });

  it("keeps segments with no segment_type when they carry artist+title (best-effort)", () => {
    const body = {
      data: [
        {
          id: "6m-noType",
          titles: { primary: "Massive Attack", secondary: "Teardrop" },
        },
      ],
    };
    const spins = parseBbcSegments(body);
    expect(spins).toHaveLength(1);
    expect(spins[0]).toMatchObject({ rawArtist: "Massive Attack", rawTitle: "Teardrop" });
  });

  it("returns empty array for an empty data payload", () => {
    expect(parseBbcSegments({ data: [] })).toHaveLength(0);
    expect(parseBbcSegments({})).toHaveLength(0);
  });

  it("drops music segments that are missing a title (silent/blank metadata)", () => {
    const body = {
      data: [
        { id: "s1", segment_type: "music", titles: { primary: "Artist Only" } },
        { id: "s2", segment_type: "music", titles: {} },
      ],
    };
    expect(parseBbcSegments(body)).toHaveLength(0);
  });
});

describe("parseFipSteps", () => {
  const BASE = 1_000_000; // arbitrary Unix epoch anchor for tests

  it("selects the deepest active step when multiple windows overlap", () => {
    const steps = {
      outer: { start: BASE - 60, end: BASE + 60, depth: 1, title: "Outer Show", authors: "Host" },
      inner: { start: BASE - 10, end: BASE + 10, depth: 3, title: "Boléro", authors: "Ravel" },
      mid:   { start: BASE - 30, end: BASE + 30, depth: 2, title: "Mid", authors: "Someone" },
    };
    const result = parseFipSteps(steps, BASE);
    expect(result).toEqual({ rawArtist: "Ravel", rawTitle: "Boléro" });
  });

  it("returns null when no step window contains nowSec (between tracks / silence)", () => {
    const steps = {
      past:   { start: BASE - 120, end: BASE - 10, depth: 1, title: "Past Track", authors: "A" },
      future: { start: BASE + 10,  end: BASE + 120, depth: 1, title: "Next Track", authors: "B" },
    };
    expect(parseFipSteps(steps, BASE)).toBeNull();
  });

  it("falls back to performers when authors is absent (talk programme handover)", () => {
    const steps = {
      s1: { start: BASE - 5, end: BASE + 5, depth: 1, title: "Gymnopedie No. 1", performers: "Erik Satie" },
    };
    expect(parseFipSteps(steps, BASE)).toEqual({
      rawArtist: "Erik Satie",
      rawTitle: "Gymnopedie No. 1",
    });
  });

  it("prefers authors over performers when both are present", () => {
    const steps = {
      s1: { start: BASE - 5, end: BASE + 5, depth: 1, title: "Track", authors: "Composer", performers: "Orchestra" },
    };
    const result = parseFipSteps(steps, BASE);
    expect(result?.rawArtist).toBe("Composer");
  });

  it("returns null for a talk/silence step that has no artist identity", () => {
    const steps = {
      s1: { start: BASE - 5, end: BASE + 5, depth: 1, title: "Talk segment" },
    };
    expect(parseFipSteps(steps, BASE)).toBeNull();
  });

  it("returns null for a step without a title even if an artist is present", () => {
    const steps = {
      s1: { start: BASE - 5, end: BASE + 5, depth: 1, authors: "Someone" },
    };
    expect(parseFipSteps(steps, BASE)).toBeNull();
  });

  it("returns null for an empty steps object", () => {
    expect(parseFipSteps({}, BASE)).toBeNull();
  });

  it("uses depth 0 as default when depth key is absent, still selects the window", () => {
    const steps = {
      s1: { start: BASE - 5, end: BASE + 5, title: "No Depth Track", authors: "Artist" },
    };
    expect(parseFipSteps(steps, BASE)).toEqual({ rawArtist: "Artist", rawTitle: "No Depth Track" });
  });

  it("selects the step whose window exactly straddles nowSec (boundary inclusive)", () => {
    const steps = {
      exact: { start: BASE, end: BASE, depth: 1, title: "Exact", authors: "A" },
    };
    expect(parseFipSteps(steps, BASE)).toEqual({ rawArtist: "A", rawTitle: "Exact" });
  });

  it("skips steps with non-numeric start or end values", () => {
    const steps = {
      bad:  { start: "now", end: "later", depth: 1, title: "Bad Step", authors: "A" },
      good: { start: BASE - 5, end: BASE + 5, depth: 0, title: "Good Track", authors: "B" },
    };
    expect(parseFipSteps(steps, BASE)).toEqual({ rawArtist: "B", rawTitle: "Good Track" });
  });
});

describe("parseNtsLive", () => {
  const fullBody = {
    now: {
      broadcast_title: "Floating Points",
      embeds: {
        details: { name: "Sam Shepherd" },
      },
    },
  };

  it("extracts broadcast_title as rawTitle and host name as rawArtist", () => {
    expect(parseNtsLive(fullBody)).toEqual({
      rawArtist: "Sam Shepherd",
      rawTitle: "Floating Points",
      show: { name: "Floating Points", djName: "Sam Shepherd" },
    });
  });

  it("falls back to broadcast_title as rawArtist when host name is absent", () => {
    const body = { now: { broadcast_title: "Late Night Tales" } };
    expect(parseNtsLive(body)).toEqual({
      rawArtist: "Late Night Tales",
      rawTitle: "Late Night Tales",
      show: { name: "Late Night Tales" },
    });
  });

  it("returns null when broadcast_title is absent", () => {
    const body = { now: { embeds: { details: { name: "DJ X" } } } };
    expect(parseNtsLive(body)).toBeNull();
  });

  it("returns null when the now object is missing", () => {
    expect(parseNtsLive({})).toBeNull();
    expect(parseNtsLive(null)).toBeNull();
    expect(parseNtsLive(undefined)).toBeNull();
  });

  it("trims whitespace from title and host fields", () => {
    const body = {
      now: {
        broadcast_title: "  Hessle Audio  ",
        embeds: { details: { name: "  Ben UFO  " } },
      },
    };
    const result = parseNtsLive(body);
    expect(result?.rawTitle).toBe("Hessle Audio");
    expect(result?.rawArtist).toBe("Ben UFO");
  });

  it("returns null when broadcast_title is an empty / whitespace-only string", () => {
    const body = { now: { broadcast_title: "   " } };
    expect(parseNtsLive(body)).toBeNull();
  });

  it("returns null when start_timestamp is in the future (stale pre-handoff data)", () => {
    const futureTs = new Date(Date.now() + 60_000).toISOString();
    const body = {
      now: { broadcast_title: "NTS Default", start_timestamp: futureTs },
    };
    expect(parseNtsLive(body)).toBeNull();
  });

  it("accepts a show whose start_timestamp is in the past", () => {
    const pastTs = new Date(Date.now() - 5 * 60_000).toISOString();
    const body = {
      now: {
        broadcast_title: "Hessle Audio",
        start_timestamp: pastTs,
        embeds: { details: { name: "Ben UFO" } },
      },
    };
    expect(parseNtsLive(body)).toEqual({
      rawArtist: "Ben UFO",
      rawTitle: "Hessle Audio",
      show: { name: "Hessle Audio", djName: "Ben UFO" },
    });
  });

  it("uses an injected now_ms so tests are deterministic", () => {
    const fixedNow = 1_700_000_000_000;
    const futureTs = new Date(fixedNow + 1).toISOString();
    const pastTs = new Date(fixedNow - 1).toISOString();
    const makeBody = (ts: string) => ({
      now: { broadcast_title: "Test Show", start_timestamp: ts },
    });
    expect(parseNtsLive(makeBody(futureTs), fixedNow)).toBeNull();
    expect(parseNtsLive(makeBody(pastTs), fixedNow)).not.toBeNull();
  });

  it("ignores start_timestamp when the field is absent or unparseable", () => {
    const body = { now: { broadcast_title: "Late Night Tales" } };
    expect(parseNtsLive(body)).not.toBeNull();

    const badTs = { now: { broadcast_title: "Late Night Tales", start_timestamp: "not-a-date" } };
    expect(parseNtsLive(badTs)).not.toBeNull();
  });
});

describe("stationArchiveUrl", () => {
  it("builds KEXP's dated playlist URL with unpadded month/day", () => {
    expect(stationArchiveUrl("kexp_api", "2026-07-01")).toBe(
      "https://www.kexp.org/playlist/2026/7/1/",
    );
    expect(stationArchiveUrl("kexp_api", "2024-12-25")).toBe(
      "https://www.kexp.org/playlist/2024/12/25/",
    );
  });

  it("builds Spinitron's per-station calendar URL when stationHandle present", () => {
    expect(
      stationArchiveUrl("spinitron", "2026-07-01", { stationHandle: "WFMU" }),
    ).toBe("https://spinitron.com/WFMU/calendar/date/2026-07-01");
    expect(
      stationArchiveUrl("spinitron", "2024-12-25", { stationHandle: "WXYC" }),
    ).toBe("https://spinitron.com/WXYC/calendar/date/2024-12-25");
  });

  it("returns null for Spinitron when stationHandle is absent", () => {
    expect(stationArchiveUrl("spinitron", "2026-07-01")).toBeNull();
    expect(stationArchiveUrl("spinitron", "2026-07-01", {})).toBeNull();
    expect(
      stationArchiveUrl("spinitron", "2026-07-01", { stationHandle: "" }),
    ).toBeNull();
  });

  it("returns null for sources without a public per-day archive", () => {
    expect(stationArchiveUrl("radio_paradise", "2026-07-01")).toBeNull();
    expect(stationArchiveUrl(null, "2026-07-01")).toBeNull();
    expect(stationArchiveUrl(undefined, "2026-07-01")).toBeNull();
  });

  it("never fabricates a link from a malformed day", () => {
    expect(stationArchiveUrl("kexp_api", "not-a-day")).toBeNull();
    expect(stationArchiveUrl("kexp_api", "2026-7-1")).toBeNull();
    expect(stationArchiveUrl("kexp_api", "")).toBeNull();
  });
});

describe("supportsBackfill", () => {
  it("only time-anchored history sources qualify", () => {
    expect(supportsBackfill("kexp_api")).toBe(true);
    expect(supportsBackfill("radio_paradise")).toBe(false);
    expect(supportsBackfill(null)).toBe(false);
  });
});

describe("parseRadiojarNowPlaying", () => {
  it("parses a normal track payload with album and thumb", () => {
    expect(
      parseRadiojarNowPlaying({
        artist: "Fleetwood Mac",
        title: "Go Your Own Way",
        album: "Rumours",
        thumb: "https://cdn.example.com/art.jpg",
      }),
    ).toEqual({
      rawArtist: "Fleetwood Mac",
      rawTitle: "Go Your Own Way",
      album: "Rumours",
      artworkUrl: "https://cdn.example.com/art.jpg",
    });
  });

  it("passes through show-level metadata (AlHara style)", () => {
    expect(parseRadiojarNowPlaying({ artist: "Saria", title: "w/ Saria" })).toEqual({
      rawArtist: "Saria",
      rawTitle: "w/ Saria",
    });
  });

  it("degrades to title-only and artist-only payloads", () => {
    expect(parseRadiojarNowPlaying({ title: "Some Show" })).toEqual({
      rawArtist: "Some Show",
      rawTitle: "Some Show",
    });
    expect(parseRadiojarNowPlaying({ artist: "Some DJ" })).toEqual({
      rawArtist: "Some DJ",
      rawTitle: "Some DJ",
    });
  });

  it("ignores empty/whitespace strings and null album/thumb", () => {
    expect(parseRadiojarNowPlaying({ artist: "  ", title: "" })).toBeNull();
    expect(
      parseRadiojarNowPlaying({ artist: "A", title: "B", album: null, thumb: "" }),
    ).toEqual({ rawArtist: "A", rawTitle: "B" });
  });

  it("returns null for non-object bodies", () => {
    expect(parseRadiojarNowPlaying(null)).toBeNull();
    expect(parseRadiojarNowPlaying(undefined)).toBeNull();
    expect(parseRadiojarNowPlaying("nope")).toBeNull();
    expect(parseRadiojarNowPlaying([1, 2])).toBeNull();
    expect(parseRadiojarNowPlaying({})).toBeNull();
  });
});

describe("parseLotRadioSchedule", () => {
  function buildRsc(
    events: Array<{ summary: string; start: string; end: string }>,
  ): string {
    const arr = JSON.stringify(events);
    return `...some rsc payload..."schedule":${arr},"from":"2026-07-10T12:00:00.000-04:00"...`;
  }

  const ON_AIR = new Date("2026-07-10T17:30:00.000Z"); // 1:30 pm EDT

  it("returns show name + 'Live Session' for the current on-air event", () => {
    const rsc = buildRsc([
      {
        summary: "KELLEN303",
        start: "2026-07-10T12:00:00-04:00", // noon–1pm EDT, ends before ON_AIR
        end: "2026-07-10T13:00:00-04:00",
      },
      {
        summary: "DJ OFFWRLD",
        start: "2026-07-10T13:00:00-04:00", // 1pm–3pm EDT, covers ON_AIR (1:30pm)
        end: "2026-07-10T15:00:00-04:00",
      },
    ]);
    expect(parseLotRadioSchedule(rsc, ON_AIR)).toEqual({
      rawArtist: "DJ OFFWRLD",
      rawTitle: "Live Session",
    });
  });

  it("returns null when no event covers the current time (off-air gap)", () => {
    const rsc = buildRsc([
      {
        summary: "Morning Show",
        start: "2026-07-10T10:00:00-04:00",
        end: "2026-07-10T11:00:00-04:00",
      },
    ]);
    expect(parseLotRadioSchedule(rsc, ON_AIR)).toBeNull();
  });

  it("trims leading/trailing whitespace from show summary", () => {
    const rsc = buildRsc([
      {
        summary: "  GENE ON EARTH  ",
        start: "2026-07-10T13:00:00-04:00",
        end: "2026-07-10T15:00:00-04:00",
      },
    ]);
    const result = parseLotRadioSchedule(rsc, ON_AIR);
    expect(result?.rawArtist).toBe("GENE ON EARTH");
  });

  it("returns null when the RSC payload has no schedule marker", () => {
    expect(parseLotRadioSchedule("some random html with no schedule", ON_AIR)).toBeNull();
  });

  it("returns null when the embedded JSON is malformed", () => {
    const broken = `..."schedule":[{bad json}],"from":"..."`;
    expect(parseLotRadioSchedule(broken, ON_AIR)).toBeNull();
  });

  it("matches the boundary exactly: start inclusive, end exclusive", () => {
    const events = [
      {
        summary: "Early Show",
        start: "2026-07-10T12:00:00-04:00",
        end: "2026-07-10T13:00:00-04:00",
      },
      {
        summary: "Late Show",
        start: "2026-07-10T13:00:00-04:00",
        end: "2026-07-10T14:00:00-04:00",
      },
    ];
    const rsc = buildRsc(events);
    const atStart = new Date("2026-07-10T17:00:00.000Z"); // 1:00 pm EDT = start of Late Show
    expect(parseLotRadioSchedule(rsc, atStart)?.rawArtist).toBe("Late Show");

    const atEnd = new Date("2026-07-10T18:00:00.000Z"); // 2:00 pm EDT = end of Late Show
    expect(parseLotRadioSchedule(rsc, atEnd)).toBeNull();
  });
});

// ---- parseIcyNowPlaying --------------------------------------------------

describe("parseIcyNowPlaying", () => {
  it("parses a standard Artist - Title entry", () => {
    const result = parseIcyNowPlaying("Beck - Heart Is A Drum");
    expect(result?.rawArtist).toBe("Beck");
    expect(result?.rawTitle).toBe("Heart Is A Drum");
  });

  it("retains a title-only entry — NOT flagged as junk even though rawArtist will equal rawTitle", () => {
    // A station that emits only a title (no ` - ` separator) must not be
    // discarded: the equality guard must not fire on the synthetic fallback.
    const result = parseIcyNowPlaying("Landscape on Mars");
    expect(result).not.toBeNull();
    expect(result!.rawTitle).toBe("Landscape on Mars");
    expect(result!.rawArtist).toBe("Landscape on Mars"); // fallback = title
  });

  it("drops title-only ADWTAG_ junk even with no artist field", () => {
    expect(parseIcyNowPlaying("ADWTAG_60000")).toBeNull();
  });

  it("drops title-only numeric code even with no artist field", () => {
    expect(parseIcyNowPlaying("60000")).toBeNull();
  });

  it("drops entries where the source provides identical artist and title", () => {
    // This is a genuine junk case: both fields are present and equal.
    expect(parseIcyNowPlaying("LA GIGANTE DE LOS ANDES - LA GIGANTE DE LOS ANDES")).toBeNull();
  });

  it("drops ADWTAG_ junk", () => {
    expect(parseIcyNowPlaying("ADWTAG_60000 - Big R Radio")).toBeNull();
  });

  it("passes tilde format through with recordingId and durationMs", () => {
    const tilde =
      "Diamonds On The Soles Of Her Shoes~Paul Simon~~1986~~333~2026-07-09T17:34:51~2026-07-09T17:39:12~Radio Monte Carlo Nights Story~261.88~7306359a-ae20-4755-99ca-8a0410618b6d";
    const result = parseIcyNowPlaying(tilde);
    expect(result?.rawTitle).toBe("Diamonds On The Soles Of Her Shoes");
    expect(result?.rawArtist).toBe("Paul Simon");
    expect(result?.recordingId).toBe("7306359a-ae20-4755-99ca-8a0410618b6d");
    expect(result?.durationMs).toBe(333_000);
  });

  it("returns null for empty string", () => {
    expect(parseIcyNowPlaying("")).toBeNull();
  });
});

describe("parseSpinitronWebPage", () => {
  it("parses the live Spinitron HTML structure (class='artist' / class='song')", () => {
    const html = `<td class="spin-text"><div class="spin"><span class="artist">Matt Borghi</span> <span class="song">Silence Beneath Memory</span></div></td>`;
    const result = parseSpinitronWebPage(html);
    expect(result).toEqual({ rawArtist: "Matt Borghi", rawTitle: "Silence Beneath Memory" });
  });

  it("returns the FIRST spin (current) when multiple are present", () => {
    const html = `
      <span class="artist">First Artist</span> <span class="song">First Song</span>
      <span class="artist">Second Artist</span> <span class="song">Second Song</span>
    `;
    const result = parseSpinitronWebPage(html);
    expect(result?.rawArtist).toBe("First Artist");
    expect(result?.rawTitle).toBe("First Song");
  });

  it("parses data-artist / data-song attributes (Pattern A)", () => {
    const html = `<div data-artist="Khruangbin" data-song="Maria También"></div>`;
    const result = parseSpinitronWebPage(html);
    expect(result).toEqual({ rawArtist: "Khruangbin", rawTitle: "Maria También" });
  });

  it("falls through to JSON island when class patterns are absent (Pattern C)", () => {
    const html = `<script>{"artist":"Grouper","song":"Alien Observer"}</script>`;
    const result = parseSpinitronWebPage(html);
    expect(result).toEqual({ rawArtist: "Grouper", rawTitle: "Alien Observer" });
  });

  it("returns null when no recognizable pattern is present", () => {
    expect(parseSpinitronWebPage("<html><body>Nothing here</body></html>")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSpinitronWebPage("")).toBeNull();
  });

  it("trims whitespace from extracted values", () => {
    const html = `<span class="artist">  Low  </span> <span class="song">  Murderer  </span>`;
    const result = parseSpinitronWebPage(html);
    expect(result?.rawArtist).toBe("Low");
    expect(result?.rawTitle).toBe("Murderer");
  });
});

// ---- Spinitron HTML fixture snapshot tests -------------------------------
//
// These tests parse captured real-world Spinitron HTML snapshots.  Their
// primary purpose is regression detection: if Spinitron changes their page
// structure (class names, element nesting), parseSpinitronWebPage returns null
// and the test fails loudly — catching the breakage before production goes dark.
//
// To update fixtures after a confirmed Spinitron HTML change:
//   1. Re-fetch both live pages:  ./scripts/refresh-spinitron-fixtures.sh
//   2. Update the snapshots:      pnpm --filter api-server test -- --update-snapshots
//   3. Verify parseSpinitronWebPage() still returns non-null artist + title.

function loadFixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");
}

describe("parseSpinitronWebPage — real HTML fixtures", () => {
  it("WPRB fixture: extracts non-null artist and title", () => {
    const html = loadFixture("spinitron-wprb.html");
    const result = parseSpinitronWebPage(html);
    expect(result).not.toBeNull();
    expect(typeof result?.rawArtist).toBe("string");
    expect(result!.rawArtist.length).toBeGreaterThan(0);
    expect(typeof result?.rawTitle).toBe("string");
    expect(result!.rawTitle.length).toBeGreaterThan(0);
  });

  it("WPRB fixture: parsed result matches snapshot (detects HTML structure drift)", () => {
    const html = loadFixture("spinitron-wprb.html");
    const result = parseSpinitronWebPage(html);
    expect(result).toMatchSnapshot();
  });

  it("WPRB fixture: picks the first (current) spin, not a later one", () => {
    const html = loadFixture("spinitron-wprb.html");
    const result = parseSpinitronWebPage(html);
    expect(result?.rawArtist).toBe("Blason");
    expect(result?.rawTitle).toBe("BOUNDARY MISSING A REACTOR");
  });

  it("WMFO fixture: extracts non-null artist and title", () => {
    const html = loadFixture("spinitron-wmfo.html");
    const result = parseSpinitronWebPage(html);
    expect(result).not.toBeNull();
    expect(typeof result?.rawArtist).toBe("string");
    expect(result!.rawArtist.length).toBeGreaterThan(0);
    expect(typeof result?.rawTitle).toBe("string");
    expect(result!.rawTitle.length).toBeGreaterThan(0);
  });

  it("WMFO fixture: parsed result matches snapshot (detects HTML structure drift)", () => {
    const html = loadFixture("spinitron-wmfo.html");
    const result = parseSpinitronWebPage(html);
    expect(result).toMatchSnapshot();
  });

  it("WMFO fixture: picks the first (current) spin, not a later one", () => {
    const html = loadFixture("spinitron-wmfo.html");
    const result = parseSpinitronWebPage(html);
    expect(result?.rawArtist).toBe("Joe Louis Walker");
    expect(result?.rawTitle).toBe("Blue Mirror");
  });
});
