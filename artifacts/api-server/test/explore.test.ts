import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { execute: executeMock } }));
vi.mock("../src/lore/userSession.js", () => ({ getUserForListenerRead: vi.fn(async () => null) }));

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
    executeMock.mockResolvedValueOnce({ rows: [
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
});