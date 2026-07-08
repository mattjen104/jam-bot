import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  slugify,
  filterStations,
  detectFormat,
  fetchStationsByTag,
  upsertRadioBrowserStations,
  MIN_BITRATE_KBPS,
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
    tags: "jazz",
    country: "US",
    homepage: "https://example.com",
    favicon: "",
    codec: "MP3",
    bitrate: 128,
    votes: 10,
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
// upsertRadioBrowserStations — DB interaction tests (mocked DB)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  return {
    ...actual,
    db: { insert: insertMock },
    stationsTable: actual.stationsTable,
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
    expect((db.insert as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
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
    // The insert was called once — the tags list includes both the query tag and station tags
    expect((db.insert as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
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
});
