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
    for (const show of shows) {
      expect(show.sourceUrl).toBe(SCHEDULE_URL);
      expect(show.scrapedAt).toBeInstanceOf(Date);
      expect(show.extraction).toBe("llm");
    }

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

// ---------------------------------------------------------------------------
// Path 6 — malformed times from LLM are rejected before the DB write
// ---------------------------------------------------------------------------

/**
 * These tests exercise the full scrapeStationSchedule write path with a mocked
 * LLM that deliberately returns bad time strings (AM/PM notation, single-digit
 * hours). The parser guard (parseExtractedSchedule / HHMM_RE) must reject every
 * entry so that zero rows reach scraped_shows — even though the page fetch and
 * LLM call both "succeed". This confirms the guard is not bypassed by the
 * surrounding orchestration code.
 */
describe("scrapeStationSchedule — malformed LLM times never reach the DB", () => {
  it("stores zero rows when the LLM returns AM/PM times", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // LLM returns shows with AM/PM notation — all must be rejected by
    // parseExtractedSchedule before any DB insert is attempted.
    const AM_PM_JSON = JSON.stringify([
      {
        showName: "Morning Drive",
        dayOfWeek: "Mon",
        startTime: "9:00 AM",
        endTime: "11:00 AM",
        djName: "DJ Sunrise",
      },
      {
        showName: "Afternoon Chill",
        dayOfWeek: "Wed",
        startTime: "2:00 PM",
        endTime: "4:00 PM",
        djName: null,
      },
      {
        showName: "Late Night",
        dayOfWeek: "Fri",
        startTime: "11:30 PM",
        endTime: "1:00 AM",
        djName: "DJ Owl",
      },
    ]);

    configureScheduleExtractor(async () => AM_PM_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // All entries are malformed — parser returns an empty array, which is a
    // legitimate "nothing to store" result (not a parse failure), so scraped=true
    // with showCount=0.
    expect(result).toEqual({ scraped: true, showCount: 0 });

    // The DB must contain zero scraped rows for this station.
    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(0);

    // scheduleScrapedAt is stamped (extraction succeeded, just no valid rows).
    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(0);
  });

  it("stores zero rows when the LLM returns single-digit-hour times", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // LLM returns shows with single-digit hours — rejected by HHMM_RE.
    const SINGLE_DIGIT_JSON = JSON.stringify([
      {
        showName: "Morning Show",
        dayOfWeek: "Tue",
        startTime: "9:00",
        endTime: "11:00",
        djName: null,
      },
      {
        showName: "Drive Time",
        dayOfWeek: "Thu",
        startTime: "8:30",
        endTime: "10:00",
        djName: "DJ Drive",
      },
    ]);

    configureScheduleExtractor(async () => SINGLE_DIGIT_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    expect(result).toEqual({ scraped: true, showCount: 0 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(0);

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(0);
  });

  it("stores only the well-formed entries when bad and good times are mixed", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Mix of one valid 24h entry and two malformed (AM/PM + single-digit).
    // Only the valid entry must reach the DB.
    const MIXED_JSON = JSON.stringify([
      {
        showName: "Valid Show",
        dayOfWeek: "Mon",
        startTime: "14:00",
        endTime: "16:00",
        djName: "DJ Valid",
      },
      {
        showName: "AM/PM Show",
        dayOfWeek: "Wed",
        startTime: "2:00 PM",
        endTime: "4:00 PM",
        djName: null,
      },
      {
        showName: "Single Digit Show",
        dayOfWeek: "Fri",
        startTime: "9:00",
        endTime: "11:00",
        djName: null,
      },
    ]);

    configureScheduleExtractor(async () => MIXED_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Only the one valid entry is stored.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Valid Show");
    expect(shows[0]!.startTime).toBe("14:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores exactly one row when the LLM returns the same show twice with extra surrounding whitespace", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // The seenSlots key in parseExtractedSchedule trims the showName before
    // lowercasing it, so "Morning Jazz" and "  Morning Jazz  " (with extra
    // leading/trailing spaces) for the same day+startTime are treated as the
    // same slot and collapsed to one row. This test confirms that behaviour
    // survives future refactors of the dedup logic: a refactor that moves or
    // removes the .trim() step would let both entries through and hit the DB
    // unique constraint, turning a silent logic bug into a visible crash.
    // Asserting showCount=1 here catches it earlier.
    const WHITESPACE_VARIANT_JSON = JSON.stringify([
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
      {
        showName: "  Morning Jazz  ",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
    ]);

    configureScheduleExtractor(async () => WHITESPACE_VARIANT_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Whitespace-trimmed dedup collapses the two variants to one row.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    // Exactly one row in scraped_shows — no DB unique-constraint error and no
    // silent duplicate. The stored name is the trimmed first occurrence.
    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.dayOfWeek).toBe("Mon");
    expect(shows[0]!.startTime).toBe("08:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores exactly one row when the LLM returns the same show twice with internal whitespace differences", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // The seenSlots key in parseExtractedSchedule collapses internal whitespace
    // (via .replace(/\s+/g, " ")) before lowercasing, so "Morning Jazz" and
    // "Morning  Jazz" (double internal space) for the same day+startTime are
    // treated as the same slot and collapsed to one row. An LLM could emit
    // either form from the same source text. Without the internal-whitespace
    // collapse, the second variant would reach the DB and hit the unique
    // constraint at runtime, turning a silent normalisation gap into a crash.
    // Asserting showCount=1 here confirms the guard fires before the DB write.
    const INTERNAL_WHITESPACE_VARIANT_JSON = JSON.stringify([
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
      {
        showName: "Morning  Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
    ]);

    configureScheduleExtractor(async () => INTERNAL_WHITESPACE_VARIANT_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Internal-whitespace-collapsed dedup reduces two variants to one row.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    // Exactly one row in scraped_shows — no DB unique-constraint error and no
    // silent duplicate. The stored name is the first occurrence (single space).
    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.dayOfWeek).toBe("Mon");
    expect(shows[0]!.startTime).toBe("08:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores exactly one row when the LLM returns the same show with a tab character in the name", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // An LLM transcribing a tab-delimited schedule page could emit
    // "Morning\tJazz" as a show name. The seenSlots key collapses all
    // whitespace runs (via .replace(/\s+/g, " ")) before lowercasing, so
    // "Morning\tJazz" and "Morning Jazz" normalise to the same key and only
    // one row is written. Without the \s+ collapse (e.g. if the regex were
    // changed to / +/), the tab variant would pass through as a distinct key
    // and either crash on the DB unique constraint or insert a silent duplicate.
    const TAB_VARIANT_JSON = JSON.stringify([
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
      {
        showName: "Morning\tJazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
    ]);

    configureScheduleExtractor(async () => TAB_VARIANT_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Tab-collapsed dedup reduces both variants to one row.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    // Exactly one row in scraped_shows — the stored name is the first
    // occurrence (canonical form without tab).
    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.dayOfWeek).toBe("Mon");
    expect(shows[0]!.startTime).toBe("08:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores exactly one row when the LLM returns the same show with a newline in the name", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // An LLM handed multi-line HTML can join lines with a literal newline
    // instead of a space, emitting "Morning\nJazz". The seenSlots key collapses
    // all whitespace runs (via .replace(/\s+/g, " ")) before lowercasing, so
    // "Morning\nJazz" and "Morning Jazz" normalise to the same key and only
    // one row is written.
    const NEWLINE_VARIANT_JSON = JSON.stringify([
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
      {
        showName: "Morning\nJazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
    ]);

    configureScheduleExtractor(async () => NEWLINE_VARIANT_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Newline-collapsed dedup reduces both variants to one row.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.dayOfWeek).toBe("Mon");
    expect(shows[0]!.startTime).toBe("08:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores exactly one row when the LLM returns the same show with a CRLF in the name", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Windows-style line endings: "Morning\r\nJazz" is a two-character
    // whitespace run that a single \s+ match collapses to one space, so it
    // dedups against "Morning Jazz" exactly like the \n variant.
    const CRLF_VARIANT_JSON = JSON.stringify([
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
      {
        showName: "Morning\r\nJazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
    ]);

    configureScheduleExtractor(async () => CRLF_VARIANT_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // CRLF-collapsed dedup reduces both variants to one row.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.dayOfWeek).toBe("Mon");
    expect(shows[0]!.startTime).toBe("08:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores exactly one row when the LLM returns the same show with a zero-width space in the name", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // JavaScript's \s does NOT match zero-width characters like U+200B
    // (zero-width space) or U+FEFF (BOM), which LLMs occasionally emit when
    // transcribing scraped HTML. The seenSlots key strips
    // /[\u200B-\u200D\uFEFF]/g before collapsing whitespace, so
    // "Morning\u200BJazz" normalises to the same key as "Morning Jazz" and
    // only one row is written.
    const ZERO_WIDTH_VARIANT_JSON = JSON.stringify([
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
      {
        showName: "Morning\u200BJazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
    ]);

    configureScheduleExtractor(async () => ZERO_WIDTH_VARIANT_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Zero-width-stripped dedup reduces both variants to one row.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.dayOfWeek).toBe("Mon");
    expect(shows[0]!.startTime).toBe("08:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores the sanitized showName even when the zero-width variant appears first", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Dedup keeps whichever entry appears FIRST — so when the zero-width
    // variant "Morning\u200BJazz" comes first, the stored showName must
    // still be the sanitized "Morning Jazz" (zero-width chars mapped to a
    // space, whitespace collapsed, trimmed), not the raw variant that would
    // render as "MorningJazz" and break text matching.
    const ZERO_WIDTH_FIRST_JSON = JSON.stringify([
      {
        showName: "Morning\u200BJazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ\u200BAlice",
      },
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
    ]);

    configureScheduleExtractor(async () => ZERO_WIDTH_FIRST_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });
    expect(result).toEqual({ scraped: true, showCount: 1 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    // The stored name is the clean, space-separated form — never the raw
    // zero-width variant the LLM happened to emit first.
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.djName).toBe("DJ Alice");
  });

  it("stores exactly one row when the LLM returns the same show with a mixed whitespace run in the name", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Confirm that a mixed run such as "Morning \t Jazz" (space + tab + space)
    // also collapses to the same slot key as "Morning Jazz". This exercises the
    // multi-token case: a single \s+ match handles an arbitrary mix of spaces,
    // tabs, and newlines in one pass, not just consecutive spaces or a lone tab.
    const MIXED_WHITESPACE_JSON = JSON.stringify([
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
      {
        showName: "Morning \t Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
    ]);

    configureScheduleExtractor(async () => MIXED_WHITESPACE_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Mixed-whitespace-collapsed dedup reduces both variants to one row.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.dayOfWeek).toBe("Mon");
    expect(shows[0]!.startTime).toBe("08:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Path 7 — missing required fields from LLM are rejected before the DB write
// ---------------------------------------------------------------------------

/**
 * These tests exercise the full scrapeStationSchedule write path with a mocked
 * LLM that deliberately returns entries missing required fields: a blank
 * showName, an unrecognised dayOfWeek, and an oversized showName (>200 chars).
 * The parser guard (parseExtractedSchedule) must reject every such entry so
 * that zero rows reach scraped_shows — even though the page fetch and LLM call
 * both "succeed". This confirms the guard is not bypassed by the surrounding
 * orchestration code and that a future refactor cannot silently admit bad rows.
 */
describe("scrapeStationSchedule — missing required fields never reach the DB", () => {
  it("stores zero rows when the LLM returns a blank showName", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // LLM returns entries where showName is an empty string — rejected by the
    // `!showName` check in parseExtractedSchedule.
    const BLANK_NAME_JSON = JSON.stringify([
      {
        showName: "",
        dayOfWeek: "Mon",
        startTime: "09:00",
        endTime: "11:00",
        djName: "DJ Alice",
      },
      {
        showName: "   ",
        dayOfWeek: "Tue",
        startTime: "14:00",
        endTime: "16:00",
        djName: null,
      },
    ]);

    configureScheduleExtractor(async () => BLANK_NAME_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // All entries are rejected — empty array is a valid parse result.
    expect(result).toEqual({ scraped: true, showCount: 0 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(0);

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(0);
  });

  it("stores zero rows when the LLM returns an unrecognised dayOfWeek", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // LLM returns entries with day strings not in the canonical 3-letter set —
    // rejected by the `!DAY_TOKENS.has(dayOfWeek)` check.
    const BAD_DAY_JSON = JSON.stringify([
      {
        showName: "Morning Show",
        dayOfWeek: "Lun",
        startTime: "09:00",
        endTime: "11:00",
        djName: null,
      },
      {
        showName: "Evening Show",
        dayOfWeek: "Lundi",
        startTime: "20:00",
        endTime: "22:00",
        djName: "DJ Night",
      },
      {
        showName: "Weekend Special",
        dayOfWeek: "Weekend",
        startTime: "12:00",
        endTime: "14:00",
        djName: null,
      },
    ]);

    configureScheduleExtractor(async () => BAD_DAY_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    expect(result).toEqual({ scraped: true, showCount: 0 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(0);

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(0);
  });

  it("stores zero rows when the LLM returns a showName longer than 200 chars", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // LLM returns entries where showName exceeds the 200-character limit —
    // rejected by the `showName.length > 200` check.
    const LONG_NAME_JSON = JSON.stringify([
      {
        showName: "A".repeat(201),
        dayOfWeek: "Mon",
        startTime: "09:00",
        endTime: "11:00",
        djName: null,
      },
      {
        showName: "The " + "Very ".repeat(50) + "Long Show",
        dayOfWeek: "Fri",
        startTime: "18:00",
        endTime: "20:00",
        djName: "DJ Verbose",
      },
    ]);

    configureScheduleExtractor(async () => LONG_NAME_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    expect(result).toEqual({ scraped: true, showCount: 0 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(0);

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(0);
  });

  it("stores zero rows when the LLM returns null or missing startTime", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // LLM returns entries where startTime is null, undefined (key absent), or
    // an explicit null JSON value. All must be rejected by the HHMM_RE check
    // (non-string values become "" which fails the regex).
    const NULL_START_JSON = JSON.stringify([
      {
        showName: "Null Start Show",
        dayOfWeek: "Mon",
        startTime: null,
        endTime: "11:00",
        djName: "DJ Alice",
      },
      {
        showName: "Missing Start Show",
        dayOfWeek: "Tue",
        // startTime key intentionally omitted
        endTime: "16:00",
        djName: null,
      },
    ]);

    configureScheduleExtractor(async () => NULL_START_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // All entries lack a valid startTime — parser must reject them all.
    expect(result).toEqual({ scraped: true, showCount: 0 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(0);

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(0);
  });

  it("stores zero rows when the LLM returns null or missing endTime", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // LLM returns entries where endTime is null or the key is absent entirely.
    // Both must be rejected by the HHMM_RE check in parseExtractedSchedule.
    const NULL_END_JSON = JSON.stringify([
      {
        showName: "Null End Show",
        dayOfWeek: "Wed",
        startTime: "14:00",
        endTime: null,
        djName: null,
      },
      {
        showName: "Missing End Show",
        dayOfWeek: "Fri",
        startTime: "20:00",
        // endTime key intentionally omitted
        djName: "DJ Night",
      },
    ]);

    configureScheduleExtractor(async () => NULL_END_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // All entries lack a valid endTime — parser must reject them all.
    expect(result).toEqual({ scraped: true, showCount: 0 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(0);

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(0);
  });

  it("stores only the valid entry when null and absent endTime are mixed with a good entry", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // One entry whose endTime is explicit null, one whose endTime key is absent
    // entirely, and one well-formed entry. The parser must drop both bad rows
    // without short-circuiting, so the valid entry still reaches the DB.
    const MIXED_END_JSON = JSON.stringify([
      {
        showName: "Valid Show",
        dayOfWeek: "Mon",
        startTime: "09:00",
        endTime: "11:00",
        djName: "DJ Good",
      },
      {
        showName: "Null End Show",
        dayOfWeek: "Wed",
        startTime: "14:00",
        endTime: null,
        djName: null,
      },
      {
        showName: "Missing End Show",
        dayOfWeek: "Fri",
        startTime: "20:00",
        // endTime key intentionally omitted
        djName: "DJ Night",
      },
    ]);

    configureScheduleExtractor(async () => MIXED_END_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Only the one valid entry must be stored; the two bad endTime entries
    // are dropped by the parser without short-circuiting the loop.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Valid Show");
    expect(shows[0]!.startTime).toBe("09:00");
    expect(shows[0]!.endTime).toBe("11:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores only valid entries when bad fields are mixed with well-formed ones", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Mix of invalid entries (blank name, bad day, oversized name) alongside
    // one valid entry — only the valid entry must reach the DB.
    const MIXED_FIELDS_JSON = JSON.stringify([
      {
        showName: "Valid Show",
        dayOfWeek: "Wed",
        startTime: "10:00",
        endTime: "12:00",
        djName: "DJ Good",
      },
      {
        showName: "",
        dayOfWeek: "Mon",
        startTime: "09:00",
        endTime: "11:00",
        djName: null,
      },
      {
        showName: "Foreign Day Show",
        dayOfWeek: "Lun",
        startTime: "14:00",
        endTime: "16:00",
        djName: null,
      },
      {
        showName: "Z".repeat(201),
        dayOfWeek: "Sat",
        startTime: "20:00",
        endTime: "22:00",
        djName: null,
      },
    ]);

    configureScheduleExtractor(async () => MIXED_FIELDS_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Only the one valid entry is stored.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Valid Show");
    expect(shows[0]!.dayOfWeek).toBe("Wed");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores exactly one row when the LLM returns the same show/day/time twice", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // LLM returns the same slot (showName + dayOfWeek + startTime) twice — a
    // realistic hallucination where the model echoes a repeated HTML block.
    // parseExtractedSchedule deduplicates on (dayOfWeek, startTime, showName)
    // via seenSlots before any DB write, so only one row must reach scraped_shows.
    // The second occurrence has a different endTime and djName to confirm that
    // the dedup key is the identity triple, not full-object equality.
    const DUPLICATE_SLOT_JSON = JSON.stringify([
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:30", // different endTime — still a duplicate slot
        djName: "DJ Bob",  // different djName — still a duplicate slot
      },
    ]);

    configureScheduleExtractor(async () => DUPLICATE_SLOT_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Dedup collapses two identical slots to one — showCount must be 1.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    // Exactly one row must be in scraped_shows — no DB unique-constraint error
    // and no silent duplicate row.
    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.dayOfWeek).toBe("Mon");
    expect(shows[0]!.startTime).toBe("08:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores exactly one row when the LLM returns the same show twice with different casing", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // The seenSlots key in parseExtractedSchedule lowercases the showName
    // component so "Morning Jazz" and "MORNING JAZZ" (same day + startTime)
    // are treated as the same slot and collapsed to one row. This test
    // confirms that behaviour survives future refactors of the dedup logic:
    // a refactor that drops the `.toLowerCase()` step would let both entries
    // through and hit the DB unique constraint, turning a silent logic bug
    // into a visible crash. Asserting showCount=1 here catches it earlier.
    const CASE_VARIANT_JSON = JSON.stringify([
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
      {
        showName: "MORNING JAZZ",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
    ]);

    configureScheduleExtractor(async () => CASE_VARIANT_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Case-insensitive dedup collapses the two variants to one row.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    // Exactly one row in scraped_shows — no DB unique-constraint error and no
    // silent duplicate. The stored name is the first occurrence's casing.
    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.dayOfWeek).toBe("Mon");
    expect(shows[0]!.startTime).toBe("08:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });

  it("stores exactly one row when the LLM returns the same show twice with extra surrounding whitespace", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // The seenSlots key in parseExtractedSchedule trims the showName before
    // lowercasing it, so "Morning Jazz" and "  Morning Jazz  " (with extra
    // leading/trailing spaces) for the same day+startTime are treated as the
    // same slot and collapsed to one row. This test confirms that behaviour
    // survives future refactors of the dedup logic: a refactor that moves or
    // removes the .trim() step would let both entries through and hit the DB
    // unique constraint, turning a silent logic bug into a visible crash.
    // Asserting showCount=1 here catches it earlier.
    const WHITESPACE_VARIANT_JSON = JSON.stringify([
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
      {
        showName: "  Morning Jazz  ",
        dayOfWeek: "Mon",
        startTime: "08:00",
        endTime: "10:00",
        djName: "DJ Alice",
      },
    ]);

    configureScheduleExtractor(async () => WHITESPACE_VARIANT_JSON);

    const fetchFn = makeFetch([
      { pattern: /robots\.txt/, body: "User-agent: *\nDisallow:\n" },
      {
        pattern: "/schedule",
        body: "<html><body><p>Schedule page content</p></body></html>",
      },
    ]);

    const target = {
      id: stationId!,
      slug: `test-sched-${run}`,
      homepageUrl: HOMEPAGE,
      scheduleUrl: SCHEDULE_URL,
      city: null,
      country: null,
      ianaTimezone: null,
    };

    const result = await scrapeStationSchedule(target, { fetchFn });

    // Whitespace-trimmed dedup collapses the two variants to one row.
    expect(result).toEqual({ scraped: true, showCount: 1 });

    // Exactly one row in scraped_shows — no DB unique-constraint error and no
    // silent duplicate. The stored name is the trimmed first occurrence.
    const shows = await fetchScrapedShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]!.showName).toBe("Morning Jazz");
    expect(shows[0]!.dayOfWeek).toBe("Mon");
    expect(shows[0]!.startTime).toBe("08:00");

    const station = await fetchStationRow();
    expect(station?.scheduleScrapedAt).toBeInstanceOf(Date);
    expect(station?.upcomingShowCount).toBe(1);
  });
});
