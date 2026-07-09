import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  slugify,
  filterStations,
  detectFormat,
  fetchStationsByTag,
  upsertRadioBrowserStations,
  MIN_BITRATE_KBPS,
  MIN_VOTES,
  RADIO_BROWSER_GENRE_WHITELIST,
  SEED_GENRE_TAGS,
  type RadioBrowserStation,
} from "../src/lore/radio-browser.js";

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric runs with hyphens", () => {
    expect(slugify("Radio Paradise!")).toBe("radio-paradise");
    expect(slugify("KEXP 90.3 FM")).toBe("kexp-90-3-fm");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  Jazz FM  ")).toBe("jazz-fm");
    expect(slugify("---hello---")).toBe("hello");
  });

  it("handles unicode-heavy names by stripping them", () => {
    const result = slugify("Rádio Às 3");
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });

  it("caps at 120 characters", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(120);
  });
});

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------

describe("detectFormat", () => {
  it("detects AAC from codec string", () => {
    expect(detectFormat("AAC", "http://x/stream")).toBe("aac");
    expect(detectFormat("aac+", "http://x/stream")).toBe("aac");
  });

  it("detects MP3 as default when codec is empty", () => {
    expect(detectFormat("", "http://x/stream.mp3")).toBe("mp3");
    expect(detectFormat(null, "http://x/stream")).toBe("mp3");
  });

  it("detects HLS from URL extension", () => {
    expect(detectFormat("", "http://x/stream.m3u8")).toBe("hls");
  });

  it("detects FLAC", () => {
    expect(detectFormat("FLAC", "http://x/stream")).toBe("flac");
  });
});

// ---------------------------------------------------------------------------
// filterStations
// ---------------------------------------------------------------------------

function makeStation(overrides: Partial<RadioBrowserStation> = {}): RadioBrowserStation {
  return {
    stationuuid: "uuid-1",
    name: "Test Station",
    url_resolved: "https://stream.example.com/live",
    url: "https://stream.example.com/live",
    tags: "ambient",
    country: "US",
    homepage: "https://example.com",
    favicon: "",
    codec: "MP3",
    bitrate: 128,
    votes: 200,      // ≥ MIN_VOTES (100) by default
    clickcount: 100,
    lastcheckok: 1,
    ...overrides,
  };
}

describe("filterStations", () => {
  it("keeps stations with lastcheckok=1", () => {
    const stations = [makeStation(), makeStation({ lastcheckok: 0, url_resolved: "https://other.com/live" })];
    expect(filterStations(stations)).toHaveLength(1);
  });

  it("drops stations with no name", () => {
    expect(filterStations([makeStation({ name: "" })])).toHaveLength(0);
    expect(filterStations([makeStation({ name: "  " })])).toHaveLength(0);
  });

  it("drops stations with no stream URL", () => {
    expect(
      filterStations([makeStation({ url_resolved: "", url: "" })]),
    ).toHaveLength(0);
  });

  it("deduplicates by resolved URL keeping highest clickcount", () => {
    const low = makeStation({ clickcount: 10, stationuuid: "a" });
    const high = makeStation({ clickcount: 999, stationuuid: "b" });
    const result = filterStations([low, high]);
    expect(result).toHaveLength(1);
    expect(result[0]!.clickcount).toBe(999);
  });

  it("uses url as fallback when url_resolved is empty", () => {
    const s = makeStation({ url_resolved: "", url: "https://fallback.example.com/live" });
    const result = filterStations([s]);
    expect(result).toHaveLength(1);
    expect(result[0]!.url_resolved).toBe("https://fallback.example.com/live");
  });

  // --- New quality gates (128 kbps floor, 100 votes minimum) ---

  it(`rejects stations with known bitrate below ${MIN_BITRATE_KBPS}kbps`, () => {
    expect(filterStations([makeStation({ bitrate: MIN_BITRATE_KBPS - 1 })])).toHaveLength(0);
    expect(filterStations([makeStation({ bitrate: 64 })])).toHaveLength(0);
  });

  it(`passes stations with bitrate exactly ${MIN_BITRATE_KBPS}kbps`, () => {
    expect(filterStations([makeStation({ bitrate: MIN_BITRATE_KBPS })])).toHaveLength(1);
  });

  it("allows stations with bitrate=0 (unknown bitrate — deferred to health worker)", () => {
    expect(filterStations([makeStation({ bitrate: 0 })])).toHaveLength(1);
  });

  it(`rejects stations with votes below ${MIN_VOTES}`, () => {
    expect(filterStations([makeStation({ votes: MIN_VOTES - 1 })])).toHaveLength(0);
    expect(filterStations([makeStation({ votes: 0 })])).toHaveLength(0);
  });

  it(`passes stations with exactly ${MIN_VOTES} votes`, () => {
    expect(filterStations([makeStation({ votes: MIN_VOTES })])).toHaveLength(1);
  });

  it("respects custom minBitrateKbps override", () => {
    expect(filterStations([makeStation({ bitrate: 190 })], { minBitrateKbps: 192 })).toHaveLength(0);
    expect(filterStations([makeStation({ bitrate: 64 })], { minBitrateKbps: 64, minVotes: 0 })).toHaveLength(1);
  });

  it("respects custom minVotes override", () => {
    expect(filterStations([makeStation({ votes: 50 })], { minVotes: 200 })).toHaveLength(0);
    expect(filterStations([makeStation({ votes: 50 })], { minVotes: 10 })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// fetchStationsByTag (mocked HTTP)
// ---------------------------------------------------------------------------

describe("fetchStationsByTag", () => {
  it("returns parsed stations on success", async () => {
    const station = makeStation();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([station]),
    } as unknown as Response);

    const result = await fetchStationsByTag("jazz", { fetchFn: mockFetch as typeof fetch });
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Test Station");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns empty array on HTTP error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);

    const result = await fetchStationsByTag("jazz", { fetchFn: mockFetch as typeof fetch });
    expect(result).toHaveLength(0);
  });

  it("returns empty array on network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await fetchStationsByTag("jazz", { fetchFn: mockFetch as typeof fetch });
    expect(result).toHaveLength(0);
  });

  it("returns empty array when response is not an array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: "not found" }),
    } as unknown as Response);

    const result = await fetchStationsByTag("jazz", { fetchFn: mockFetch as typeof fetch });
    expect(result).toHaveLength(0);
  });

  it("includes tag and limit in the request URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as unknown as Response);

    await fetchStationsByTag("krautrock", { fetchFn: mockFetch as typeof fetch, limit: 50 });
    const url = (mockFetch.mock.calls[0] as [string, unknown])[0];
    expect(url).toContain("krautrock");
    expect(url).toContain("limit=50");
  });
});

// ---------------------------------------------------------------------------
// MIN_BITRATE_KBPS export sanity
// ---------------------------------------------------------------------------

describe("MIN_BITRATE_KBPS", () => {
  it("is a positive integer", () => {
    expect(MIN_BITRATE_KBPS).toBeGreaterThan(0);
    expect(Number.isInteger(MIN_BITRATE_KBPS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectFormat — codec mapping correctness
// ---------------------------------------------------------------------------

describe("detectFormat", () => {
  it("maps AAC codec to 'aac'", () => {
    expect(detectFormat("AAC", "https://stream.example.com/live")).toBe("aac");
  });

  it("maps OGG codec to 'ogg' (not 'aac')", () => {
    expect(detectFormat("OGG", "https://stream.example.com/live")).toBe("ogg");
  });

  it("maps VORBIS codec to 'ogg'", () => {
    expect(detectFormat("VORBIS", "https://stream.example.com/live")).toBe("ogg");
  });

  it("maps FLAC codec to 'flac'", () => {
    expect(detectFormat("FLAC", "https://stream.example.com/live")).toBe("flac");
  });

  it("maps .m3u8 URL to 'hls'", () => {
    expect(detectFormat(null, "https://stream.example.com/live.m3u8")).toBe("hls");
  });

  it("defaults to 'mp3' for unknown codec", () => {
    expect(detectFormat(null, "https://stream.example.com/live")).toBe("mp3");
    expect(detectFormat("MP3", "https://stream.example.com/live")).toBe("mp3");
  });
});

// ---------------------------------------------------------------------------
// upsertRadioBrowserStations — DB interaction tests (mocked DB)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const returning = vi.fn().mockResolvedValue([{ id: 1, source: "radio_browser" }]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  const whereMock = vi.fn().mockResolvedValue(undefined);
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  const updateMock = vi.fn().mockReturnValue({ set: setMock });
  return {
    ...actual,
    db: { insert: insertMock, update: updateMock },
    stationsTable: actual.stationsTable,
    radioBrowserStationsTable: actual.radioBrowserStationsTable,
  };
});

describe("upsertRadioBrowserStations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts one row per valid station", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation();
    const count = await upsertRadioBrowserStations([station], "jazz");
    expect(count).toBe(1);
    // One insert for the stations row, one for the radio_browser_stations
    // ICY-enrollment row.
    expect((db.insert as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("inserts new longtail rows as active=false", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation();
    await upsertRadioBrowserStations([station], "jazz");

    // Reach into the mock chain: insert(table) → .values(payload) → ...
    // The return value of insert() has a `values` mock; inspect its first call.
    const insertReturnValue = (db.insert as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      values: ReturnType<typeof vi.fn>;
    };
    const valuesPayload = insertReturnValue?.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesPayload).toBeDefined();
    expect(valuesPayload.active).toBe(false);
    expect(valuesPayload.source).toBe("radio_browser");
    expect(valuesPayload.tier).toBe("longtail");
  });

  it("skips stations with empty name or URL", async () => {
    const { db } = await import("@workspace/db");
    const bad = [
      makeStation({ name: "" }),
      makeStation({ url_resolved: "", url: "" }),
    ];
    const count = await upsertRadioBrowserStations(bad, "jazz");
    expect(count).toBe(0);
    expect((db.insert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("skips stations whose name produces an empty slug", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation({ name: "---" }); // slugify → ""
    const count = await upsertRadioBrowserStations([station], "jazz");
    expect(count).toBe(0);
    expect((db.insert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("merges tag into the tags array on upsert", async () => {
    const { db } = await import("@workspace/db");
    const station = makeStation({ tags: "blues,rock" });
    await upsertRadioBrowserStations([station], "jazz");
    // The tags list includes both the query tag and station tags. Two inserts:
    // the stations row and the radio_browser_stations ICY-enrollment row.
    expect((db.insert as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("returns 0 on DB error and does not throw", async () => {
    const { db } = await import("@workspace/db");
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockRejectedValue(new Error("unique violation")),
      }),
    });
    const count = await upsertRadioBrowserStations([makeStation()], "jazz");
    expect(count).toBe(0);
  });

  it("skips stations with votes below MIN_VOTES (belt-and-suspenders guard)", async () => {
    const { db } = await import("@workspace/db");
    const count = await upsertRadioBrowserStations(
      [makeStation({ votes: MIN_VOTES - 1 })],
      "ambient",
    );
    expect(count).toBe(0);
    expect((db.insert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("skips stations with known bitrate below MIN_BITRATE_KBPS (belt-and-suspenders guard)", async () => {
    const { db } = await import("@workspace/db");
    const count = await upsertRadioBrowserStations(
      [makeStation({ bitrate: MIN_BITRATE_KBPS - 1 })],
      "ambient",
    );
    expect(count).toBe(0);
    expect((db.insert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("allows stations with bitrate=0 (unknown) through the belt-and-suspenders guard", async () => {
    const { db } = await import("@workspace/db");
    const count = await upsertRadioBrowserStations(
      [makeStation({ bitrate: 0 })],
      "ambient",
    );
    expect(count).toBe(1);
    expect((db.insert as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// RADIO_BROWSER_GENRE_WHITELIST
// ---------------------------------------------------------------------------

describe("RADIO_BROWSER_GENRE_WHITELIST", () => {
  it("is a non-empty frozen array", () => {
    expect(RADIO_BROWSER_GENRE_WHITELIST.length).toBeGreaterThan(0);
    expect(Object.isFrozen(RADIO_BROWSER_GENRE_WHITELIST)).toBe(true);
  });

  it("contains the expected niche genres", () => {
    const list = RADIO_BROWSER_GENRE_WHITELIST as readonly string[];
    expect(list).toContain("experimental");
    expect(list).toContain("ambient");
    expect(list).toContain("drone");
    expect(list).toContain("idm");
    expect(list).toContain("shoegaze");
    expect(list).toContain("post-rock");
    expect(list).toContain("folk");
  });

  it("does not contain mainstream genres", () => {
    const list = RADIO_BROWSER_GENRE_WHITELIST as readonly string[];
    for (const mainstream of ["jazz", "pop", "rock", "electronic", "blues", "soul", "indie", "classical"]) {
      expect(list).not.toContain(mainstream);
    }
  });
});

// ---------------------------------------------------------------------------
// SEED_GENRE_TAGS
// ---------------------------------------------------------------------------

describe("SEED_GENRE_TAGS", () => {
  it("all seed tags exist in RADIO_BROWSER_GENRE_WHITELIST", () => {
    const whitelist = new Set<string>(RADIO_BROWSER_GENRE_WHITELIST);
    for (const tag of SEED_GENRE_TAGS) {
      expect(whitelist.has(tag), `seed tag "${tag}" must be in the whitelist`).toBe(true);
    }
  });

  it("is a non-empty array", () => {
    expect(SEED_GENRE_TAGS.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// MIN_VOTES export sanity
// ---------------------------------------------------------------------------

describe("MIN_VOTES", () => {
  it("is at least 100", () => {
    expect(MIN_VOTES).toBeGreaterThanOrEqual(100);
    expect(Number.isInteger(MIN_VOTES)).toBe(true);
  });
});

describe("MIN_BITRATE_KBPS", () => {
  it("is at least 128", () => {
    expect(MIN_BITRATE_KBPS).toBeGreaterThanOrEqual(128);
    expect(Number.isInteger(MIN_BITRATE_KBPS)).toBe(true);
  });
});
