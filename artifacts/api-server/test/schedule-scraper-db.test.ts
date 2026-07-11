// @vitest-environment node
/**
 * Integration tests for scrapeStationSchedule — the full path from
 * "fetch schedule page" through "LLM extraction" through "DB write".
 *
 * External I/O is stubbed via the injectable `fetchFn` option and the
 * `configureScheduleExtractor` seam; the real DB is required and the
 * suite self-skips when no connection is available.
 *
 * Three paths are exercised:
 *   1. scheduleUrl direct-fetch (new code) — homepage is never fetched.
 *   2. scheduleUrl fails → falls back to homepage + link discovery.
 *   3. No scheduleUrl → homepage + link discovery (existing path).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, stationsTable, scrapedShowsTable } from "@workspace/db";
import { scrapeStationSchedule } from "../src/lore/schedule-scraper.js";
import {
  configureScheduleExtractor,
  resetScheduleExtractor,
} from "../src/lore/schedule-llm.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SHOWS_JSON = JSON.stringify([
  {
    showName: "Morning Jazz",
    dayOfWeek: "Mon",
    startTime: "08:00",
    endTime: "10:00",
    djName: "DJ Alice",
  },
  {
    showName: "Afternoon Blues",
    dayOfWeek: "Tue",
    startTime: "14:00",
    endTime: "16:00",
    djName: null,
  },
]);

/**
 * Minimal fetch stub. Patterns are checked in order (first-match wins);
 * string patterns are matched as URL substrings, RegExp via .test().
 * Any unmatched URL gets a 404.
 */
function makeFetch(
  responses: Array<{
    pattern: string | RegExp;
    body: string;
    ok?: boolean;
    status?: number;
  }>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const r of responses) {
      const hit =
        r.pattern instanceof RegExp
          ? r.pattern.test(url)
          : url.includes(r.pattern);
      if (hit) {
        const ok = r.ok ?? true;
        return {
          ok,
          status: r.status ?? (ok ? 200 : 404),
          statusText: ok ? "OK" : "Not Found",
          text: async () => r.body,
          json: async () => ({}),
          headers: new Headers(),
        } as Response;
      }
    }
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
      json: async () => ({}),
      headers: new Headers(),
    } as Response;
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------

const run = randomUUID().slice(0, 8);
let dbAvailable = false;
let stationId: number | undefined;

const HOMEPAGE = "http://radio.example.test";
const SCHEDULE_URL = `${HOMEPAGE}/schedule`;
const STREAM_URL = `${HOMEPAGE}/stream`;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [row] = await db
    .insert(stationsTable)
    .values({
      slug: `test-sched-${run}`,
      name: `Schedule Test Station ${run}`,
      streamUrl: STREAM_URL,
      homepageUrl: HOMEPAGE,
      stationClass: "curated",
    })
    .returning({ id: stationsTable.id });

  stationId = row!.id;
});

afterAll(async () => {
  if (!dbAvailable || stationId === undefined) return;
  // FK order: scraped_shows before stations.
  await db
    .delete(scrapedShowsTable)
    .where(eq(scrapedShowsTable.stationId, stationId));
  await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
});

afterEach(async () => {
  // Reset LLM extractor between tests so each test installs its own.
  resetScheduleExtractor();

  // Wipe scraped rows and reset freshness stamps so tests start clean.
  if (dbAvailable && stationId !== undefined) {
    await db
      .delete(scrapedShowsTable)
      .where(eq(scrapedShowsTable.stationId, stationId));
    await db
      .update(stationsTable)
      .set({
        scheduleScrapedAt: null,
        scheduleAttemptedAt: null,
        upcomingShowCount: 0,
      })
      .where(eq(stationsTable.id, stationId!));
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-read the station row from DB to inspect freshness stamps. */
async function fetchStationRow() {
  const [row] = await db
    .select({
      scheduleScrapedAt: stationsTable.scheduleScrapedAt,
      scheduleAttemptedAt: stationsTable.scheduleAttemptedAt,
      upcomingShowCount: stationsTable.upcomingShowCount,
    })
    .from(stationsTable)
    .where(eq(stationsTable.id, stationId!));
  return row;
}

/** Read all scraped shows for the test station. */
async function fetchScrapedShows() {
  return db
    .select()
    .from(scrapedShowsTable)
    .where(eq(scrapedShowsTable.stationId, stationId!));
}

// ---------------------------------------------------------------------------
// Path 1 — pre-known scheduleUrl fetched directly; homepage never touched
// ---------------------------------------------------------------------------

describe("scrapeStationSchedule — scheduleUrl direct-fetch path", () => {
  it("stores shows and stamps scheduleScrapedAt when scheduleUrl returns a valid page", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    configureScheduleExtractor(async () => VALID_SHOWS_JSON);

    const fetchFn = makeFetch([
      // robots.txt: permissive
      { pattern: "robots.txt", body: "User-agent: *\nDisallow: /private\n" },
      // schedule page: HTML with schedule data (content doesn't matter — LLM is stubbed)
      {
        pattern: "/schedule",
        body: "<html><body><p>Morning Jazz Mon 8-10am DJ Alice</p></body></html>",
      },
      // homepage: must NOT be needed — return an error so the test would fail
      // loudly if the scraper mistakenly fetches it.
      { pattern: HOMEPAGE, body: "", ok: false, status: 500 },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    expect(result).toEqual({ scraped: true, showCount: 2 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(2);
    expect(shows.map((s) => s.showName).sort()).toEqual([
      "Afternoon Blues",
      "Morning Jazz",
    ]);

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.scheduleAttemptedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(2);
  });

  it("does not fetch the homepage at all when scheduleUrl succeeds", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    configureScheduleExtractor(async () => VALID_SHOWS_JSON);

    const fetchFn = makeFetch([
      { pattern: "robots.txt", body: "User-agent: *\nDisallow: /private\n" },
      { pattern: "/schedule", body: "<html><body>schedule page</body></html>" },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
    };

    await scrapeStationSchedule(target, { fetchFn });

    // fetchFn calls: robots.txt + schedule page only — NOT the bare homepage.
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => String(c[0]),
    );
    const homepageCalls = calls.filter(
      (u) => u === HOMEPAGE || u === `${HOMEPAGE}/`,
    );
    expect(homepageCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Path 2 — pre-known scheduleUrl fails → fallback to homepage
// ---------------------------------------------------------------------------

describe("scrapeStationSchedule — scheduleUrl fails → homepage fallback", () => {
  it("falls back to homepage when scheduleUrl returns a non-ok response, then stores shows", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    configureScheduleExtractor(async () => VALID_SHOWS_JSON);

    const fetchFn = makeFetch([
      { pattern: "robots.txt", body: "User-agent: *\nDisallow: /private\n" },
      // scheduleUrl: fails
      { pattern: "/schedule", body: "", ok: false, status: 404 },
      // homepage: a bare page with no schedule link (content is passed to LLM)
      {
        pattern: HOMEPAGE,
        body: "<html><body><p>Welcome to the station</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Scraper fell back to homepage and extraction succeeded.
    expect(result).toEqual({ scraped: true, showCount: 2 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(2);

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(2);
  });

  it("stamps scheduleAttemptedAt even when scheduleUrl fails and homepage also fails", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // LLM extractor not configured — should not be reached because homepage 404s.
    const fetchFn = makeFetch([
      { pattern: "robots.txt", body: "User-agent: *\nDisallow: /private\n" },
      { pattern: "/schedule", body: "", ok: false, status: 404 },
      { pattern: HOMEPAGE, body: "", ok: false, status: 503 },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    expect(result).toEqual({ scraped: false, showCount: 0 });

    // scheduleAttemptedAt must be stamped even on total failure.
    const station = await fetchStationRow();
    expect(station?.scheduleAttemptedAt).toBeInstanceOf(Date);
    // scheduleScrapedAt must remain null (no successful scrape).
    expect(station?.scheduleScrapedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Path 3 — no scheduleUrl → homepage + link-discovery (existing path)
// ---------------------------------------------------------------------------

describe("scrapeStationSchedule — homepage + link-discovery path", () => {
  it("follows a discovered schedule link and stores shows", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    configureScheduleExtractor(async () => VALID_SHOWS_JSON);

    const fetchFn = makeFetch([
      { pattern: "robots.txt", body: "User-agent: *\nDisallow: /private\n" },
      // Homepage contains a link to /schedule
      {
        pattern: HOMEPAGE,
        body: `<html><body>
          <a href="/schedule">Programming Schedule</a>
        </body></html>`,
      },
      // The discovered schedule page
      {
        pattern: "/schedule",
        body: "<html><body><p>Afternoon Blues Tue 2-4pm</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    expect(result).toEqual({ scraped: true, showCount: 2 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(2);

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(2);
  });

  it("stores shows from the homepage itself when no schedule link is found", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    configureScheduleExtractor(async () =>
      JSON.stringify([
        {
          showName: "Late Night Session",
          dayOfWeek: "Fri",
          startTime: "22:00",
          endTime: "23:59",
          djName: "DJ Night Owl",
        },
      ]),
    );

    const fetchFn = makeFetch([
      { pattern: "robots.txt", body: "User-agent: *\nDisallow: /private\n" },
      // Homepage with no schedule link
      {
        pattern: HOMEPAGE,
        body: "<html><body><p>Late Night Session every Friday 10pm DJ Night Owl</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    expect(result).toEqual({ scraped: true, showCount: 1 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Late Night Session");
  });
});
