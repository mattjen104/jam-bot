/**
 * Station Finder search proxy — GET /api/stations/search.
 *
 * Covers:
 *   1. Query validation — missing/short/long q rejected with 400 before any
 *      upstream fetch happens.
 *   2. Proxy behavior — Radio Browser is called with the mapped params and
 *      results are trimmed to the listener-facing shape (url_resolved
 *      preferred, tags split, rows without a playable URL dropped).
 *   3. inLoreCatalog — set via radio_browser_stations UUID match (joined to
 *      an active, non-hidden station) or case-insensitive name match.
 *   4. Upstream failure — non-2xx / network error / non-array body → 502.
 *   5. Response cache — identical searches share one upstream fetch (single
 *      flight), failures are never cached, distinct params are distinct
 *      cache entries.
 *   6. Rate limiting — the exported limiter factory 429s past its budget.
 *
 * The DB layer and global fetch are mocked; no real database or network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── module mocks — must be wired before the router import ──────────────────

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: { select: selectMock },
  stationsTable: {
    id: "stations.id",
    name: "stations.name",
    active: "stations.active",
    hidden: "stations.hidden",
  },
  radioBrowserStationsTable: {
    radioBrowserUuid: "radio_browser_stations.radio_browser_uuid",
    stationId: "radio_browser_stations.station_id",
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Import after mocks are wired
import stationSearchRouter, {
  createStationSearchLimiter,
  __testOnlyResetStationSearchCache,
} from "../src/routes/station-search.js";

const app = express();
app.use(stationSearchRouter);

// ── helpers ──────────────────────────────────────────────────────────────────

let uuidRows: { uuid: string }[] = [];
let nameRows: { name: string }[] = [];

/** Minimal chainable stand-in for the drizzle select query builder. */
function makeQuery(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  q.from = () => q;
  q.innerJoin = () => q;
  q.where = () => Promise.resolve(rows);
  return q;
}

function rbOk(stations: unknown[]) {
  return { ok: true, status: 200, json: async () => stations };
}

function rbStation(overrides: Record<string, unknown> = {}) {
  return {
    stationuuid: "uuid-aaa",
    name: "Boogie Radio",
    url: "https://stream.example.com/boogie",
    url_resolved: "https://cdn.example.com/boogie",
    favicon: "https://example.com/favicon.ico",
    tags: "funk, disco, soul",
    country: "United States",
    state: "California",
    bitrate: 128,
    codec: "MP3",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  uuidRows = [];
  nameRows = [];
  // The response cache is module-level — reset it so each test's fetch
  // expectations start cold.
  __testOnlyResetStationSearchCache();
  // The handler runs two selects: one projecting { uuid }, one { name }.
  selectMock.mockImplementation((sel: Record<string, unknown>) =>
    makeQuery("uuid" in sel ? uuidRows : nameRows),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Query validation
// ─────────────────────────────────────────────────────────────────────────────
describe("query validation", () => {
  it("rejects a missing q with 400 and never calls Radio Browser", async () => {
    const res = await request(app).get("/stations/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2 characters/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a single-character q", async () => {
    const res = await request(app).get("/stations/search?q=a");
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only q (trims before measuring)", async () => {
    const res = await request(app).get("/stations/search?q=%20%20");
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an over-long q", async () => {
    const res = await request(app).get(`/stations/search?q=${"x".repeat(101)}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Proxy behavior + result trimming
// ─────────────────────────────────────────────────────────────────────────────
describe("proxy + trimming", () => {
  it("queries Radio Browser with the mapped params and trims the results", async () => {
    fetchMock.mockResolvedValue(rbOk([rbStation()]));

    const res = await request(app).get("/stations/search?q=boogie");

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, unknown];
    expect(url).toContain("https://de1.api.radio-browser.info/json/stations/search?");
    expect(url).toContain("name=boogie");
    expect(url).toContain("limit=30");
    expect(url).toContain("hidebroken=true");
    expect(url).toContain("order=votes");

    expect(res.body.results).toHaveLength(1);
    const r = res.body.results[0];
    expect(r).toEqual({
      name: "Boogie Radio",
      state: "California",
      country: "United States",
      tags: ["funk", "disco", "soul"],
      // url_resolved is preferred over url
      url: "https://cdn.example.com/boogie",
      favicon: "https://example.com/favicon.ico",
      bitrate: 128,
      codec: "MP3",
      radioBrowserUuid: "uuid-aaa",
      inLoreCatalog: false,
    });
  });

  it("forwards country and tag filters upstream", async () => {
    fetchMock.mockResolvedValue(rbOk([]));

    const res = await request(app).get(
      "/stations/search?q=jazz&country=Canada&tag=smooth%20jazz",
    );

    expect(res.status).toBe(200);
    const [url] = fetchMock.mock.calls[0] as [string, unknown];
    expect(url).toContain("country=Canada");
    expect(url).toContain("tag=smooth+jazz");
    expect(res.body.results).toEqual([]);
  });

  it("falls back to url when url_resolved is empty and drops unplayable rows", async () => {
    fetchMock.mockResolvedValue(rbOk([
      rbStation({ stationuuid: "uuid-ok", url_resolved: "", url: "https://fallback.example.com/s" }),
      rbStation({ stationuuid: "uuid-nourl", url_resolved: "", url: "" }),
      rbStation({ stationuuid: "uuid-noname", name: "  " }),
    ]));

    const res = await request(app).get("/stations/search?q=test");

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].url).toBe("https://fallback.example.com/s");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. inLoreCatalog detection
// ─────────────────────────────────────────────────────────────────────────────
describe("inLoreCatalog", () => {
  it("flags a station whose Radio Browser uuid is enrolled in Lore", async () => {
    fetchMock.mockResolvedValue(rbOk([rbStation({ stationuuid: "uuid-enrolled" })]));
    uuidRows = [{ uuid: "uuid-enrolled" }];

    const res = await request(app).get("/stations/search?q=boogie");

    expect(res.status).toBe(200);
    expect(res.body.results[0].inLoreCatalog).toBe(true);
  });

  it("flags a station whose name matches a Lore station, case-insensitively", async () => {
    fetchMock.mockResolvedValue(rbOk([rbStation({ name: "wjas FM" })]));
    nameRows = [{ name: "WJAS FM" }];

    const res = await request(app).get("/stations/search?q=wjas");

    expect(res.status).toBe(200);
    expect(res.body.results[0].inLoreCatalog).toBe(true);
  });

  it("leaves unknown stations unflagged", async () => {
    fetchMock.mockResolvedValue(rbOk([rbStation()]));

    const res = await request(app).get("/stations/search?q=boogie");

    expect(res.body.results[0].inLoreCatalog).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Upstream failure → 502
// ─────────────────────────────────────────────────────────────────────────────
describe("upstream failure", () => {
  it("returns 502 when Radio Browser responds non-2xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const res = await request(app).get("/stations/search?q=boogie");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/503/);
  });

  it("returns 502 when the fetch throws (network error / timeout abort)", async () => {
    fetchMock.mockRejectedValue(new Error("aborted"));
    const res = await request(app).get("/stations/search?q=boogie");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/unreachable/);
  });

  it("returns 502 when the response body is not an array", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: true }) });
    const res = await request(app).get("/stations/search?q=boogie");
    expect(res.status).toBe(502);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Response cache (single-flight, bounded, failures never cached)
// ─────────────────────────────────────────────────────────────────────────────
describe("response cache", () => {
  it("serves identical searches from one upstream fetch", async () => {
    fetchMock.mockResolvedValue(rbOk([rbStation()]));

    const first = await request(app).get("/stations/search?q=cache-me");
    const second = await request(app).get("/stations/search?q=cache-me");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.results).toEqual(first.body.results);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares a single upstream fetch across concurrent identical searches", async () => {
    let resolveFetch: ((v: unknown) => void) | undefined;
    fetchMock.mockImplementation(() => new Promise((r) => { resolveFetch = r; }));

    // supertest fires lazily — .then() kicks the request off; await the
    // derived promises so each Test is ended exactly once.
    const r1p = request(app).get("/stations/search?q=flight").then((r) => r);
    const r2p = request(app).get("/stations/search?q=flight").then((r) => r);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFetch!(rbOk([rbStation({ stationuuid: "uuid-flight" })]));

    const [r1, r2] = await Promise.all([r1p, r2p]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.results[0].radioBrowserUuid).toBe("uuid-flight");
    expect(r2.body.results[0].radioBrowserUuid).toBe("uuid-flight");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats different filter params as different cache entries", async () => {
    fetchMock.mockResolvedValue(rbOk([]));

    await request(app).get("/stations/search?q=multi");
    await request(app).get("/stations/search?q=multi&country=Canada");
    await request(app).get("/stations/search?q=multi&tag=jazz");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never caches failures — the next identical request retries upstream", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const failed = await request(app).get("/stations/search?q=retry-me");
    expect(failed.status).toBe(502);

    fetchMock.mockResolvedValueOnce(rbOk([rbStation({ stationuuid: "uuid-recovered" })]));
    const recovered = await request(app).get("/stations/search?q=retry-me");
    expect(recovered.status).toBe(200);
    expect(recovered.body.results[0].radioBrowserUuid).toBe("uuid-recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still flags inLoreCatalog per request even when results come from cache", async () => {
    fetchMock.mockResolvedValue(rbOk([rbStation({ stationuuid: "uuid-flag-later" })]));

    const before = await request(app).get("/stations/search?q=flag-me");
    expect(before.body.results[0].inLoreCatalog).toBe(false);

    // Station gets enrolled in Lore between requests — cached upstream rows
    // must not freeze the flag.
    uuidRows = [{ uuid: "uuid-flag-later" }];
    const after = await request(app).get("/stations/search?q=flag-me");

    expect(fetchMock).toHaveBeenCalledTimes(1); // upstream served from cache
    expect(after.body.results[0].inLoreCatalog).toBe(true); // flag stayed fresh
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Rate limiting — the exported factory 429s past its per-IP budget. The
//    default instance mounted on the router skips under VITEST (same pattern
//    as the ACR fingerprint limiter), so this suite proves the guard through
//    a low-limit instance mounted the same way.
// ─────────────────────────────────────────────────────────────────────────────
describe("rate limiting", () => {
  it("returns 429 once the per-IP budget is exhausted", async () => {
    fetchMock.mockResolvedValue(rbOk([rbStation()]));
    const limitedApp = express();
    limitedApp.use(createStationSearchLimiter(2), stationSearchRouter);

    const r1 = await request(limitedApp).get("/stations/search?q=limited");
    const r2 = await request(limitedApp).get("/stations/search?q=limited");
    const r3 = await request(limitedApp).get("/stations/search?q=limited");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    // The rejected request never reached upstream (first two shared one
    // cached fetch).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
