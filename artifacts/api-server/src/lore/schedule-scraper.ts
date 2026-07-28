import { db, stationsTable, scrapedShowsTable } from "@workspace/db";
import { and, eq, isNotNull, lt, or, isNull, sql } from "drizzle-orm";
import { isCrawlBlocked } from "./blog-crossref.js";
import { extractScheduleRaw } from "./schedule-llm.js";
import { inferTimezone } from "./timezone.js";

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
const MAX_SHOWS_PER_STATION = 40;

const DAY_TOKENS = new Set([
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
]);

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const showName = typeof e["showName"] === "string" ? e["showName"].trim() : "";
    const dayOfWeek = typeof e["dayOfWeek"] === "string" ? e["dayOfWeek"].trim() : "";
    const startTime = typeof e["startTime"] === "string" ? e["startTime"].trim() : "";
    const endTime = typeof e["endTime"] === "string" ? e["endTime"].trim() : "";
    const djName =
      typeof e["djName"] === "string" && e["djName"].trim() ? e["djName"].trim() : null;

    if (!showName || showName.length > 200) continue;
    if (!DAY_TOKENS.has(dayOfWeek)) continue;
    if (!HHMM_RE.test(startTime) || !HHMM_RE.test(endTime)) continue;

    const slotKey = `${dayOfWeek}|${startTime}|${showName.toLowerCase()}`;
    if (seenSlots.has(slotKey)) continue;
    seenSlots.add(slotKey);

    out.push({ showName, dayOfWeek, startTime, endTime, djName });
  }

  // An empty-but-valid extraction (page had no schedule) is a legitimate
  // "nothing to store" result, not a parse failure — return it as-is so the
  // caller can distinguish "no schedule" from "extraction failed".
  return out.slice(0, MAX_SHOWS_PER_STATION);
}

const EXTRACTION_PROMPT = `You are extracting a radio station's upcoming weekly show schedule from
the raw text of its website below. Return ONLY a JSON array (no prose, no
markdown fences) of objects shaped exactly like:
{"showName": string, "dayOfWeek": "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun", "startTime": "HH:MM" (24h), "endTime": "HH:MM" (24h), "djName": string|null}

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

  if (await isCrawlBlocked(origin, { fetchFn })) {
    console.info(
      `[schedule-scraper] give-up station=${target.id} slug=${target.slug} reason=robots_blocked origin=${origin}`,
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
  if (target.scheduleUrl) {
    let scheduleOrigin: string | null = null;
    try {
      scheduleOrigin = new URL(target.scheduleUrl).origin;
    } catch {
      scheduleOrigin = null;
    }
    if (scheduleOrigin === origin) {
      // Fetch with explicit status capture so we can distinguish permanent
      // failures (404/410 — the page is definitively gone) from transient ones
      // (5xx, timeout, network error) where the pre-known URL may still be valid.
      let scheduleStatus: number | null = null;
      try {
        const res = await fetchFn(target.scheduleUrl, {
          headers: { Accept: "text/html", "User-Agent": "Lore-Discovery-Bot/1.0" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        scheduleStatus = res.status;
        if (res.ok) {
          pageHtml = await res.text();
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
        scheduleOrigin = null;
      }
      if (scheduleOrigin === origin) {
        const linkedResult = await fetchPage(scheduleLink);
        if (typeof linkedResult === "string") {
          pageHtml = linkedResult;
          discoveredScheduleUrl = scheduleLink;
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

  const pageText = htmlToPlainText(pageHtml).slice(0, MAX_PAGE_CHARS);
  if (!pageText) return fail();

  let shows: ExtractedShow[] | null;
  try {
    const raw = await extractScheduleRaw(`${EXTRACTION_PROMPT}${pageText}`);
    shows = parseExtractedSchedule(raw);
  } catch (err) {
    console.warn(`[schedule-scraper] extraction failed for ${target.slug}`, err);
    return fail();
  }

  if (shows === null) {
    console.info(
      `[schedule-scraper] give-up station=${target.id} slug=${target.slug} reason=llm_empty (unparseable result)`,
    );
    return fail();
  }

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.delete(scrapedShowsTable).where(eq(scrapedShowsTable.stationId, target.id));
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
            })),
          )
          // Validation already dedupes on the same key as the unique index,
          // but insert must not throw even if that ever drifts (e.g. index
          // changes, validation bug) — a write failure here must never
          // starve the batch by leaving scheduleAttemptedAt unset.
          .onConflictDoNothing();
      }
      // Stamp both freshness markers AND the denormalized show count in the
      // same transaction as the row swap so they are always consistent:
      // - scheduleScrapedAt / scheduleAttemptedAt drive the re-scrape cadence
      // - upcomingShowCount lets GET /api/stations avoid a second round-trip
      await tx
        .update(stationsTable)
        .set({ scheduleScrapedAt: now, scheduleAttemptedAt: now, upcomingShowCount: shows!.length })
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
  if (shows.length > 0 && !target.ianaTimezone) {
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

  return { scraped: true, showCount: shows.length };
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
