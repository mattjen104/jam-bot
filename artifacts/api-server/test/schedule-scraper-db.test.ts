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
        // Reset any scheduleUrl written by probe-path tests so subsequent
        // tests start with a clean slate and don't skip discovery.
        scheduleUrl: null,
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
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow: /private\n" },
      // Homepage with no schedule link — anchored so probe paths like /schedule
      // don't accidentally match and exercise strategy 2 instead of strategy 3.
      // Body includes ≥3 day abbreviations and ≥2 HH:MM tokens so
      // homepageLooksLikeSchedule() returns true (strategy 3 fires).
      {
        pattern: /^http:\/\/radio\.example\.test$/,
        body: "<html><body><p>Mon 20:00-22:00 Wed 21:00-23:00 Fri 22:00-23:59 Late Night Session DJ Night Owl</p></body></html>",
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

    // scheduleUrl must remain null — confirms strategy 3 (inline homepage) was
    // taken, not strategy 2 (probe path that would persist the discovered URL).
    const [row] = await db
      .select({ scheduleUrl: stationsTable.scheduleUrl })
      .from(stationsTable)
      .where(eq(stationsTable.id, stationId!));
    expect(row?.scheduleUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Path 4 — no homepage anchor, but a well-known path responds (strategy 2)
// ---------------------------------------------------------------------------

describe("scrapeStationSchedule — common-path probing (strategy 2)", () => {
  it("persists scheduleUrl and stores shows when /schedule responds but homepage has no anchor", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    configureScheduleExtractor(async () => VALID_SHOWS_JSON);

    // Use precise RegExp patterns so /schedule matches the probe path but
    // not the bare homepage, avoiding substring-match false-positives.
    const PROBE_URL = `${HOMEPAGE}/schedule`;
    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      // Matches HEAD probe and subsequent GET fetch for /schedule.
      {
        pattern: /\/schedule/,
        body: "<html><body><p>Morning Jazz Mon 08:00-10:00</p></body></html>",
      },
      // Bare homepage — no schedule link, no inline schedule tokens.
      {
        pattern: /^http:\/\/radio\.example\.test$/,
        body: "<html><body><p>Welcome to the station. Stream 24/7.</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: null,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    expect(result).toEqual({ scraped: true, showCount: 2 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(2);

    // scheduleUrl must be written back to the DB so future re-scrapes skip
    // discovery and go straight to the known path.
    const [row] = await db
      .select({ scheduleUrl: stationsTable.scheduleUrl })
      .from(stationsTable)
      .where(eq(stationsTable.id, stationId!));
    expect(row?.scheduleUrl).toBe(PROBE_URL);

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(2);
  });

  it("stamps scheduleAttemptedAt and leaves scheduleUrl null when all probes fail", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      // Homepage with no anchor link and no inline day/time tokens.
      {
        pattern: /^http:\/\/radio\.example\.test$/,
        body: "<html><body><p>Stream us live at stream.example.test/listen</p></body></html>",
      },
      // All probes get 404 (no pattern matches their paths).
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: null,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    expect(result).toEqual({ scraped: false, showCount: 0 });

    const station = await fetchStationRow();
    expect(station?.scheduleAttemptedAt).toBeInstanceOf(Date);
    expect(station?.scheduleScrapedAt).toBeNull();

    const [row] = await db
      .select({ scheduleUrl: stationsTable.scheduleUrl })
      .from(stationsTable)
      .where(eq(stationsTable.id, stationId!));
    expect(row?.scheduleUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Path 5 — homepage already contains an inline schedule (strategy 3)
// ---------------------------------------------------------------------------

describe("scrapeStationSchedule — inline homepage schedule (strategy 3)", () => {
  it("extracts shows from the homepage when it contains 3+ day tokens and 2+ times", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    configureScheduleExtractor(async () => VALID_SHOWS_JSON);

    // Homepage has enough day abbreviations + HH:MM times to trigger strategy 3.
    // No schedule link present, and all probe paths return 404.
    const INLINE_HOMEPAGE = `<html><body>
      <h1>Weekly Schedule</h1>
      <p>Mon 09:00 – 11:00 Morning Mix</p>
      <p>Tue 14:00 – 16:00 Afternoon Drive</p>
      <p>Wed 20:00 – 22:00 Night Vibes</p>
    </body></html>`;

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      // Bare homepage only — probe paths get 404 (no matching pattern).
      {
        pattern: /^http:\/\/radio\.example\.test$/,
        body: INLINE_HOMEPAGE,
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: null,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    expect(result).toEqual({ scraped: true, showCount: 2 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(2);
    expect(shows.map((s) => s.showName).sort()).toEqual([
      "Afternoon Blues",
      "Morning Jazz",
    ]);

    // No external schedule URL was discovered, so scheduleUrl must remain null.
    const [row] = await db
      .select({ scheduleUrl: stationsTable.scheduleUrl })
      .from(stationsTable)
      .where(eq(stationsTable.id, stationId!));
    expect(row?.scheduleUrl).toBeNull();

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(2);
  });

  it("does not treat a homepage as an inline schedule when it lacks day+time tokens", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // No extractor installed — should never be reached since all strategies fail.
    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: /^http:\/\/radio\.example\.test$/,
        body: "<html><body><p>Great music every Monday. Listen live at 9am!</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: null,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Not enough day/time tokens — strategy 3 must not trigger.
    expect(result).toEqual({ scraped: false, showCount: 0 });

    const station = await fetchStationRow();
    expect(station?.scheduleAttemptedAt).toBeInstanceOf(Date);
    expect(station?.scheduleScrapedAt).toBeNull();
  });
});
