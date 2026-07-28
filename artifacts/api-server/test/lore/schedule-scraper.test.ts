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
  SCHEDULE_PATH_PROBES,
} from "../../src/lore/schedule-scraper.js";

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
});
