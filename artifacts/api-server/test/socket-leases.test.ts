import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import {
  db,
  scrapedShowsTable,
  stationsTable,
  spinsTable,
  recordingsTable,
  loreUsersTable,
  libraryItemsTable,
} from "@workspace/db";
import {
  pickLeaseTargets,
  mergeShowScoped,
  applyFollowBonus,
  normaliseDjName,
  FOLLOW_BONUS,
  scoreCrossingCandidates,
  type ScoredStation,
} from "../src/lore/socket-leases.js";
import { pickWatcherStreamUrl } from "../src/lore/poller.js";

function scored(
  stationId: number,
  score: number,
  crossings = 1,
  extras: Partial<ScoredStation> = {},
): ScoredStation {
  return {
    stationId,
    slug: `s${stationId}`,
    name: `S${stationId}`,
    score,
    crossings,
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// pickLeaseTargets
// ---------------------------------------------------------------------------

describe("pickLeaseTargets", () => {
  it("returns the top-N scorers in score order", () => {
    const out = pickLeaseTargets(
      [scored(1, 0.5), scored(2, 3.2), scored(3, 1.1)],
      2,
    );
    expect(out.map((s) => s.stationId)).toEqual([2, 3]);
  });

  it("never leases zero- or negative-score stations even with free slots", () => {
    const out = pickLeaseTargets([scored(1, 0), scored(2, 2)], 10);
    expect(out.map((s) => s.stationId)).toEqual([2]);
  });

  it("returns empty when there are no spare slots", () => {
    expect(pickLeaseTargets([scored(1, 5)], 0)).toEqual([]);
    expect(pickLeaseTargets([scored(1, 5)], -3)).toEqual([]);
  });

  it("breaks score ties deterministically by station id", () => {
    const out = pickLeaseTargets([scored(9, 1), scored(4, 1), scored(7, 1)], 2);
    expect(out.map((s) => s.stationId)).toEqual([4, 7]);
  });

  it("does not mutate the input array", () => {
    const input = [scored(1, 1), scored(2, 9)];
    pickLeaseTargets(input, 1);
    expect(input.map((s) => s.stationId)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// pickWatcherStreamUrl
// ---------------------------------------------------------------------------

describe("pickWatcherStreamUrl", () => {
  it("prefers the lowest-bitrate mount when mounts are advertised", () => {
    expect(
      pickWatcherStreamUrl({
        streamUrl: "http://x/hi",
        mounts: [
          { url: "http://x/320", bitrate: 320 },
          { url: "http://x/64", bitrate: 64 },
          { url: "http://x/128", bitrate: 128 },
        ],
      }),
    ).toBe("http://x/64");
  });

  it("falls back to the first mount when no bitrates are known", () => {
    expect(
      pickWatcherStreamUrl({
        mounts: [{ url: "http://x/a" }, { url: "http://x/b" }],
      }),
    ).toBe("http://x/a");
  });

  it("ignores malformed mount entries", () => {
    expect(
      pickWatcherStreamUrl({
        streamUrl: "http://x/plain",
        mounts: [null, {}, { url: "" }],
      }),
    ).toBe("http://x/plain");
  });

  it("uses streamUrl when no mounts exist and null when nothing is usable", () => {
    expect(pickWatcherStreamUrl({ streamUrl: "http://x/s" })).toBe("http://x/s");
    expect(pickWatcherStreamUrl({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeShowScoped
// ---------------------------------------------------------------------------

describe("mergeShowScoped", () => {
  it("leaves stations untouched when showScopedMap is empty", () => {
    const base = [scored(1, 5.0, 10), scored(2, 2.0, 4)];
    const result = mergeShowScoped(base, new Map());
    expect(result).toEqual(base);
  });

  it("replaces score and crossings for a matched station", () => {
    const base = [scored(1, 5.0, 10)];
    const scopedMap = new Map([
      [1, { score: 2.5, crossings: 3, activeDj: "DJ Soma" }],
    ]);
    const [r] = mergeShowScoped(base, scopedMap);
    expect(r!.score).toBe(2.5);
    expect(r!.crossings).toBe(3);
    expect(r!.scopedToShow).toBe(true);
    expect(r!.activeDj).toBe("DJ Soma");
  });

  it("marks the replaced entry as show-scoped", () => {
    const base = [scored(1, 5.0, 10)];
    const scopedMap = new Map([
      [1, { score: 2.5, crossings: 3, activeDj: null }],
    ]);
    const [r] = mergeShowScoped(base, scopedMap);
    expect(r!.scopedToShow).toBe(true);
  });

  it("does NOT replace when show-scoped crossings are zero", () => {
    const base = [scored(1, 5.0, 10)];
    const scopedMap = new Map([
      [1, { score: 0.1, crossings: 0, activeDj: "DJ Zero" }],
    ]);
    const [r] = mergeShowScoped(base, scopedMap);
    // Station-wide values must be preserved.
    expect(r!.score).toBe(5.0);
    expect(r!.crossings).toBe(10);
    expect(r!.scopedToShow).toBeUndefined();
  });

  it("a station whose current show has crossings outranks the same station scored station-wide with more crossings", () => {
    // Station 1: station-wide score 8, but show-scoped score is only 3.
    // Station 2: station-wide score 5, no show context.
    // After merge, station 1 drops to 3 and station 2 stays at 5.
    // pickLeaseTargets should then prefer station 2.
    const base = [scored(1, 8.0, 20), scored(2, 5.0, 8)];
    const scopedMap = new Map([
      [1, { score: 3.0, crossings: 4, activeDj: "Night DJ" }],
    ]);
    const merged = mergeShowScoped(base, scopedMap);
    const targets = pickLeaseTargets(merged, 1);
    expect(targets[0]!.stationId).toBe(2);
  });

  it("a station whose current show has MORE crossings than the station-wide average wins the lease", () => {
    // Station 1: station-wide score 5 — but its current show is unusually
    // good and has a show-scoped score of 12.
    // Station 2: station-wide score 9 — no active show.
    // After merge, station 1 should win with score 12.
    const base = [scored(1, 5.0, 8), scored(2, 9.0, 15)];
    const scopedMap = new Map([
      [1, { score: 12.0, crossings: 10, activeDj: "Peak Show" }],
    ]);
    const merged = mergeShowScoped(base, scopedMap);
    const targets = pickLeaseTargets(merged, 1);
    expect(targets[0]!.stationId).toBe(1);
  });

  it("preserves other fields (slug, name) when replacing", () => {
    const base = [scored(42, 1.0, 2)];
    const scopedMap = new Map([
      [42, { score: 5.0, crossings: 7, activeDj: "Mix" }],
    ]);
    const [r] = mergeShowScoped(base, scopedMap);
    expect(r!.slug).toBe("s42");
    expect(r!.name).toBe("S42");
  });
});

// ---------------------------------------------------------------------------
// normaliseDjName
// ---------------------------------------------------------------------------

describe("normaliseDjName", () => {
  it("lowercases and collapses non-alphanumeric runs to spaces", () => {
    expect(normaliseDjName("DJ Snake")).toBe("dj snake");
    expect(normaliseDjName("dj-snake")).toBe("dj snake");
    expect(normaliseDjName("DJ  SNAKE")).toBe("dj snake");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normaliseDjName("  DJ Snake  ")).toBe("dj snake");
  });

  it("handles an empty string", () => {
    expect(normaliseDjName("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// applyFollowBonus
// ---------------------------------------------------------------------------

describe("applyFollowBonus", () => {
  it("applies FOLLOW_BONUS to a station whose active DJ is followed", () => {
    const stations = [
      scored(1, 4.0, 5, { activeDj: "DJ Mora", scopedToShow: true }),
    ];
    const follows = new Set([normaliseDjName("DJ Mora")]);
    const [r] = applyFollowBonus(stations, follows);
    expect(r!.score).toBe(4.0 * FOLLOW_BONUS);
  });

  it("matching is case-insensitive and punctuation-tolerant", () => {
    const stations = [
      scored(1, 2.0, 3, { activeDj: "DJ Mora", scopedToShow: true }),
    ];
    // Follow stored as 'dj mora' (already normalised)
    const follows = new Set(["dj mora"]);
    const [r] = applyFollowBonus(stations, follows);
    expect(r!.score).toBe(2.0 * FOLLOW_BONUS);
  });

  it("does NOT boost a station with score === 0", () => {
    const stations = [
      scored(1, 0, 0, { activeDj: "DJ Mora", scopedToShow: true }),
    ];
    const follows = new Set([normaliseDjName("DJ Mora")]);
    const [r] = applyFollowBonus(stations, follows);
    expect(r!.score).toBe(0);
  });

  it("does NOT boost a station with no activeDj", () => {
    const stations = [scored(1, 5.0, 8, { scopedToShow: true })];
    const follows = new Set(["dj mora"]);
    const [r] = applyFollowBonus(stations, follows);
    expect(r!.score).toBe(5.0);
  });

  it("leaves unmatched stations unchanged", () => {
    const stations = [
      scored(1, 3.0, 5, { activeDj: "DJ Other", scopedToShow: true }),
    ];
    const follows = new Set([normaliseDjName("DJ Mora")]);
    const [r] = applyFollowBonus(stations, follows);
    expect(r!.score).toBe(3.0);
  });

  it("is a no-op when followedDjNames is empty", () => {
    const stations = [
      scored(1, 4.0, 5, { activeDj: "DJ Mora", scopedToShow: true }),
    ];
    const result = applyFollowBonus(stations, new Set());
    expect(result).toBe(stations); // same reference — no allocation
  });

  it("followed station wins lease over an otherwise higher-scoring unfollowed station", () => {
    const stations = [
      scored(1, 6.0, 10, { activeDj: "DJ Followed", scopedToShow: true }),
      scored(2, 8.0, 15),
    ];
    const follows = new Set([normaliseDjName("DJ Followed")]);
    const boosted = applyFollowBonus(stations, follows);
    const targets = pickLeaseTargets(boosted, 1);
    expect(targets[0]!.stationId).toBe(1);
  });

  it("does not mutate the original array or objects", () => {
    const original: ScoredStation = scored(1, 4.0, 5, {
      activeDj: "DJ Mora",
      scopedToShow: true,
    });
    const stations = [original];
    const follows = new Set([normaliseDjName("DJ Mora")]);
    applyFollowBonus(stations, follows);
    expect(original.score).toBe(4.0);
  });
});

// ---------------------------------------------------------------------------
// DB integration tests — scoreCrossingCandidates()
// ---------------------------------------------------------------------------
//
// Self-skip when the database is unavailable (same pattern as for-you.test.ts).
// Seeds two stations and a shared library item, then calls the real SQL path.
//
// Unique identifiers keyed on `run` prevent inter-test collisions even when
// parallel test workers share the same database.

const run = randomUUID().slice(0, 8);
let dbAvailable = false;

// Shared test data ids — populated in beforeAll, cleaned up in afterAll.
let testUserId: number | null = null;
let stAId: number | null = null;
let stBId: number | null = null;
let stCId: number | null = null;
const MBID_SHARED = `test-sl-mbid-${run}`;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  // A minimal lore_user is required as the FK anchor for library_items.
  const [userRow] = await db
    .insert(loreUsersTable)
    .values({ spotifyUserId: `test-sl-user-${run}` })
    .returning({ id: loreUsersTable.id });
  testUserId = userRow!.id;

  // Shared recording — the MBID that appears in both library_items and spins.
  await db
    .insert(recordingsTable)
    .values({ mbid: MBID_SHARED, title: "Test Track SL", artist: "Test Artist SL" })
    .onConflictDoNothing();

  // Put the MBID in the shared library pool so spins count as crossings.
  await db
    .insert(libraryItemsTable)
    .values({ userId: testUserId!, mbid: MBID_SHARED, provenance: { kind: "import" } })
    .onConflictDoNothing();

  // ── Station A: radio_browser_icy with a currently-airing show ─────────────
  // Has 3 spins in the current UTC day → show-scoped crossing count = 3.
  const [rowA] = await db
    .insert(stationsTable)
    .values({
      slug: `test-sl-sta-${run}`,
      name: `SL Station A ${run}`,
      streamUrl: `http://test-sl-a-${run}.stream`,
      streamFormat: "mp3",
      nowPlayingSource: "radio_browser_icy",
      // now_playing_config must carry a streamUrl so pickWatcherStreamUrl
      // returns non-null and the station isn't filtered out of stationBase.
      nowPlayingConfig: { streamUrl: `http://test-sl-a-${run}.stream` },
      ianaTimezone: "UTC",
      active: true,
      hidden: false,
      favorite: false,
    })
    .returning({ id: stationsTable.id });
  stAId = rowA!.id;

  // Scraped show that covers the entire current UTC day so it is always
  // "currently airing" regardless of when the test runs.
  await db
    .insert(scrapedShowsTable)
    .values({
      stationId: stAId!,
      showName: "All Day Show",
      dayOfWeek: await getCurrentUtcDayAbbrev(),
      startTime: "00:00",
      endTime: "23:59",
      djName: "DJ Integration",
    })
    .onConflictDoNothing();

  // Three spins today (within the show window).
  for (let i = 0; i < 3; i++) {
    await db.execute(sql`
      INSERT INTO spins (station_id, mbid, raw_title, raw_artist, confidence, played_at)
      VALUES (
        ${stAId},
        ${MBID_SHARED},
        'Test Track SL',
        'Test Artist SL',
        'text',
        now() - make_interval(mins => ${i + 1})
      )
      ON CONFLICT DO NOTHING
    `);
  }

  // ── Station B: radio_browser_icy, no scraped show, 1 spin ─────────────────
  // Its station-wide score is lower than A's show-scoped score.
  const [rowB] = await db
    .insert(stationsTable)
    .values({
      slug: `test-sl-stb-${run}`,
      name: `SL Station B ${run}`,
      streamUrl: `http://test-sl-b-${run}.stream`,
      streamFormat: "mp3",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: { streamUrl: `http://test-sl-b-${run}.stream` },
      ianaTimezone: "UTC",
      active: true,
      hidden: false,
      favorite: false,
    })
    .returning({ id: stationsTable.id });
  stBId = rowB!.id;

  await db.execute(sql`
    INSERT INTO spins (station_id, mbid, raw_title, raw_artist, confidence, played_at)
    VALUES (
      ${stBId},
      ${MBID_SHARED},
      'Test Track SL',
      'Test Artist SL',
      'text',
      now() - make_interval(mins => 10)
    )
    ON CONFLICT DO NOTHING
  `);

  // ── Station C: radio_browser_icy, has a show, but all library spins are
  //    from 36 hours ago (yesterday's day_of_week) — so the show-scoped query
  //    finds zero crossings and the station falls back to its station-wide
  //    score (which is nonzero because the 60-day station-wide query sees them).
  const [rowC] = await db
    .insert(stationsTable)
    .values({
      slug: `test-sl-stc-${run}`,
      name: `SL Station C ${run}`,
      streamUrl: `http://test-sl-c-${run}.stream`,
      streamFormat: "mp3",
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: { streamUrl: `http://test-sl-c-${run}.stream` },
      ianaTimezone: "UTC",
      active: true,
      hidden: false,
      favorite: false,
    })
    .returning({ id: stationsTable.id });
  stCId = rowC!.id;

  // Show is currently airing (today, whole day).
  await db
    .insert(scrapedShowsTable)
    .values({
      stationId: stCId!,
      showName: "Zero Window Show",
      dayOfWeek: await getCurrentUtcDayAbbrev(),
      startTime: "00:00",
      endTime: "23:59",
      djName: "DJ Zero Window",
    })
    .onConflictDoNothing();

  // Spins are from 36 h ago → different calendar day in UTC → not in today's
  // show window → show-scoped crossings = 0 → station-wide fallback applies.
  for (let i = 0; i < 2; i++) {
    await db.execute(sql`
      INSERT INTO spins (station_id, mbid, raw_title, raw_artist, confidence, played_at)
      VALUES (
        ${stCId},
        ${MBID_SHARED},
        'Test Track SL',
        'Test Artist SL',
        'text',
        now() - make_interval(hours => ${36 + i})
      )
      ON CONFLICT DO NOTHING
    `);
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    const stationIds = [stAId, stBId, stCId].filter((id): id is number => id !== null);
    if (stationIds.length) {
      await db.execute(
        sql`DELETE FROM scraped_shows WHERE station_id = ANY(ARRAY[${sql.join(stationIds.map((id) => sql`${id}`), sql`, `)}]::int[])`,
      );
      await db.execute(
        sql`DELETE FROM spins WHERE station_id = ANY(ARRAY[${sql.join(stationIds.map((id) => sql`${id}`), sql`, `)}]::int[])`,
      );
      for (const id of stationIds) {
        await db.delete(stationsTable).where(eq(stationsTable.id, id));
      }
    }
    if (testUserId !== null) {
      await db
        .delete(libraryItemsTable)
        .where(eq(libraryItemsTable.userId, testUserId));
      await db
        .delete(loreUsersTable)
        .where(eq(loreUsersTable.id, testUserId));
    }
    await db
      .delete(recordingsTable)
      .where(eq(recordingsTable.mbid, MBID_SHARED));
  } catch {
    // best-effort cleanup
  }
});

/** Query Postgres for the current UTC day abbreviation ("Mon", "Tue", …). */
async function getCurrentUtcDayAbbrev(): Promise<string> {
  const result = await db.execute<{ day: string }>(
    sql`SELECT to_char(now() AT TIME ZONE 'UTC', 'Dy') AS day`,
  );
  return result.rows[0]!.day;
}

describe("scoreCrossingCandidates — DB integration", () => {
  it("station with an active show and show-scoped crossings outranks plain station-wide scorer", async () => {
    if (!dbAvailable) return;

    const candidates = await scoreCrossingCandidates();

    const a = candidates.find((s) => s.stationId === stAId);
    const b = candidates.find((s) => s.stationId === stBId);

    // Both stations must be present in the scored output.
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();

    // Station A was scored against its active show's time window.
    expect(a!.scopedToShow).toBe(true);
    expect(a!.activeDj).toBe("DJ Integration");
    expect(a!.crossings).toBe(3);

    // Station B has no show context — station-wide score only.
    expect(b!.scopedToShow).toBeUndefined();
    expect(b!.crossings).toBe(1);

    // Station A's show-scoped score must beat station B's station-wide score.
    expect(a!.score).toBeGreaterThan(b!.score);

    // Lease allocator should therefore pick A over B in a single-slot budget.
    const targets = pickLeaseTargets([a!, b!], 1);
    expect(targets[0]!.stationId).toBe(stAId);
  });

  it("station whose current show has no library history keeps its station-wide score (zero-crossing fallback)", async () => {
    if (!dbAvailable) return;

    const candidates = await scoreCrossingCandidates();

    const c = candidates.find((s) => s.stationId === stCId);

    // Station C must appear: it has 2 station-wide library crossings.
    expect(c).toBeTruthy();

    // The show window had zero crossings, so mergeShowScoped left the
    // station-wide values intact — scopedToShow must NOT be set.
    expect(c!.scopedToShow).toBeUndefined();

    // Station-wide score is positive (real crossings within 60-day window).
    expect(c!.score).toBeGreaterThan(0);
    expect(c!.crossings).toBeGreaterThanOrEqual(2);
  });
});
