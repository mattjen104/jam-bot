import {
  db,
  stationsTable,
  scrapedShowsTable,
  scrapedShowExceptionsTable,
} from "@workspace/db";
import { and, eq, isNotNull, lt, or, isNull, sql } from "drizzle-orm";
import { isCrawlBlocked } from "./blog-crossref.js";
import { extractScheduleRaw } from "./schedule-llm.js";
import { inferTimezone } from "./timezone.js";
import { sanitizeScheduleName } from "./schedule-name-sanitizer.js";
import { eligibleDjName } from "@workspace/lore-attribution";
import {
  cadenceScheduleSource,
  googleCalendarIcsUrl,
  parseCadenceSchedule,
  parseCalendarIcs,
  parseStructuredScheduleHtml,
  wordpressPageApiUrl,
  wordpressRenderedContent,
} from "./schedule-structured.js";

/**
 * Weekly-schedule scraper — a second, slower-paced sibling to
 * homepage-scraper.ts. Stations format their programming grid wildly
 * differently (HTML tables, prose lists, embedded JSON), so extraction is
 * delegated to an LLM call (see schedule-llm.ts) instead of a bespoke parser
 * per station. Deliberately conservative: only stores an entry when the
 * extractor returns well-formed, unambiguous JSON, and a full re-scrape
 * atomically replaces a station's prior schedule rather than merging with
 * stale rows. Never blocks the dial, never fabricates a show.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CHARS = 20_000; // keep the LLM prompt bounded
// Schedules change week to week — refresh far less often than every tick,
// but more often than the monthly blurb cadence.
const RESCRAPE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
// Separate, much shorter backoff for stations whose scrape *attempt* failed
// (dead homepage, robots-blocked, LLM error). Without this, a persistently
// failing station would be selected again on every single tick forever
// (scheduleScrapedAt would stay null), starving the small per-tick batch
// and preventing the scraper from ever reaching the rest of the directory.
const ATTEMPT_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 3;
const TICK_MS = 45_000;
const WARMUP_MS = 150_000; // start after the homepage scraper's own warmup
// A complete college/community grid can exceed 40 weekly slots. Keep the
// ceiling bounded while allowing one distinct hourly slot for every hour of
// the week; malformed overlaps are rejected separately.
const MAX_SHOWS_PER_STATION = 168;

const DAY_TOKENS = new Set([
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
]);

/** Map lowercase full day names to their 3-letter abbreviations. */
const FULL_DAY_TO_ABBREV: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

/**
 * Normalise a dayOfWeek string from LLM output. Accepts both abbreviated
 * ("Mon") and full ("Monday") forms and returns the canonical 3-letter form.
 * Unrecognised values are returned as-is so the DAY_TOKENS check can reject
 * them cleanly. Pure, no I/O.
 */
export function normalizeDayOfWeek(day: string): string {
  const lower = day.toLowerCase();
  return FULL_DAY_TO_ABBREV[lower] ?? day;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SPINITRON_HOST = "spinitron.com";
const SPINITRON_CRAWL_DELAY_MS = 10_000;
const CANONICAL_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
let spinitronFetchQueue = Promise.resolve();

async function fetchSpinitronRespectfully(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  // Keep tests fast; injected fetch functions are deterministic fakes. Real
  // network traffic is serialized and paced to Spinitron's robots.txt policy.
  if (fetchFn !== fetch) return fetchFn(url, init);

  const prior = spinitronFetchQueue;
  let release!: () => void;
  spinitronFetchQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prior;
  try {
    await new Promise((resolve) => setTimeout(resolve, SPINITRON_CRAWL_DELAY_MS));
    return await fetchFn(url, {
      ...init,
      // Queue time must not consume the network timeout. Create the signal
      // only when this request is actually allowed to start.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } finally {
    release();
  }
}

function isSpinitronCalendarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === SPINITRON_HOST && /^\/[^/]+\/calendar\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

interface ScrapeTarget {
  id: number;
  slug: string;
  homepageUrl: string;
  /** Pre-known schedule page URL. When set, the scraper fetches this directly
   *  and skips the homepage fetch + link-discovery step entirely. */
  scheduleUrl: string | null;
  /** City and country, used to backfill iana_timezone after a successful scrape. */
  city: string | null;
  country: string | null;
  /** Already-stored timezone, when non-null the backfill is skipped. */
  ianaTimezone: string | null;
}

export interface ExtractedShow {
  showName: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  djName: string | null;
}

export interface DatedExtractedShow extends ExtractedShow {
  airDate: string;
}

export interface SpinitronScheduleExtraction {
  recurringShows: ExtractedShow[];
  datedExceptions: DatedExtractedShow[];
}

/**
 * Return the Monday-through-following-Monday window expected by Spinitron's
 * FullCalendar feed. The end is exclusive, making this exactly seven days.
 * `now` is injectable so callers and tests do not depend on the clock.
 */
export function spinitronWeekWindow(now: Date = new Date()): { start: string; end: string } {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const end = new Date(monday);
  end.setDate(end.getDate() + 7);
  const format = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { start: format(monday), end: format(end) };
}

/**
 * Extract the public JSON feed configured by a Spinitron calendar page.
 * Restricting both page and feed to spinitron.com avoids treating arbitrary
 * embedded event URLs as an API endpoint.
 */
export function spinitronCalendarFeedUrl(
  calendarUrl: string,
  html: string,
  now: Date = new Date(),
): string | null {
  let page: URL;
  try {
    page = new URL(calendarUrl);
  } catch {
    return null;
  }
  if (!isSpinitronCalendarUrl(calendarUrl)) {
    return null;
  }
  const match = html.match(/["']?events["']?\s*:\s*(["'])([^"']+)\1/i);
  if (!match) return null;
  let feed: URL;
  try {
    // The value is embedded in a JavaScript string and Spinitron escapes `/`
    // as `\/`. Decode only that harmless representation before URL parsing;
    // the strict same-origin/path checks below still decide whether it is safe.
    feed = new URL(match[2]!.replace(/\\\//g, "/"), page);
  } catch {
    return null;
  }
  if (
    feed.origin !== page.origin ||
    !/^\/[^/]+\/calendar-feed\/?$/.test(feed.pathname)
  ) {
    return null;
  }
  const week = spinitronWeekWindow(now);
  feed.searchParams.set("start", week.start);
  feed.searchParams.set("end", week.end);
  return feed.toString();
}

/**
 * Decode Spinitron's public calendar event payload without converting its
 * timestamps through this server's timezone. The date and HH:MM components
 * displayed by Spinitron are the schedule's local wall-clock values.
 */
export function parseSpinitronCalendarFeedWithExceptions(
  raw: string,
  window?: { start: string; end: string },
): SpinitronScheduleExtraction | null {
  let events: unknown;
  try {
    events = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(events)) return null;
  const shows: DatedExtractedShow[] = [];
  for (const event of events) {
    if (!event || typeof event !== "object") return null;
    const value = event as Record<string, unknown>;
    if (
      typeof value.title !== "string" ||
      typeof value.text !== "string" ||
      typeof value.start !== "string" ||
      typeof value.end !== "string"
    ) {
      return null;
    }
    const eventDate = value.start.slice(0, 10);
    // FullCalendar providers may pad a requested week with events from the
    // adjacent weekend or following Monday. Those rows are useful to the
    // calendar UI but would collide with this recurring weekly grid. Keep the
    // exact requested [start, end) range and never choose between real
    // same-date conflicts.
    if (window && (eventDate < window.start || eventDate >= window.end)) {
      continue;
    }
    const start = value.start.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    const end = value.end.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
    if (!start || !end) return null;
    const year = Number(start[1]);
    const month = Number(start[2]);
    const date = Number(start[3]);
    const startTime = `${start[4]}:${start[5]}`;
    const endTime = `${end[1]}:${end[2]}`;
    // Date.UTC supplies a stable weekday calculation; no instant/offset
    // conversion is performed on the calendar values themselves.
    const dayDate = new Date(Date.UTC(year, month - 1, date));
    if (
      dayDate.getUTCFullYear() !== year ||
      dayDate.getUTCMonth() !== month - 1 ||
      dayDate.getUTCDate() !== date ||
      !HHMM_RE.test(startTime) ||
      !HHMM_RE.test(endTime)
    ) {
      return null;
    }
    const showName = sanitizeScheduleName(value.title);
    if (!showName || showName.length > 200) return null;
    const text = sanitizeScheduleName(value.text);
    shows.push({
      showName,
      airDate: eventDate,
      dayOfWeek: CANONICAL_DAYS[dayDate.getUTCDay()]!,
      startTime,
      endTime,
      djName: eligibleDjName(text, { showTitle: showName }) ?? null,
    });
  }
  const recurringShows = parseExtractedSchedule(JSON.stringify(shows));
  if (recurringShows !== null) {
    return { recurringShows, datedExceptions: [] };
  }

  // A provider conflict is valid dated evidence, not a broken weekly grid.
  // Preserve every official event on its actual date rather than selecting a
  // winner or pretending each row recurs every week.
  const seen = new Set<string>();
  const datedExceptions = shows.filter((show) => {
    const key = `${show.airDate}|${show.startTime}|${show.showName.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { recurringShows: [], datedExceptions: datedExceptions.slice(0, MAX_SHOWS_PER_STATION) };
}

/** Backward-compatible recurring-grid view for callers that do not consume exceptions. */
export function parseSpinitronCalendarFeed(
  raw: string,
  window?: { start: string; end: string },
): ExtractedShow[] | null {
  return parseSpinitronCalendarFeedWithExceptions(raw, window)?.recurringShows ?? null;
}

/** A receipt is required for every durable extracted fact. */
export function requireSourceUrl(sourceUrl: string | null | undefined): string {
  const value = sourceUrl?.trim() ?? "";
  if (!value) throw new Error("source URL is required for extracted facts");
  return value;
}

function minutesSinceMidnight(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Schedule slots may cross midnight, but a zero-length slot or two slots that
 * compete for the same station/day cannot be persisted as a weekly grid.
 * Returns false for a valid, non-overlapping set.
 */
export function hasOverlappingScheduleSlots(shows: ExtractedShow[]): boolean {
  const dayIndex = new Map(
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => [day, i]),
  );
  const intervals: Array<Array<{ start: number; end: number }>> = [];
  for (const show of shows) {
    const day = dayIndex.get(show.dayOfWeek);
    if (day === undefined) return true;
    const start = day * 24 * 60 + minutesSinceMidnight(show.startTime);
    const end = day * 24 * 60 + minutesSinceMidnight(show.endTime);
    if (end === start) return true;
    if (end > start) {
      intervals.push([{ start, end }]);
    } else {
      const nextDay = (day + 1) * 24 * 60;
      if (day === 6) {
        intervals.push([
          { start, end: 7 * 24 * 60 },
          { start: 0, end: minutesSinceMidnight(show.endTime) },
        ]);
      } else {
        intervals.push([
          { start, end: nextDay },
          { start: nextDay, end: nextDay + minutesSinceMidnight(show.endTime) },
        ]);
      }
    }
  }
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      for (const a of intervals[i]!) {
        for (const b of intervals[j]!) {
          if (a.start < b.end && b.start < a.end) return true;
        }
      }
    }
  }
  return false;
}

async function loadStaleTargets(limit: number): Promise<ScrapeTarget[]> {
  const successCutoff = new Date(Date.now() - RESCRAPE_AFTER_MS);
  const attemptCutoff = new Date(Date.now() - ATTEMPT_RETRY_AFTER_MS);

  // Eligible when the last *successful* scrape (if any) is older than the
  // weekly cadence AND the last *attempt* (if any — success or failure) is
  // older than the shorter failure-retry backoff. The attempt clause is what
  // stops a persistently-failing station from being reselected every tick.
  // Selection + limit both happen in SQL (ordered oldest-attempt-first, nulls
  // first) so it's deterministic and fair across the whole directory rather
  // than an in-memory filter/slice over an unordered result set.
  const rows = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      homepageUrl: stationsTable.homepageUrl,
      scheduleUrl: stationsTable.scheduleUrl,
      city: stationsTable.city,
      country: stationsTable.country,
      ianaTimezone: stationsTable.ianaTimezone,
    })
    .from(stationsTable)
    .where(
      and(
        eq(stationsTable.active, true),
        eq(stationsTable.hidden, false),
        isNotNull(stationsTable.homepageUrl),
        or(
          isNull(stationsTable.scheduleScrapedAt),
          lt(stationsTable.scheduleScrapedAt, successCutoff),
        ),
        or(
          isNull(stationsTable.scheduleAttemptedAt),
          lt(stationsTable.scheduleAttemptedAt, attemptCutoff),
        ),
      ),
    )
    .orderBy(sql`${stationsTable.scheduleAttemptedAt} asc nulls first`)
    .limit(limit);

  return rows
    .filter((r): r is typeof r & { homepageUrl: string } => Boolean(r.homepageUrl))
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      homepageUrl: r.homepageUrl,
      scheduleUrl: r.scheduleUrl ?? null,
      city: r.city ?? null,
      country: r.country ?? null,
      ianaTimezone: r.ianaTimezone ?? null,
    }));
}

/** Strip tags/scripts down to visible-ish text, pure/no I/O. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find an on-page link that plausibly leads to a dedicated schedule page,
 * e.g. `<a href="/schedule">Programming</a>`. Inspects all anchors in the
 * document (including those inside nav/header/footer). Pure, no I/O.
 */
export function findScheduleLink(html: string, baseUrl: string): string | null {
  const re = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  // Expanded keyword set: original terms plus common alternatives used by
  // station sites whose schedule link doesn't say "schedule" or "shows".
  const keywords =
    /schedule|programming|program\s?guide|shows|line-?up|on[\s-]?air|timetable|calendar|broadcast|playlist|listen\s?live|grid/i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1]!;
    const label = htmlToPlainText(m[2] ?? "");
    if (keywords.test(href) || keywords.test(label)) {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Well-known URL path suffixes that radio stations commonly use for their
 * schedule pages. Probed in order; the first live (200/3xx-same-domain) URL
 * wins. Pure list — no I/O here.
 */
export const SCHEDULE_PATH_PROBES = [
  "/schedule",
  "/programming",
  "/shows",
  "/on-air",
  "/timetable",
  "/programme",
];

/**
 * Probe common schedule URL suffixes with HEAD requests. Returns the first
 * URL that responds with 200 or a redirect that stays on the same origin.
 * Returns null when all probes fail or robots.txt disallows.
 */
export async function probeScheduleUrl(
  origin: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<string | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  for (const path of SCHEDULE_PATH_PROBES) {
    const url = `${origin}${path}`;
    try {
      const res = await fetchFn(url, {
        method: "HEAD",
        headers: { "User-Agent": "Lore-Discovery-Bot/1.0" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (res.ok) {
        // Ensure the final URL (after any redirect) is still on the same origin.
        let finalOrigin: string;
        try {
          finalOrigin = new URL(res.url || url).origin;
        } catch {
          continue;
        }
        if (finalOrigin === origin) return res.url || url;
      } else if (res.status === 405) {
        // Server rejected HEAD — retry with a lightweight GET to confirm the
        // page actually exists (read only enough bytes to verify a response).
        try {
          const getRes = await fetchFn(url, {
            method: "GET",
            headers: { "User-Agent": "Lore-Discovery-Bot/1.0", Range: "bytes=0-511" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            redirect: "follow",
          });
          if (getRes.ok || getRes.status === 206) {
            let finalOrigin: string;
            try {
              finalOrigin = new URL(getRes.url || url).origin;
            } catch {
              continue;
            }
            if (finalOrigin === origin) return getRes.url || url;
          }
        } catch {
          // GET also failed — try the next probe path.
        }
      }
    } catch {
      // Timeout / network error for this probe — try the next one.
    }
  }
  return null;
}

/**
 * Returns true when an HTTP status code indicates the schedule URL is
 * permanently gone (404 Not Found, 410 Gone). Transient failures (5xx,
 * timeout — represented as null) return false so a momentary outage never
 * discards a pre-known URL. Pure, no I/O.
 */
export function isScheduleUrlPermanentlyGone(status: number | null): boolean {
  return status === 404 || status === 410;
}

/**
 * Heuristic: does this HTML body already contain an inline schedule?
 * Looks for the presence of at least 3 day-of-week abbreviations AND at least
 * 2 HH:MM time patterns in the visible text. Pure, no I/O.
 */
export function homepageLooksLikeSchedule(html: string): boolean {
  const text = htmlToPlainText(html);
  // Accept both three-letter abbreviations (Mon) and full names (Monday).
  const dayRe =
    /\b(Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/gi;
  const timeRe = /\b([01]\d|2[0-3]):[0-5]\d\b/g;
  const days = text.match(dayRe) ?? [];
  const times = text.match(timeRe) ?? [];
  // Require at least 3 distinct day tokens and at least 2 time tokens so a
  // passing mention of "Monday" + "10am" in normal prose doesn't trigger it.
  // Normalise to lowercase 3-letter key so "Mon" and "Monday" don't inflate
  // the distinct-day count (both collapse to "mon").
  const uniqueDays = new Set(days.map((d) => d.slice(0, 3).toLowerCase()));
  return uniqueDays.size >= 3 && times.length >= 2;
}

/**
 * Validate + normalize the LLM's raw JSON response into extracted shows.
 * Rejects (returns null) anything malformed or ambiguous rather than
 * guessing — the caller stores nothing for that station on a null result.
 * Pure, no I/O.
 */
export function parseExtractedSchedule(raw: string): ExtractedShow[] | null {
  let jsonText = raw.trim();
  // Tolerate a fenced code block, but nothing fancier — anything else is
  // treated as low-confidence.
  const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) jsonText = fenced[1]!.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const out: ExtractedShow[] = [];
  // The DB's unique key is (stationId, dayOfWeek, startTime, showName); an
  // LLM can plausibly emit the same slot twice even with prompt
  // instructions not to, which would otherwise throw on insert. Dedupe on
  // that same key here so validation is the single source of truth for
  // "well-formed", rather than relying on the DB constraint to catch it.
  const seenSlots = new Set<string>();
  // Sanitize stored names the same way the slot key is normalised: invisible/
  // odd whitespace (zero-widths, NBSP, narrow NBSP, word joiner, directional
  // marks, …) mapped to a space, whitespace collapsed, trimmed. Otherwise
  // whichever variant the LLM emits FIRST is what gets stored —
  // "Morning\u200BJazz" renders as "MorningJazz" in the schedule UI and
  // breaks text matching against the clean name. Shared with the boot-time
  // DB cleanup via schedule-name-sanitizer.ts so the two can't drift.
  const sanitizeName = sanitizeScheduleName;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const showName = typeof e["showName"] === "string" ? sanitizeName(e["showName"]) : "";
    const dayOfWeek = normalizeDayOfWeek(
      typeof e["dayOfWeek"] === "string" ? e["dayOfWeek"].trim() : "",
    );
    const startTime = typeof e["startTime"] === "string" ? e["startTime"].trim() : "";
    const endTime = typeof e["endTime"] === "string" ? e["endTime"].trim() : "";
    const djNameRaw = typeof e["djName"] === "string" ? sanitizeName(e["djName"]) : "";
    // A schedule can identify a show host, but it cannot prove that a value
    // equal to the show title is a person. Keep the source-backed show and
    // drop only unusable attribution; sync applies the same rule again.
    const djName = eligibleDjName(djNameRaw, { showTitle: showName }) ?? null;

    if (!showName || showName.length > 200) continue;
    if (!DAY_TOKENS.has(dayOfWeek)) continue;
    if (!HHMM_RE.test(startTime) || !HHMM_RE.test(endTime)) continue;

    // showName is already sanitized above (invisible chars → space, collapsed,
    // trimmed), so the slot key only needs case folding on top of it.
    const slotKey = `${dayOfWeek}|${startTime}|${showName.toLowerCase()}`;
    if (seenSlots.has(slotKey)) continue;
    seenSlots.add(slotKey);

    out.push({ showName, dayOfWeek, startTime, endTime, djName });
  }

  // Unlike a malformed individual row, an overlap makes the whole extracted
  // schedule ambiguous. Returning null preserves the distinction between
  // extraction failure and a legitimate empty schedule and prevents a partial
  // replacement transaction from deleting the prior good grid.
  if (hasOverlappingScheduleSlots(out)) return null;

  // An empty-but-valid extraction (page had no schedule) is a legitimate
  // "nothing to store" result, not a parse failure — return it as-is so the
  // caller can distinguish "no schedule" from "extraction failed".
  return out.slice(0, MAX_SHOWS_PER_STATION);
}

const EXTRACTION_PROMPT = `You are extracting a radio station's upcoming weekly show schedule from
the raw text of its website below. Return ONLY a JSON array (no prose, no
markdown fences) of objects shaped exactly like:
{"showName": string, "dayOfWeek": "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun", "startTime": "HH:MM" (24h), "endTime": "HH:MM" (24h), "djName": string|null}

Times MUST be in 24-hour HH:MM format (two-digit hour, colon, two-digit
minute). Rejected formats — do NOT use these:
  - AM/PM: "9:00 AM", "2:00pm", "11:30 PM"  → WRONG
  - Single-digit hour: "9:00", "8:30"         → WRONG (must be "09:00", "08:30")
  - Correct examples: "09:00", "14:00", "23:30"

Rules:
- Only include a show if the page states its day AND a start and end time.
- Never invent, guess, or infer a time or day that is not explicitly stated.
- If the page does not contain a real schedule (e.g. it's just a homepage
  with no programming grid), return an empty JSON array: []
- Do not include duplicate entries for the same show/day/time.

Page text:
`;

/**
 * Scrape one station's schedule. Never throws. Only replaces the station's
 * stored schedule when extraction produced a well-formed result (including
 * a legitimate empty array); a fetch/robots/LLM failure leaves any
 * previously-scraped schedule in place.
 */
export async function scrapeStationSchedule(
  target: ScrapeTarget,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<{ scraped: boolean; showCount: number }> {
  const fetchFn = opts.fetchFn ?? fetch;

  // Every return path below goes through this so scheduleAttemptedAt always
  // reflects the most recent attempt, success or failure — that's what lets
  // loadStaleTargets back off a persistently-failing station instead of
  // reselecting it on every single tick.
  const markAttempted = () =>
    db
      .update(stationsTable)
      .set({ scheduleAttemptedAt: new Date() })
      .where(eq(stationsTable.id, target.id));
  const fail = async (): Promise<{ scraped: false; showCount: 0 }> => {
    await markAttempted();
    return { scraped: false, showCount: 0 };
  };

  let origin: string;
  try {
    origin = new URL(target.homepageUrl).origin;
  } catch {
    return fail();
  }

  // A configured Spinitron calendar is a trusted, narrowly validated external
  // schedule provider. Check the provider's robots policy rather than the
  // station homepage's policy because no homepage content is fetched in this
  // path.
  const configuredSpinitronOrigin =
    target.scheduleUrl && isSpinitronCalendarUrl(target.scheduleUrl)
      ? new URL(target.scheduleUrl).origin
      : null;
  const crawlOrigin = configuredSpinitronOrigin ?? origin;
  if (await isCrawlBlocked(crawlOrigin, { fetchFn })) {
    console.info(
      `[schedule-scraper] give-up station=${target.id} slug=${target.slug} reason=robots_blocked origin=${crawlOrigin}`,
    );
    return fail();
  }

  // Returns the page text on success, null on transient error, or the HTTP
  // status code (as a number) when the server responded definitively (non-2xx).
  const fetchPage = async (url: string): Promise<string | null | number> => {
    try {
      const res = await fetchFn(url, {
        headers: { Accept: "text/html", "User-Agent": "Lore-Discovery-Bot/1.0" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return res.status;
      return await res.text();
    } catch {
      return null;
    }
  };

  // When a pre-known schedule URL is configured, fetch it directly and skip
  // the homepage fetch + link-discovery step entirely. This bypasses JS-
  // rendered nav menus and other homepage structures that hide the schedule
  // link from a plain HTML anchor scan. Same origin-safety check applies.
  let pageHtml: string | null = null;
  let sourceUrl: string | null = null;
  if (target.scheduleUrl) {
    let scheduleOrigin: string | null = null;
    try {
      scheduleOrigin = new URL(target.scheduleUrl).origin;
    } catch {
      /* origin stays null */
    }
    if (scheduleOrigin === origin || configuredSpinitronOrigin === scheduleOrigin) {
      // Fetch with explicit status capture so we can distinguish permanent
      // failures (404/410 — the page is definitively gone) from transient ones
      // (5xx, timeout, network error) where the pre-known URL may still be valid.
      let scheduleStatus: number | null = null;
      try {
        const requestInit = {
          headers: { Accept: "text/html", "User-Agent": "Lore-Discovery-Bot/1.0" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        };
        const res = configuredSpinitronOrigin
          ? await fetchSpinitronRespectfully(fetchFn, target.scheduleUrl, requestInit)
          : await fetchFn(target.scheduleUrl, requestInit);
        scheduleStatus = res.status;
        if (res.ok) {
          pageHtml = await res.text();
          sourceUrl = target.scheduleUrl;
        }
      } catch {
        // Timeout or network error — scheduleStatus stays null (transient).
      }

      if (pageHtml) {
        console.info(
          `[schedule-scraper] using pre-known schedule URL for ${target.slug}: ${target.scheduleUrl}`,
        );
      } else if (isScheduleUrlPermanentlyGone(scheduleStatus)) {
        // Permanent failure: the schedule page is definitively gone. Clear the
        // stored URL so the full discovery flow runs on future attempts.
        // Transient failures (5xx, timeout, network error) leave the URL intact
        // so a working pre-known URL isn't discarded because of a momentary outage.
        console.info(
          `[schedule-scraper] stale scheduleUrl cleared for ${target.slug} (HTTP ${scheduleStatus}): ${target.scheduleUrl} — falling through to discovery`,
        );
        try {
          await db
            .update(stationsTable)
            .set({ scheduleUrl: null })
            .where(eq(stationsTable.id, target.id));
        } catch (err) {
          // Non-fatal — worst case the next scrape tries the stale URL again.
          console.warn(
            `[schedule-scraper] failed to clear stale scheduleUrl for ${target.slug}`,
            err,
          );
        }
      } else {
        // Transient failure (5xx, timeout, network error) — fall through to
        // discovery without clearing the pre-known URL.
        if (scheduleStatus !== null) {
          console.info(
            `[schedule-scraper] pre-known scheduleUrl returned HTTP ${scheduleStatus} for ${target.slug} — treating as transient, keeping URL`,
          );
        } else {
          console.info(
            `[schedule-scraper] pre-known scheduleUrl fetch timed out for ${target.slug} — treating as transient, keeping URL`,
          );
        }
      }
      // Transient failure (null) or non-definitive error (5xx etc.): fall
      // through to discovery without clearing the stored URL.
    } else {
      console.warn(
        `[schedule-scraper] scheduleUrl is off-site for ${target.slug}, ignoring: ${target.scheduleUrl}`,
      );
    }
  }

  // Fall back to homepage + link-discovery when no pre-known schedule URL
  // was configured or the direct fetch failed.
  //
  // Discovery strategy (in order, short-circuit on first win):
  //   1. Anchor scan: findScheduleLink on the homepage HTML.
  //   2. Common-path probing: HEAD-check well-known suffixes (/schedule, etc).
  //   3. Inline schedule: homepage itself looks like a schedule (day + time tokens).
  //
  // The URL found by probing or inline detection is written back to
  // stations.scheduleUrl so future re-scrapes skip discovery entirely.
  let discoveredScheduleUrl: string | null = null;

  if (!pageHtml) {
    const homeResult = await fetchPage(target.homepageUrl);
    const homeHtml = typeof homeResult === "string" ? homeResult : null;
    if (!homeHtml) {
      console.info(
        `[schedule-scraper] give-up station=${target.id} slug=${target.slug} reason=no_link_found (homepage fetch failed)`,
      );
      return fail();
    }

    // --- Strategy 1: anchor scan ---
    const scheduleLink = findScheduleLink(homeHtml, target.homepageUrl);
    if (scheduleLink) {
      let scheduleOrigin: string | null = null;
      try {
        scheduleOrigin = new URL(scheduleLink).origin;
      } catch {
        /* origin stays null */
      }
      if (scheduleOrigin === origin) {
        const linkedResult = await fetchPage(scheduleLink);
        if (typeof linkedResult === "string") {
          pageHtml = linkedResult;
          discoveredScheduleUrl = scheduleLink;
          sourceUrl = scheduleLink;
        }
      } else {
        console.info(
          `[schedule-scraper] ignoring off-site schedule link for ${target.slug}: ${scheduleLink}`,
        );
      }
    }

    // --- Strategy 2: common-path URL probing ---
    if (!pageHtml) {
      const probedUrl = await probeScheduleUrl(origin, { fetchFn });
      if (probedUrl) {
        const probedResult = await fetchPage(probedUrl);
        if (typeof probedResult === "string") {
          pageHtml = probedResult;
          discoveredScheduleUrl = probedUrl;
          sourceUrl = probedUrl;
          console.info(
            `[schedule-scraper] probed schedule URL for ${target.slug}: ${probedUrl}`,
          );
        }
      }
    }

    // --- Strategy 3: homepage already contains an inline schedule ---
    if (!pageHtml) {
      if (homepageLooksLikeSchedule(homeHtml)) {
        pageHtml = homeHtml;
        sourceUrl = target.homepageUrl;
        // No external URL to persist — the homepage itself is the schedule source.
        console.info(
          `[schedule-scraper] using homepage as inline schedule for ${target.slug}`,
        );
      }
    }

    if (!pageHtml) {
      console.info(
        `[schedule-scraper] give-up station=${target.id} slug=${target.slug} reason=probe_exhausted`,
      );
      return fail();
    }

    // Persist the newly-discovered schedule URL so future re-scrapes skip
    // discovery and go straight to the known page.
    if (discoveredScheduleUrl) {
      try {
        await db
          .update(stationsTable)
          .set({ scheduleUrl: discoveredScheduleUrl })
          .where(eq(stationsTable.id, target.id));
      } catch (err) {
        // Non-fatal — worst case the next scrape rediscovers the URL.
        console.warn(
          `[schedule-scraper] failed to persist scheduleUrl for ${target.slug}`,
          err,
        );
      }
    }
  }

  let shows: ExtractedShow[] | null;
  let datedExceptions: DatedExtractedShow[] = [];
  let extraction: "api" | "llm" = "llm";
  const feedUrl = sourceUrl ? spinitronCalendarFeedUrl(sourceUrl, pageHtml) : null;
  // A Spinitron calendar without a usable public feed is not a page for the
  // LLM fallback: its dynamic grid is absent from visible HTML. Treat a bad
  // configuration as a failed scrape so the prior schedule remains intact.
  if (sourceUrl && isSpinitronCalendarUrl(sourceUrl) && !feedUrl) return fail();
  if (feedUrl) {
    // This is Spinitron's unauthenticated, browser-facing calendar endpoint,
    // not its authenticated developer API. Keep redirect safety equivalent to
    // discovery: a feed must finish on the calendar page's origin.
    try {
      const res = await fetchSpinitronRespectfully(fetchFn, feedUrl, {
        headers: { Accept: "application/json", "User-Agent": "Lore-Discovery-Bot/1.0" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const calendarOrigin = new URL(sourceUrl!).origin;
      if (!res.ok || new URL(res.url || feedUrl).origin !== calendarOrigin) return fail();
      const requestedWindow = {
        start: new URL(feedUrl).searchParams.get("start")!,
        end: new URL(feedUrl).searchParams.get("end")!,
      };
      const parsed = parseSpinitronCalendarFeedWithExceptions(await res.text(), requestedWindow);
      shows = parsed?.recurringShows ?? null;
      datedExceptions = parsed?.datedExceptions ?? [];
      extraction = "api";
    } catch (err) {
      console.warn(`[schedule-scraper] Spinitron feed failed for ${target.slug}`, err);
      return fail();
    }
  } else {
    // Prefer exact, first-party structured representations before asking the
    // LLM to interpret rendered HTML. WordPress advertises the exact REST URL
    // for its schedule page; Google Calendar embeds advertise a public ICS;
    // public-radio CMS pages commonly publish schema.org Event JSON-LD inline.
    let structured: ExtractedShow[] | null = null;
    let structuredSourceUrl = sourceUrl;
    const wpUrl = sourceUrl ? wordpressPageApiUrl(sourceUrl, pageHtml) : null;
    const calendarUrl = sourceUrl ? googleCalendarIcsUrl(sourceUrl, pageHtml) : null;
    const cadence = sourceUrl ? cadenceScheduleSource(sourceUrl, pageHtml) : null;
    if (wpUrl) {
      const result = await fetchPage(wpUrl);
      if (typeof result === "string") {
        const rendered = wordpressRenderedContent(result);
        if (rendered) {
          structured = parseStructuredScheduleHtml(rendered);
          structuredSourceUrl = wpUrl;
        }
      }
    }
    // JSON-LD and deterministic schedule markup may be emitted directly by a
    // non-WordPress CMS. For WordPress, prefer the advertised REST receipt
    // above even when the rendered page happens to contain the same markup.
    if (!structured) structured = parseStructuredScheduleHtml(pageHtml);
    if (!structured && calendarUrl) {
      const result = await fetchPage(calendarUrl);
      if (typeof result === "string") {
        structured = parseCalendarIcs(result);
        structuredSourceUrl = calendarUrl;
      }
    }
    if (!structured && cadence) {
      try {
        const week = spinitronWeekWindow();
        const res = await fetchFn(cadence.endpointUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Lore-Discovery-Bot/1.0",
          },
          body: JSON.stringify({
            channelId: cadence.channelId,
            startDate: week.start,
            endDate: week.end,
            from: 0,
            size: 10_000,
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (res.ok) {
          structured = parseCadenceSchedule(await res.text());
          structuredSourceUrl = cadence.receiptUrl;
        }
      } catch {
        // The rendered official page remains available to the LLM fallback.
      }
    }
    if (structured) {
      shows = parseExtractedSchedule(JSON.stringify(structured));
      sourceUrl = structuredSourceUrl;
      extraction = "api";
    } else {
      const pageText = htmlToPlainText(pageHtml).slice(0, MAX_PAGE_CHARS);
      if (!pageText) return fail();
      try {
        const raw = await extractScheduleRaw(`${EXTRACTION_PROMPT}${pageText}`);
        shows = parseExtractedSchedule(raw);
      } catch (err) {
        console.warn(`[schedule-scraper] extraction failed for ${target.slug}`, err);
        return fail();
      }
    }
  }

  if (shows === null) {
    console.info(
      `[schedule-scraper] give-up station=${target.id} slug=${target.slug} reason=llm_empty (unparseable result)`,
    );
    return fail();
  }

  const now = new Date();
  try {
    const receiptSourceUrl = requireSourceUrl(sourceUrl);
    await db.transaction(async (tx) => {
      await tx.delete(scrapedShowsTable).where(eq(scrapedShowsTable.stationId, target.id));
      await tx
        .delete(scrapedShowExceptionsTable)
        .where(eq(scrapedShowExceptionsTable.stationId, target.id));
      if (shows!.length > 0) {
        await tx
          .insert(scrapedShowsTable)
          .values(
            shows!.map((s) => ({
              stationId: target.id,
              showName: s.showName,
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime,
              djName: s.djName,
              sourceUrl: receiptSourceUrl,
              scrapedAt: now,
               extraction,
            })),
          )
          // Validation already dedupes on the same key as the unique index,
          // but insert must not throw even if that ever drifts (e.g. index
          // changes, validation bug) — a write failure here must never
          // starve the batch by leaving scheduleAttemptedAt unset.
          .onConflictDoNothing();
      }
      if (datedExceptions.length > 0) {
        await tx
          .insert(scrapedShowExceptionsTable)
          .values(
            datedExceptions.map((s) => ({
              stationId: target.id,
              showName: s.showName,
              airDate: s.airDate,
              startTime: s.startTime,
              endTime: s.endTime,
              djName: s.djName,
              sourceUrl: receiptSourceUrl,
              scrapedAt: now,
              extraction: "api",
            })),
          )
          .onConflictDoNothing();
      }
      // Stamp both freshness markers AND the denormalized show count in the
      // same transaction as the row swap so they are always consistent:
      // - scheduleScrapedAt / scheduleAttemptedAt drive the re-scrape cadence
      // - upcomingShowCount lets GET /api/stations avoid a second round-trip
      await tx
        .update(stationsTable)
        .set({
          scheduleScrapedAt: now,
          scheduleAttemptedAt: now,
          upcomingShowCount: shows!.length + datedExceptions.length,
        })
        .where(eq(stationsTable.id, target.id));
    });
  } catch (err) {
    console.warn(`[schedule-scraper] write failed for ${target.slug}`, err);
    return fail();
  }

  // Backfill iana_timezone for stations that gained scraped_shows but have no
  // timezone yet.  Without a timezone, scoreCrossingCandidates() cannot enter
  // the show-scoped scoring path and silently falls back to the station-wide
  // average — so any station that has schedule data should also have a
  // timezone.  This runs outside the schedule transaction (best-effort: a
  // failure here must not roll back the freshly-written shows) and is a
  // no-op when the timezone was already set.
  if ((shows.length > 0 || datedExceptions.length > 0) && !target.ianaTimezone) {
    const tz = inferTimezone(target.city, target.country);
    if (tz) {
      try {
        await db
          .update(stationsTable)
          .set({ ianaTimezone: tz })
          .where(eq(stationsTable.id, target.id));
        console.info(
          `[schedule-scraper] backfilled ianaTimezone="${tz}" for ${target.slug} after schedule scrape`,
        );
      } catch (err) {
        // Non-fatal — the timezone is a best-effort optimisation; the show
        // data was already committed successfully.
        console.warn(`[schedule-scraper] timezone backfill failed for ${target.slug}`, err);
      }
    }
  }

  return { scraped: true, showCount: shows.length + datedExceptions.length };
}

let started = false;
let timer: NodeJS.Timeout | null = null;

/** Start the schedule-scraper loop. Idempotent — safe to call once at boot. */
export function startScheduleScraper(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const targets = await loadStaleTargets(BATCH_SIZE);
      for (const target of targets) {
        // Isolate each station: an unexpected throw from one station (e.g.
        // a bug outside scrapeStationSchedule's own try/catch coverage)
        // must not abort the rest of the batch.
        try {
          await scrapeStationSchedule(target);
        } catch (err) {
          console.error(`[schedule-scraper] unexpected error for ${target.slug}`, err);
        }
      }
    } catch (err) {
      console.error("[lore] schedule scraper tick failed", err);
    }
    timer = setTimeout(tick, TICK_MS);
  };
  timer = setTimeout(tick, WARMUP_MS);
}

/** Stop the schedule scraper (tests / graceful shutdown). */
export function stopScheduleScraper(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}
