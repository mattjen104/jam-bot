import { describe, it, expect } from "vitest";
import {
  buildWrappedStats,
  parseSchedule,
  toSqliteUtc,
} from "../src/wrapped.js";
import { buildDnaStats, buildCompatStats } from "../src/dna.js";
import { isMemoryPlaybackRequest } from "../src/memory.js";
import { db, recordPlayed, setOptOut } from "../src/db.js";
import { parseBoolEnv } from "../src/config.js";

function uniq(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

// Tests share the test DATABASE_PATH set in test/setup.ts. We scope each test
// to its own track_id prefixes / users to avoid cross-test interference.

describe("toSqliteUtc + parseSchedule", () => {
  it("formats a date as the SQLite UTC string", () => {
    const d = new Date(Date.UTC(2025, 0, 7, 8, 5, 9));
    expect(toSqliteUtc(d)).toBe("2025-01-07 08:05:09");
  });
  it("parses Sun 20:00 schedule", () => {
    expect(parseSchedule("Sun 20:00")).toEqual({
      dayOfWeek: 0,
      hour: 20,
      minute: 0,
    });
  });
  it("rejects malformed schedules", () => {
    expect(parseSchedule("Funday 20:00")).toBeNull();
    expect(parseSchedule("Sun 25:00")).toBeNull();
    expect(parseSchedule("Sun 20:99")).toBeNull();
    expect(parseSchedule("garbage")).toBeNull();
  });
});

describe("buildWrappedStats", () => {
  it("aggregates plays across users into top tracks, artists, and per-user stats", () => {
    const userA = uniq("Uw_A");
    const userB = uniq("Uw_B");
    const tracksA = ["wt-a-1", "wt-a-1", "wt-a-1", "wt-a-2", "wt-a-3"];
    const tracksB = ["wt-b-1", "wt-b-2", "wt-a-1"];
    for (const id of tracksA) {
      recordPlayed({
        track_id: uniq(id),
        title: id === "wt-a-1" ? "A1" : id === "wt-a-2" ? "A2" : "A3",
        artist: "ArtistA",
        requested_by_slack_user: userA,
      });
    }
    for (const id of tracksB) {
      recordPlayed({
        track_id: uniq(id),
        title: "TitleB",
        artist: "ArtistB",
        requested_by_slack_user: userB,
      });
    }

    const stats = buildWrappedStats(7);
    const userAStats = stats.perUser.find((u) => u.slackUser === userA);
    const userBStats = stats.perUser.find((u) => u.slackUser === userB);
    expect(userAStats?.plays).toBe(5);
    expect(userBStats?.plays).toBe(3);
    expect(userAStats?.topArtist).toBe("ArtistA");
    expect(userBStats?.topArtist).toBe("ArtistB");
    expect(stats.topArtists.find((a) => a.artist === "ArtistA")).toBeDefined();
    expect(stats.totalPlays).toBeGreaterThanOrEqual(8);
  });

  it("totalPlays is a direct COUNT(*), accurate beyond the top-N tracks", () => {
    const u = uniq("Uw_count");
    // Insert 12 distinct track_ids — more than the top-N=5 the recap shows.
    // The old heuristic (sum-of-user-plays + delta-from-top-5) would not see
    // tracks 6..12 at all and would undercount; the new direct COUNT(*) does.
    for (let i = 0; i < 12; i++) {
      recordPlayed({
        track_id: uniq(`count-${i}`),
        title: `T${i}`,
        artist: "ArtistC",
        requested_by_slack_user: u,
      });
    }
    const stats = buildWrappedStats(7);
    expect(stats.totalPlays).toBeGreaterThanOrEqual(12);
  });

  it("respects opt-out — user appears with optedOut=true and no personal stats", () => {
    const userOpt = uniq("Uw_opt");
    recordPlayed({
      track_id: uniq("opt-1"),
      title: "T",
      artist: "Artist",
      requested_by_slack_user: userOpt,
    });
    setOptOut(userOpt, true);
    const stats = buildWrappedStats(7);
    const u = stats.perUser.find((x) => x.slackUser === userOpt);
    expect(u?.optedOut).toBe(true);
    expect(u?.topArtist).toBeNull();
    expect(u?.topTrack).toBeNull();
    setOptOut(userOpt, false);
  });
});

describe("buildDnaStats", () => {
  it("returns top artists, signature track, and discovery rate for a user", () => {
    const u = uniq("Ud");
    const id1 = uniq("dna-1");
    recordPlayed({ track_id: id1, title: "T1", artist: "ArtistX", requested_by_slack_user: u });
    recordPlayed({ track_id: id1, title: "T1", artist: "ArtistX", requested_by_slack_user: u });
    recordPlayed({ track_id: uniq("dna-2"), title: "T2", artist: "ArtistY", requested_by_slack_user: u });
    const dna = buildDnaStats(u);
    expect(dna.totalPlays).toBe(3);
    expect(dna.topArtists[0]?.artist).toBe("ArtistX");
    expect(dna.signatureTrack?.track_id).toBe(id1);
    expect(dna.signatureTrack?.plays).toBe(2);
    expect(dna.discoveryRate).toBeGreaterThan(0);
  });
  it("handles a user with no plays", () => {
    const dna = buildDnaStats(uniq("Ud_empty"));
    expect(dna.totalPlays).toBe(0);
    expect(dna.discoveryRate).toBe(0);
    expect(dna.topArtists).toEqual([]);
    expect(dna.signatureTrack).toBeNull();
  });
});

describe("buildCompatStats", () => {
  it("scores two users with overlapping artists higher than disjoint ones", () => {
    const a = uniq("Uc_a");
    const b = uniq("Uc_b");
    recordPlayed({ track_id: uniq("c-a-1"), title: "T", artist: "Shared", requested_by_slack_user: a });
    recordPlayed({ track_id: uniq("c-a-2"), title: "T", artist: "OnlyA", requested_by_slack_user: a });
    recordPlayed({ track_id: uniq("c-b-1"), title: "T", artist: "Shared", requested_by_slack_user: b });
    recordPlayed({ track_id: uniq("c-b-2"), title: "T", artist: "OnlyB", requested_by_slack_user: b });
    const stats = buildCompatStats(a, b);
    expect(stats.sharedArtists).toContain("Shared");
    expect(stats.score).toBeGreaterThan(0);
    expect(stats.score).toBeLessThanOrEqual(100);
    // Component scores all lie in [0, 1].
    expect(stats.artistJaccard).toBeGreaterThan(0);
    expect(stats.artistJaccard).toBeLessThanOrEqual(1);
    expect(stats.artistCosine).toBeGreaterThanOrEqual(0);
    expect(stats.artistCosine).toBeLessThanOrEqual(1);
    expect(stats.timeOfDayOverlap).toBeGreaterThanOrEqual(0);
    expect(stats.timeOfDayOverlap).toBeLessThanOrEqual(1);
  });
  it("recommends a track from B that A hasn't played", () => {
    const a = uniq("Uc2_a");
    const b = uniq("Uc2_b");
    const sharedTrack = uniq("c2-shared");
    recordPlayed({ track_id: sharedTrack, title: "Shared", artist: "X", requested_by_slack_user: a });
    recordPlayed({ track_id: sharedTrack, title: "Shared", artist: "X", requested_by_slack_user: b });
    const bOnly = uniq("c2-bonly");
    recordPlayed({ track_id: bOnly, title: "BOnly", artist: "X", requested_by_slack_user: b });
    recordPlayed({ track_id: bOnly, title: "BOnly", artist: "X", requested_by_slack_user: b });
    const stats = buildCompatStats(a, b);
    expect(stats.recommendForA[0]?.track_id).toBe(bOnly);
  });
});

describe("isMemoryPlaybackRequest", () => {
  it("matches play/queue-a-set style requests", () => {
    expect(isMemoryPlaybackRequest("play me a set of last weekend's vibes")).toBe(true);
    expect(isMemoryPlaybackRequest("queue a 5 song mix from August")).toBe(true);
    expect(isMemoryPlaybackRequest("play some songs we played last friday")).toBe(true);
  });
  it("does NOT match recall-only questions", () => {
    expect(isMemoryPlaybackRequest("who introduced us to Khruangbin?")).toBe(false);
    expect(isMemoryPlaybackRequest("how many times have we played Daft Punk?")).toBe(false);
  });
});

describe("parseBoolEnv", () => {
  it("treats the string \"false\" (and friends) as false — fixes the z.coerce.boolean bug", () => {
    for (const v of ["false", "FALSE", "False", "0", "no", "off", ""]) {
      expect(parseBoolEnv(v)).toBe(false);
    }
  });
  it("treats the string \"true\" (and unknowns) as true", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on", "anythingelse"]) {
      expect(parseBoolEnv(v)).toBe(true);
    }
  });
  it("passes booleans through unchanged", () => {
    expect(parseBoolEnv(true)).toBe(true);
    expect(parseBoolEnv(false)).toBe(false);
  });
  it("handles null/undefined as false", () => {
    expect(parseBoolEnv(null)).toBe(false);
    expect(parseBoolEnv(undefined)).toBe(false);
  });
});

// Smoke test that db is wired (catches schema regressions on user_optouts).
describe("db schema", () => {
  it("has a user_optouts table", () => {
    const row = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='user_optouts'`,
      )
      .get();
    expect(row?.name).toBe("user_optouts");
  });
});
