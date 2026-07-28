// @vitest-environment node
/**
 * Unit tests for the pure helper functions added by the new schedule-discovery
 * strategies:
 *   - probeScheduleUrl   (strategy 2 — common-path HEAD probing)
 *   - homepageLooksLikeSchedule  (strategy 3 — inline-schedule heuristic)
 *
 * No database or real network I/O is required; fetchFn is injected and all
 * HTML is crafted inline.
 */

import { describe, it, expect, vi } from "vitest";
import {
  probeScheduleUrl,
  homepageLooksLikeSchedule,
  isScheduleUrlPermanentlyGone,
  SCHEDULE_PATH_PROBES,
  parseExtractedSchedule,
  normalizeDayOfWeek,
} from "../../src/lore/schedule-scraper.js";

// ---------------------------------------------------------------------------
// isScheduleUrlPermanentlyGone
// ---------------------------------------------------------------------------

describe("isScheduleUrlPermanentlyGone", () => {
  it("returns true for HTTP 404 (page definitively gone)", () => {
    expect(isScheduleUrlPermanentlyGone(404)).toBe(true);
  });

  it("returns true for HTTP 410 (page permanently removed)", () => {
    expect(isScheduleUrlPermanentlyGone(410)).toBe(true);
  });

  it("returns false for HTTP 500 (transient server error)", () => {
    expect(isScheduleUrlPermanentlyGone(500)).toBe(false);
  });

  it("returns false for HTTP 503 (transient unavailability)", () => {
    expect(isScheduleUrlPermanentlyGone(503)).toBe(false);
  });

  it("returns false for null (timeout or network error — transient)", () => {
    expect(isScheduleUrlPermanentlyGone(null)).toBe(false);
  });

  it("returns false for HTTP 401 (auth-gated page, not gone)", () => {
    expect(isScheduleUrlPermanentlyGone(401)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// probeScheduleUrl
// ---------------------------------------------------------------------------

/** Build a minimal HEAD-response mock. Returns 200 for exactly the given path
 *  suffix, 404 for everything else. Tracks calls so assertions can inspect
 *  them. */
function makeHeadFetch(hitPath: string, origin: string) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const ok = url === `${origin}${hitPath}`;
    return {
      ok,
      status: ok ? 200 : 404,
      statusText: ok ? "OK" : "Not Found",
      // Simulate that no redirect occurred — url echoes back the requested URL.
      url,
      text: async () => "",
      json: async () => ({}),
      headers: new Headers(),
    } as Response;
  }) as unknown as typeof fetch;
}

describe("probeScheduleUrl", () => {
  const ORIGIN = "http://probe.example.test";

  it("returns the first probe URL that responds with 200", async () => {
    // Only /schedule returns 200; the rest get 404.
    const fetchFn = makeHeadFetch("/schedule", ORIGIN);
    const result = await probeScheduleUrl(ORIGIN, { fetchFn });
    expect(result).toBe(`${ORIGIN}/schedule`);
  });

  it("returns a later probe URL when an earlier one fails", async () => {
    // /schedule → 404, /programming → 404, /shows → 200.
    const fetchFn = makeHeadFetch("/shows", ORIGIN);
    const result = await probeScheduleUrl(ORIGIN, { fetchFn });
    expect(result).toBe(`${ORIGIN}/shows`);
  });

  it("returns null when all probes return 404", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 404,
      url: "",
      text: async () => "",
      json: async () => ({}),
      headers: new Headers(),
    })) as unknown as typeof fetch;

    const result = await probeScheduleUrl(ORIGIN, { fetchFn });
    expect(result).toBeNull();
  });

  it("tries every path in SCHEDULE_PATH_PROBES before giving up", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => ({
      ok: false,
      status: 404,
      url: String(input),
      text: async () => "",
      json: async () => ({}),
      headers: new Headers(),
    })) as unknown as typeof fetch;

    await probeScheduleUrl(ORIGIN, { fetchFn });

    const calledUrls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => String(c[0]),
    );
    for (const path of SCHEDULE_PATH_PROBES) {
      expect(calledUrls).toContain(`${ORIGIN}${path}`);
    }
  });

  it("returns null when the 200 response redirects off-origin", async () => {
    const OTHER_ORIGIN = "http://cdn.other-host.test";
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // Pretend the request was redirected to a different origin.
      return {
        ok: true,
        status: 200,
        url: `${OTHER_ORIGIN}/schedule`,
        text: async () => "",
        json: async () => ({}),
        headers: new Headers(),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await probeScheduleUrl(ORIGIN, { fetchFn });
    expect(result).toBeNull();
  });

  it("falls back to GET when HEAD returns 405 and returns the URL if GET succeeds", async () => {
    // HEAD → 405 for /schedule; subsequent GET → 200 for the same path.
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === `${ORIGIN}/schedule`) {
        if (method === "HEAD") {
          return {
            ok: false,
            status: 405,
            statusText: "Method Not Allowed",
            url,
            text: async () => "",
            json: async () => ({}),
            headers: new Headers(),
          } as Response;
        }
        // GET succeeds
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          url,
          text: async () => "<html><body>schedule</body></html>",
          json: async () => ({}),
          headers: new Headers(),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        url,
        text: async () => "",
        json: async () => ({}),
        headers: new Headers(),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await probeScheduleUrl(ORIGIN, { fetchFn });
    expect(result).toBe(`${ORIGIN}/schedule`);
    // Verify both HEAD and GET were called for /schedule
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
    const headCall = calls.find(
      (c) => String(c[0]) === `${ORIGIN}/schedule` && (c[1]?.method ?? "GET").toUpperCase() === "HEAD",
    );
    const getCall = calls.find(
      (c) => String(c[0]) === `${ORIGIN}/schedule` && (c[1]?.method ?? "GET").toUpperCase() === "GET",
    );
    expect(headCall).toBeDefined();
    expect(getCall).toBeDefined();
  });

  it("skips a probe when HEAD returns 405 and the GET fallback also fails", async () => {
    // /schedule HEAD → 405, GET → 500; /programming HEAD → 200.
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === `${ORIGIN}/schedule`) {
        if (method === "HEAD") {
          return { ok: false, status: 405, url, text: async () => "", json: async () => ({}), headers: new Headers() } as Response;
        }
        return { ok: false, status: 500, url, text: async () => "", json: async () => ({}), headers: new Headers() } as Response;
      }
      if (url === `${ORIGIN}/programming` && method === "HEAD") {
        return { ok: true, status: 200, url, text: async () => "", json: async () => ({}), headers: new Headers() } as Response;
      }
      return { ok: false, status: 404, url, text: async () => "", json: async () => ({}), headers: new Headers() } as Response;
    }) as unknown as typeof fetch;

    const result = await probeScheduleUrl(ORIGIN, { fetchFn });
    expect(result).toBe(`${ORIGIN}/programming`);
  });

  it("skips a probe when fetchFn throws and tries the next one", async () => {
    let callCount = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      callCount++;
      const url = String(input);
      // Throw on the first probe; return 200 on the second.
      if (url.endsWith(SCHEDULE_PATH_PROBES[0]!)) throw new Error("ECONNREFUSED");
      const secondProbe = SCHEDULE_PATH_PROBES[1]!;
      const ok = url.endsWith(secondProbe);
      return {
        ok,
        status: ok ? 200 : 404,
        url,
        text: async () => "",
        json: async () => ({}),
        headers: new Headers(),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await probeScheduleUrl(ORIGIN, { fetchFn });
    expect(result).toBe(`${ORIGIN}${SCHEDULE_PATH_PROBES[1]}`);
  });
});

// ---------------------------------------------------------------------------
// homepageLooksLikeSchedule
// ---------------------------------------------------------------------------

describe("homepageLooksLikeSchedule", () => {
  it("returns true when there are 3+ distinct day abbreviations and 2+ HH:MM times", () => {
    const html = `<html><body>
      <p>Mon 09:00 – 11:00 Morning Mix with DJ A</p>
      <p>Tue 14:00 – 16:00 Afternoon Drive</p>
      <p>Wed 20:00 – 22:00 Night Vibes</p>
    </body></html>`;
    expect(homepageLooksLikeSchedule(html)).toBe(true);
  });

  it("returns true with 5 distinct days and many time slots", () => {
    const html = `<html><body>
      <table>
        <tr><td>Mon</td><td>08:00</td><td>10:00</td></tr>
        <tr><td>Tue</td><td>10:00</td><td>12:00</td></tr>
        <tr><td>Wed</td><td>12:00</td><td>14:00</td></tr>
        <tr><td>Thu</td><td>14:00</td><td>16:00</td></tr>
        <tr><td>Fri</td><td>16:00</td><td>18:00</td></tr>
      </table>
    </body></html>`;
    expect(homepageLooksLikeSchedule(html)).toBe(true);
  });

  it("returns false when only 2 distinct day abbreviations appear (below threshold)", () => {
    const html = `<html><body>
      <p>Mon 09:00 Morning show</p>
      <p>Tue 14:00 Afternoon show</p>
    </body></html>`;
    expect(homepageLooksLikeSchedule(html)).toBe(false);
  });

  it("returns false when prose mentions Monday but has no HH:MM times", () => {
    const html = `<html><body>
      <p>Tune in every Monday, Wednesday and Friday for our latest shows.</p>
      <p>We broadcast from 9am to midnight and love to hear from listeners.</p>
    </body></html>`;
    // No HH:MM (24-hour colon) patterns → fails time threshold.
    expect(homepageLooksLikeSchedule(html)).toBe(false);
  });

  it("returns false when 3+ day abbreviations appear but only 1 HH:MM time", () => {
    const html = `<html><body>
      <p>Mon Tue Wed shows start at 09:00</p>
    </body></html>`;
    expect(homepageLooksLikeSchedule(html)).toBe(false);
  });

  it("returns false for a plain homepage with no schedule content", () => {
    const html = `<html><body>
      <h1>Welcome to Sonic Radio</h1>
      <p>Stream live 24/7. Contact us at hello@sonicradio.example.</p>
      <a href="/schedule">View schedule</a>
    </body></html>`;
    // The link text alone doesn't contain day abbreviations or HH:MM times.
    expect(homepageLooksLikeSchedule(html)).toBe(false);
  });

  it("does not count repeated occurrences of the same day toward the 3-day threshold", () => {
    // "Mon" appears three times but it's the same day — only 1 unique day.
    const html = `<html><body>
      <p>Mon 09:00 Show A</p>
      <p>Mon 11:00 Show B</p>
      <p>Mon 13:00 Show C</p>
    </body></html>`;
    expect(homepageLooksLikeSchedule(html)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(homepageLooksLikeSchedule("")).toBe(false);
  });

  // Full day names
  it("returns true when 3+ distinct full day names and 2+ HH:MM times appear", () => {
    const html = `<html><body>
      <p>Monday 09:00 – 11:00 Morning Mix</p>
      <p>Wednesday 14:00 – 16:00 Afternoon Drive</p>
      <p>Friday 20:00 – 22:00 Night Vibes</p>
    </body></html>`;
    expect(homepageLooksLikeSchedule(html)).toBe(true);
  });

  it("counts 'Monday' and 'Mon' as the same day toward the threshold", () => {
    // Only two distinct days (Monday≡Mon, Tuesday≡Tue) → should still be false.
    const html = `<html><body>
      <p>Monday 09:00 Morning show</p>
      <p>Mon 11:00 Late Morning show</p>
      <p>Tuesday 14:00 Afternoon show</p>
    </body></html>`;
    expect(homepageLooksLikeSchedule(html)).toBe(false);
  });

  it("returns true mixing abbreviated and full day names across the threshold", () => {
    const html = `<html><body>
      <p>Monday 08:00 – 10:00 Breakfast</p>
      <p>Wed 12:00 – 14:00 Midday</p>
      <p>Saturday 18:00 – 20:00 Weekend Drive</p>
    </body></html>`;
    expect(homepageLooksLikeSchedule(html)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeDayOfWeek
// ---------------------------------------------------------------------------

describe("normalizeDayOfWeek", () => {
  it("leaves 3-letter abbreviations unchanged", () => {
    expect(normalizeDayOfWeek("Mon")).toBe("Mon");
    expect(normalizeDayOfWeek("Fri")).toBe("Fri");
    expect(normalizeDayOfWeek("Sun")).toBe("Sun");
  });

  it("normalises full day names to their 3-letter abbreviations", () => {
    expect(normalizeDayOfWeek("Monday")).toBe("Mon");
    expect(normalizeDayOfWeek("Tuesday")).toBe("Tue");
    expect(normalizeDayOfWeek("Wednesday")).toBe("Wed");
    expect(normalizeDayOfWeek("Thursday")).toBe("Thu");
    expect(normalizeDayOfWeek("Friday")).toBe("Fri");
    expect(normalizeDayOfWeek("Saturday")).toBe("Sat");
    expect(normalizeDayOfWeek("Sunday")).toBe("Sun");
  });

  it("is case-insensitive for full names", () => {
    expect(normalizeDayOfWeek("monday")).toBe("Mon");
    expect(normalizeDayOfWeek("FRIDAY")).toBe("Fri");
    expect(normalizeDayOfWeek("Saturday")).toBe("Sat");
  });

  it("returns unrecognised values as-is (so DAY_TOKENS can reject them)", () => {
    expect(normalizeDayOfWeek("Lundi")).toBe("Lundi");
    expect(normalizeDayOfWeek("")).toBe("");
    expect(normalizeDayOfWeek("Weekday")).toBe("Weekday");
  });
});

// ---------------------------------------------------------------------------
// parseExtractedSchedule
// ---------------------------------------------------------------------------

describe("parseExtractedSchedule", () => {
  it("accepts abbreviated day names and returns well-formed shows", () => {
    const raw = JSON.stringify([
      { showName: "Morning Mix", dayOfWeek: "Mon", startTime: "09:00", endTime: "11:00", djName: "DJ A" },
      { showName: "Drive Time", dayOfWeek: "Fri", startTime: "17:00", endTime: "19:00", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(2);
    expect(result![0]).toMatchObject({ dayOfWeek: "Mon", showName: "Morning Mix" });
    expect(result![1]).toMatchObject({ dayOfWeek: "Fri", showName: "Drive Time" });
  });

  it("normalises full day names to 3-letter abbreviations", () => {
    const raw = JSON.stringify([
      { showName: "Morning Mix", dayOfWeek: "Monday", startTime: "09:00", endTime: "11:00", djName: null },
      { showName: "Afternoon Drive", dayOfWeek: "Wednesday", startTime: "14:00", endTime: "16:00", djName: "DJ B" },
      { showName: "Night Vibes", dayOfWeek: "Friday", startTime: "22:00", endTime: "00:00", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(3);
    expect(result![0]).toMatchObject({ dayOfWeek: "Mon", showName: "Morning Mix" });
    expect(result![1]).toMatchObject({ dayOfWeek: "Wed", showName: "Afternoon Drive" });
    expect(result![2]).toMatchObject({ dayOfWeek: "Fri", showName: "Night Vibes" });
  });

  it("normalises a full week of full day names", () => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const abbrevs = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const raw = JSON.stringify(
      days.map((d, i) => ({
        showName: `Show ${i}`,
        dayOfWeek: d,
        startTime: "10:00",
        endTime: "11:00",
        djName: null,
      })),
    );
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(7);
    result!.forEach((show, i) => {
      expect(show.dayOfWeek).toBe(abbrevs[i]);
    });
  });

  it("drops rows whose dayOfWeek is unrecognised even after normalisation", () => {
    const raw = JSON.stringify([
      { showName: "Good Show", dayOfWeek: "Monday", startTime: "09:00", endTime: "11:00", djName: null },
      { showName: "Bad Show", dayOfWeek: "Lundi", startTime: "10:00", endTime: "12:00", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
    expect(result![0]!.showName).toBe("Good Show");
  });

  it("returns an empty array for a valid JSON array with no passable rows", () => {
    const raw = "[]";
    const result = parseExtractedSchedule(raw);
    expect(result).toEqual([]);
  });

  it("returns null for non-JSON input", () => {
    expect(parseExtractedSchedule("not json at all")).toBeNull();
  });

  it("returns null when the top-level value is not an array", () => {
    expect(parseExtractedSchedule('{"showName": "x"}')).toBeNull();
  });

  it("deduplicates rows with the same day/startTime/showName (case-insensitive name)", () => {
    const raw = JSON.stringify([
      { showName: "Morning Mix", dayOfWeek: "Monday", startTime: "09:00", endTime: "11:00", djName: null },
      { showName: "Morning Mix", dayOfWeek: "Monday", startTime: "09:00", endTime: "11:00", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
  });

  it("strips fenced code block wrappers before parsing", () => {
    const raw = "```json\n" + JSON.stringify([
      { showName: "Fenced Show", dayOfWeek: "Tuesday", startTime: "08:00", endTime: "09:00", djName: null },
    ]) + "\n```";
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({ dayOfWeek: "Tue", showName: "Fenced Show" });
  });

  it("handles mixed abbreviated and full day names in the same response", () => {
    const raw = JSON.stringify([
      { showName: "Show A", dayOfWeek: "Monday", startTime: "09:00", endTime: "11:00", djName: null },
      { showName: "Show B", dayOfWeek: "Wed", startTime: "14:00", endTime: "16:00", djName: null },
      { showName: "Show C", dayOfWeek: "Saturday", startTime: "20:00", endTime: "22:00", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(3);
    expect(result![0]!.dayOfWeek).toBe("Mon");
    expect(result![1]!.dayOfWeek).toBe("Wed");
    expect(result![2]!.dayOfWeek).toBe("Sat");
  });

  it("normalises SCREAMING_CASE full day names and keeps them in the output", () => {
    // LLMs sometimes respond with all-caps day names.  Every row must survive
    // and map to the correct 3-letter abbreviation.
    const raw = JSON.stringify([
      { showName: "Dawn Patrol", dayOfWeek: "MONDAY", startTime: "06:00", endTime: "08:00", djName: "DJ Alpha" },
      { showName: "Midday Drift", dayOfWeek: "WEDNESDAY", startTime: "12:00", endTime: "14:00", djName: null },
      { showName: "Twilight Zone", dayOfWeek: "FRIDAY", startTime: "20:00", endTime: "22:00", djName: "DJ Beta" },
      { showName: "Sunday Session", dayOfWeek: "SUNDAY", startTime: "11:00", endTime: "13:00", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(4);
    expect(result![0]).toMatchObject({ dayOfWeek: "Mon", showName: "Dawn Patrol" });
    expect(result![1]).toMatchObject({ dayOfWeek: "Wed", showName: "Midday Drift" });
    expect(result![2]).toMatchObject({ dayOfWeek: "Fri", showName: "Twilight Zone" });
    expect(result![3]).toMatchObject({ dayOfWeek: "Sun", showName: "Sunday Session" });
  });

  it("normalises a complete week of SCREAMING_CASE day names without dropping any row", () => {
    const screamingDays = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    const expectedAbbrevs = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const raw = JSON.stringify(
      screamingDays.map((d, i) => ({
        showName: `Show ${i}`,
        dayOfWeek: d,
        startTime: "10:00",
        endTime: "11:00",
        djName: null,
      })),
    );
    const result = parseExtractedSchedule(raw);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(7);
    result!.forEach((show, i) => {
      expect(show.dayOfWeek).toBe(expectedAbbrevs[i]);
    });
  });

  // -------------------------------------------------------------------------
  // Time-format edge cases — single-digit hours and seconds-appended strings
  // -------------------------------------------------------------------------

  it("drops a row whose startTime has a single-digit hour ('9:00')", () => {
    // HHMM_RE requires exactly two digits for the hour (e.g. "09:00"), so a
    // bare single-digit hour like "9:00" must be silently dropped, not stored
    // as a corrupted time value.
    const raw = JSON.stringify([
      { showName: "Good Show", dayOfWeek: "Mon", startTime: "09:00", endTime: "11:00", djName: null },
      { showName: "Bad Start", dayOfWeek: "Tue", startTime: "9:00",  endTime: "11:00", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
    expect(result![0]!.showName).toBe("Good Show");
  });

  it("drops a row whose endTime has a single-digit hour ('9:00')", () => {
    const raw = JSON.stringify([
      { showName: "Good Show",  dayOfWeek: "Mon", startTime: "08:00", endTime: "10:00", djName: null },
      { showName: "Bad End",    dayOfWeek: "Tue", startTime: "08:00", endTime: "9:00",  djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
    expect(result![0]!.showName).toBe("Good Show");
  });

  it("drops a row whose startTime has seconds appended ('09:00:00')", () => {
    // HHMM_RE is anchored (^…$) and only allows HH:MM, so "09:00:00" must be
    // rejected cleanly, not truncated or stored as "09:00".
    const raw = JSON.stringify([
      { showName: "Good Show",   dayOfWeek: "Mon", startTime: "09:00",    endTime: "11:00",    djName: null },
      { showName: "Bad Seconds", dayOfWeek: "Tue", startTime: "09:00:00", endTime: "11:00",    djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
    expect(result![0]!.showName).toBe("Good Show");
  });

  it("drops a row whose endTime has seconds appended ('11:00:00')", () => {
    const raw = JSON.stringify([
      { showName: "Good Show",      dayOfWeek: "Mon", startTime: "09:00", endTime: "11:00",    djName: null },
      { showName: "Bad End Secs",   dayOfWeek: "Tue", startTime: "09:00", endTime: "11:00:00", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
    expect(result![0]!.showName).toBe("Good Show");
  });

  it("drops all rows when every time field is a non-conforming variant", () => {
    // Ensures no rows slip through when the entire payload uses LLM time quirks.
    const raw = JSON.stringify([
      { showName: "Single Digit",  dayOfWeek: "Mon", startTime: "9:00",    endTime: "11:00",    djName: null },
      { showName: "With Seconds",  dayOfWeek: "Tue", startTime: "09:00:00", endTime: "11:00:00", djName: null },
      { showName: "Both Bad",      dayOfWeek: "Wed", startTime: "8:30",    endTime: "9:30",     djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // AM/PM time formats — 12-hour clock variants the LLM might emit
  // -------------------------------------------------------------------------

  it("drops a row whose startTime is a 12-hour AM string ('9:00 AM')", () => {
    const raw = JSON.stringify([
      { showName: "Good Show", dayOfWeek: "Mon", startTime: "09:00", endTime: "11:00", djName: null },
      { showName: "AM Start",  dayOfWeek: "Tue", startTime: "9:00 AM", endTime: "11:00", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
    expect(result![0]!.showName).toBe("Good Show");
  });

  it("drops a row whose endTime is a 12-hour PM string ('09:00pm')", () => {
    const raw = JSON.stringify([
      { showName: "Good Show", dayOfWeek: "Mon", startTime: "09:00", endTime: "11:00", djName: null },
      { showName: "PM End",    dayOfWeek: "Tue", startTime: "09:00", endTime: "09:00pm", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
    expect(result![0]!.showName).toBe("Good Show");
  });

  it("drops a row with startTime '12:00 PM' (noon in 12-hour format)", () => {
    // '12:00 PM' looks like it could be valid 24-hour noon but the trailing
    // ' PM' suffix means HHMM_RE rejects it cleanly.
    const raw = JSON.stringify([
      { showName: "Good Show",   dayOfWeek: "Mon", startTime: "12:00",    endTime: "14:00",    djName: null },
      { showName: "Noon AM/PM",  dayOfWeek: "Tue", startTime: "12:00 PM", endTime: "14:00",    djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
    expect(result![0]!.showName).toBe("Good Show");
  });

  it("drops a row with startTime '09:00 am' (lowercase am)", () => {
    const raw = JSON.stringify([
      { showName: "Good Show",   dayOfWeek: "Mon", startTime: "09:00",    endTime: "11:00", djName: null },
      { showName: "Lowercase AM", dayOfWeek: "Wed", startTime: "09:00 am", endTime: "11:00", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(1);
    expect(result![0]!.showName).toBe("Good Show");
  });

  it("drops all rows when the entire payload uses AM/PM time formats", () => {
    const raw = JSON.stringify([
      { showName: "Morning Show",  dayOfWeek: "Mon", startTime: "9:00 AM",  endTime: "11:00 AM", djName: null },
      { showName: "Afternoon Mix", dayOfWeek: "Tue", startTime: "12:00 PM", endTime: "2:00 PM",  djName: null },
      { showName: "Evening Drive", dayOfWeek: "Wed", startTime: "5:00pm",   endTime: "7:00pm",   djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toEqual([]);
  });

  it("keeps valid 24-hour rows and drops AM/PM rows from a mixed payload", () => {
    const raw = JSON.stringify([
      { showName: "Valid Show",  dayOfWeek: "Mon", startTime: "09:00",    endTime: "11:00",    djName: null },
      { showName: "AM/PM Show",  dayOfWeek: "Tue", startTime: "9:00 AM",  endTime: "11:00 AM", djName: null },
      { showName: "Another Good",dayOfWeek: "Wed", startTime: "14:00",    endTime: "16:00",    djName: null },
      { showName: "PM Show",     dayOfWeek: "Thu", startTime: "02:00 PM", endTime: "04:00 PM", djName: null },
    ]);
    const result = parseExtractedSchedule(raw);
    expect(result).toHaveLength(2);
    expect(result!.map((s) => s.showName)).toEqual(["Valid Show", "Another Good"]);
  });

  it("handles a realistic prose-fenced LLM blob with mixed-case day names end-to-end", () => {
    // Simulates a real LLM response: markdown fence, prose intro line stripped
    // by the fence-unwrap logic, and a mix of title-case, SCREAMING, and
    // already-correct 3-letter abbreviations all in the same payload.
    const raw =
      "```json\n" +
      JSON.stringify([
        { showName: "Breakfast Club", dayOfWeek: "monday", startTime: "07:00", endTime: "09:00", djName: "DJ Rosa" },
        { showName: "Lunch Hour Hits", dayOfWeek: "TUESDAY", startTime: "12:00", endTime: "13:00", djName: null },
        { showName: "Afternoon Express", dayOfWeek: "Wednesday", startTime: "15:00", endTime: "17:00", djName: "DJ Sam" },
        { showName: "Drive Time", dayOfWeek: "Thu", startTime: "17:00", endTime: "19:00", djName: null },
        { showName: "Friday Night Fever", dayOfWeek: "FRIDAY", startTime: "21:00", endTime: "23:00", djName: "DJ Noel" },
        { showName: "Weekend Kickoff", dayOfWeek: "Saturday", startTime: "10:00", endTime: "12:00", djName: null },
        { showName: "Sunday Brunch", dayOfWeek: "SUNDAY", startTime: "11:00", endTime: "13:00", djName: "DJ Jules" },
      ]) +
      "\n```";

    const result = parseExtractedSchedule(raw);
    expect(result).not.toBeNull();
    // All 7 rows must survive — none silently dropped due to casing.
    expect(result).toHaveLength(7);
    const days = result!.map((s) => s.dayOfWeek);
    expect(days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});
