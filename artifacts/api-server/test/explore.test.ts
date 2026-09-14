import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { vi } from "vitest";

const { executeMock, getUserMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  getUserMock: vi.fn(async () => null),
}));
vi.mock("@workspace/db", () => ({ db: { execute: executeMock } }));
vi.mock("../src/lore/userSession.js", () => ({ getUserForListenerRead: getUserMock }));

import exploreRouter, { composeExplore, type ExploreCandidate, type ExploreMode } from "../src/routes/explore.js";

const app = express();
app.use(exploreRouter);

function flattenSqlShape(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenSqlShape).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(flattenSqlShape).join(" ");
  return "";
}

const candidate = (slug: string, overrides: Partial<ExploreCandidate> = {}): ExploreCandidate => ({
  station: { slug, name: slug, city: null, region: null, latitude: null, longitude: null },
  show: null, recentProfile: null, freshness: null, discoveryScore: null,
  artistCount: 0, crossingCount: 0, exactGenre: false, adjacentGenre: false,
  ...overrides,
});

describe("composeExplore", () => {
  it.each<[ExploreMode, Partial<ExploreCandidate>, Partial<ExploreCandidate>]>([
    ["artist", { artistCount: 5 }, { artistCount: 1 }],
    ["library-crossing", { crossingCount: 4 }, { crossingCount: 1 }],
    ["genre", { exactGenre: true }, { adjacentGenre: true }],
    ["newness", { discoveryScore: 90 }, { discoveryScore: 40 }],
  ])("ranks %s evidence transparently", (mode, strong, weak) => {
    expect(composeExplore([candidate("weak", weak), candidate("strong", strong)], mode, 2)[0]!.station.slug).toBe("strong");
  });

  it("keeps unattributed live stations honest", () => {
    const result = composeExplore([candidate("live")], "station", 1)[0]!;
    expect(result.show).toBeNull();
    expect(result.timing).toBeNull();
  });
});

describe("GET /explore", () => {
  it("rejects station mode without a station slug before querying", async () => {
    executeMock.mockClear();
    const response = await request(app).get("/explore?mode=station");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_station");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("orders concrete upcoming instants and keeps historical shows separate", async () => {
    const row = (slug: string, upcoming: string, known: string, liveName: string | null) => ({
      slug, name: slug, city: null, region: null, latitude: null, longitude: null,
      discovery_score: 1, artist_count: 0, crossing_count: 0,
      recent_profile: { readinessTier: "ready", top: [] }, freshness_signal: { hasRecentUsableSpin: true },
      live: Boolean(liveName), show_name: liveName, dj_name: null,
      start_time: liveName ? "09:00" : null, end_time: liveName ? "10:00" : null,
      upcoming_show_name: `Next ${slug}`, upcoming_dj_name: null,
      upcoming_starts_at: upcoming, upcoming_ends_at: new Date(Date.parse(upcoming) + 3_600_000).toISOString(),
      known_show_name: known, known_dj_name: null, known_last_aired_at: "2026-09-01T12:00:00.000Z",
    });
    executeMock.mockResolvedValue({ rows: [
      row("later", "2026-09-06T12:00:00.000Z", "Archive Later", null),
      row("earlier", "2026-09-06T08:00:00.000Z", "Archive Earlier", "Live Earlier"),
    ] });

    const response = await request(app).get("/explore?mode=newness&limit=5");
    expect(response.status).toBe(200);
    const sqlShape = flattenSqlShape(executeMock.mock.calls[0]?.[0]);
    const exclusion = sqlShape.indexOf("sh.id IS DISTINCT FROM active_show.show_id");
    const historicalOrder = sqlShape.indexOf("ORDER BY max(sp.played_at) DESC LIMIT 1", exclusion);
    expect(exclusion).toBeGreaterThan(-1);
    expect(historicalOrder).toBeGreaterThan(exclusion);
    expect(sqlShape).not.toContain("lower(sh.name)");
    expect(response.body.comingUp.map((item: { station: { slug: string } }) => item.station.slug)).toEqual(["earlier", "later"]);
    expect(response.body.showsToKnow.map((item: { show: { name: string } }) => item.show.name).sort()).toEqual(["Archive Earlier", "Archive Later"]);
    expect(response.body.showsToKnow.some((known: { show: { name: string } }) =>
      response.body.onAirNow.some((live: { show: { name: string } }) => live.show.name === known.show.name)
    )).toBe(false);
  });

  it("keeps stale stations out of New Music results", async () => {
    const row = (slug: string, fresh: boolean) => ({
      slug, name: slug, city: null, region: null, latitude: null, longitude: null,
      discovery_score: 50, artist_count: 0, crossing_count: 0,
      recent_profile: { readinessTier: "ready", top: [] },
      freshness_signal: { hasRecentUsableSpin: fresh },
      live: false, show_name: null, dj_name: null, start_time: null, end_time: null,
      upcoming_show_name: null, upcoming_dj_name: null, upcoming_starts_at: null, upcoming_ends_at: null,
      known_show_name: null, known_dj_name: null, known_last_aired_at: null,
    });
    executeMock.mockResolvedValueOnce({ rows: [row("fresh", true), row("stale", false)] });

    const response = await request(app).get("/explore?mode=newness");

    expect(response.status).toBe(200);
    expect(response.body.stations.map((item: { station: { slug: string } }) => item.station.slug)).toEqual(["fresh"]);
  });

  it("serves the unified All catalog with explicit specialist decade tags", async () => {
    executeMock.mockResolvedValue({ rows: [
      {
        slug: "tagged-eighties", name: "Tagged Eighties", org: null, city: "San Francisco", region: "CA", country: "US",
        latitude: 37.77, longitude: -122.42, location_source: "curated", location_confidence: "verified",
        stream_url: "https://example.test/eighties", active: true, hidden: false, crossing_eligible: true,
        station_class: "curated", tags: ["specialist", "electronic", "decade-1980s"], era_genre_mode: true,
        sleep_mode: false, discovery_score: 4, library_crossings: 0, library_artist_crossings: 0,
        live: false, sort_order: 1,
      },
      {
        slug: "track-happens-eighties", name: "Track Happens Eighties", org: null, city: "San Francisco", region: "CA", country: "US",
        latitude: 37.77, longitude: -122.42, location_source: "curated", location_confidence: "verified",
        stream_url: "https://example.test/current", active: true, hidden: false, crossing_eligible: true,
        station_class: "curated", tags: ["specialist", "electronic"], era_genre_mode: true,
        sleep_mode: false, discovery_score: 10, library_crossings: 0, library_artist_crossings: 0,
        live: false, sort_order: 2,
      },
    ] });
    const response = await request(app).get("/explore?lens=all&stationType=specialist&decade=1980s");
    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { station: { slug: string } }) => item.station.slug))
      .toEqual(["tagged-eighties"]);
    expect(response.body.metadata.semantics).toEqual({ withinFamily: "or", betweenFamilies: "and" });
    expect(response.body.metadata.claim).toMatch(/without a personalized ranking claim/);
  });

  it("requires a verified locality for the Local lens", async () => {
    executeMock.mockClear();
    const response = await request(app).get("/explore?lens=local");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_locality");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("keeps exact-track crossings separate from artist-level evidence", async () => {
    getUserMock.mockResolvedValueOnce({ id: 42 } as never);
    executeMock.mockResolvedValueOnce({ rows: [{
      slug: "taste-station", name: "Taste Station", org: null, city: "San Francisco", region: "CA", country: "US",
      latitude: 37.77, longitude: -122.42, location_source: "curated", location_confidence: "verified",
      stream_url: "https://example.test/taste", active: true, hidden: false, crossing_eligible: true,
      station_class: "curated", tags: [], era_genre_mode: false, sleep_mode: false, discovery_score: 1,
      library_crossings: 2, library_artist_crossings: 3, live: false, sort_order: 1,
    }] });
    const response = await request(app).get("/explore?lens=for-you&sort=live-now");
    expect(response.status).toBe(200);
    expect(response.body.items[0].evidence).toMatchObject({
      libraryCrossings: 2,
      libraryArtistCrossings: 3,
    });
    const sqlShape = flattenSqlShape(executeMock.mock.calls.at(-1)?.[0]);
    expect(sqlShape).toContain("exact_li.mbid=sp.mbid");
    expect(sqlShape).toContain("r.artist_mbid");
    expect(sqlShape).toContain("taste_seeds");
    expect(sqlShape).toContain("current_spin.observed_at");
    expect(sqlShape).toContain("AS live");
  });

  it("skips latest-track and live evidence on the default All catalog path", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    const response = await request(app).get("/explore?lens=all&limit=4");
    expect(response.status).toBe(200);
    const sqlShape = flattenSqlShape(executeMock.mock.calls.at(-1)?.[0]);
    expect(sqlShape).not.toContain("current_track");
    expect(sqlShape).not.toContain("current_spin");
    expect(sqlShape).not.toContain("LEFT JOIN LATERAL");
    expect(sqlShape).toContain("NULL::text");
    expect(sqlShape).toMatch(/false\s+AS live/);
  });

  it.each([
    ["type=anchor", "invalid_station_type"],
    ["format=not-a-format", "invalid_format"],
    ["decade=1950s", "invalid_decade"],
  ])("rejects unsupported canonical filter values (%s)", async (query, code) => {
    executeMock.mockClear();
    const response = await request(app).get(`/explore?lens=all&${query}`);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(code);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("accepts task-facing core and independent-dj vocabulary", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    const response = await request(app).get("/explore?lens=all&type=core,independent-dj");
    expect(response.status).toBe(200);
    expect(response.body.metadata.filters.stationTypes).toEqual(["core", "independent-dj"]);
  });

  it("applies Bro Zones as an OR family before pagination", async () => {
    executeMock.mockResolvedValue({ rows: [
      {
        slug: "sea", name: "Seattle", tags: [], active: true, hidden: false, crossing_eligible: true,
        stream_url: "https://example.test/sea", era_genre_mode: false, sleep_mode: false,
        latitude: 47.6, longitude: -122.3, location_source: "curated", location_confidence: "verified",
        city: "Seattle", region: "WA", country: "US", discovery_score: 2,
        library_crossings: 0, library_artist_crossings: 0, live: false, sort_order: 1,
        bro_zones: ["seattle"], support: true, followed: false, current_age_tier: null,
      },
      {
        slug: "la", name: "Los Angeles", tags: [], active: true, hidden: false, crossing_eligible: true,
        stream_url: "https://example.test/la", era_genre_mode: false, sleep_mode: false,
        latitude: 34.0, longitude: -118.2, location_source: "curated", location_confidence: "verified",
        city: "Los Angeles", region: "CA", country: "US", discovery_score: 1,
        library_crossings: 0, library_artist_crossings: 0, live: false, sort_order: 2,
        bro_zones: ["los-angeles"], support: false, followed: false, current_age_tier: null,
      },
    ] });
    const response = await request(app).get("/explore?lens=all&zone=seattle,los-angeles&limit=1");
    expect(response.status).toBe(200);
    expect(response.body.metadata.pagination.total).toBe(2);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.metadata.pagination.nextCursor).toBeTruthy();
    const next = await request(app).get(`/explore?lens=all&zone=seattle,los-angeles&limit=1&cursor=${encodeURIComponent(response.body.metadata.pagination.nextCursor)}`);
    expect(next.status).toBe(200);
    expect(next.body.items).toHaveLength(1);
    expect(next.body.items[0].station.slug).not.toBe(response.body.items[0].station.slug);
  });

  it("filters followed results from the complete client-authoritative slug list", async () => {
    executeMock.mockResolvedValueOnce({ rows: [
      {
        slug: "followed", name: "Followed", tags: [], active: true, hidden: false, crossing_eligible: true,
        stream_url: "https://example.test/followed", era_genre_mode: false, sleep_mode: false,
        latitude: null, longitude: null, location_source: null, location_confidence: null,
        city: null, region: null, country: "US", discovery_score: 1,
        library_crossings: 0, library_artist_crossings: 0, live: false, sort_order: 1,
      },
      {
        slug: "not-followed", name: "Not followed", tags: [], active: true, hidden: false, crossing_eligible: true,
        stream_url: "https://example.test/not-followed", era_genre_mode: false, sleep_mode: false,
        latitude: null, longitude: null, location_source: null, location_confidence: null,
        city: null, region: null, country: "US", discovery_score: 2,
        library_crossings: 0, library_artist_crossings: 0, live: false, sort_order: 2,
      },
    ] });
    const response = await request(app).get("/explore?lens=all&followed=1&followedSlugs=followed&limit=30");
    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { station: { slug: string } }) => item.station.slug)).toEqual(["followed"]);
    expect(response.body.items[0].station.followed).toBe(true);
  });

  it("rejects followed-only without a complete authoritative slug list", async () => {
    executeMock.mockClear();
    const response = await request(app).get("/explore?lens=all&followed=1");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("missing_followed_slugs");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("ranks and explains a focused artist with actual artist-specific crossing evidence", async () => {
    getUserMock.mockResolvedValueOnce({ id: 42 } as never);
    executeMock.mockResolvedValueOnce({ rows: [{
      slug: "artist-station", name: "Artist Station", tags: [], active: true, hidden: false, crossing_eligible: true,
      stream_url: "https://example.test/artist", era_genre_mode: false, sleep_mode: false,
      latitude: null, longitude: null, location_source: null, location_confidence: null,
      city: null, region: null, country: "US", discovery_score: 1,
      library_crossings: 0, library_artist_crossings: 0, focused_artist_crossings: 3,
      live: false, sort_order: 1,
    }] });
    const response = await request(app).get("/explore?lens=for-you&artist=The%20Artist");
    expect(response.status).toBe(200);
    expect(response.body.items[0].evidence.focusedArtistCrossings).toBe(3);
    expect(response.body.items[0].explanation).toContain("3 recent plays for The Artist");
    const sqlShape = flattenSqlShape(executeMock.mock.calls.at(-1)?.[0]);
    expect(sqlShape).toContain("focused_recording.artist");
  });
});