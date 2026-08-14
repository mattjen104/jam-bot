/**
 * Bandsintown event fetcher for the Shows lens.
 *
 * Responsibilities:
 *   - normalizeArtistKey  — stable cache key derivation
 *   - fetchAndStoreEvents — fetch upcoming events from Bandsintown and persist
 *     them in artist_events; maintains artist_events_cache for TTL gating
 *   - getStoredEvents     — read back cached events for a list of artist keys
 *
 * Rate-limit / concurrency:
 *   - At most MAX_CONCURRENT parallel Bandsintown fetches at a time.  Beyond
 *     that, callers queue and wait (still off the request hot path since the
 *     route fires background fetches and returns immediately).
 *   - Each fetch has a hard 10-second AbortController timeout.
 *   - Negative results (empty upcoming events list) are cached for 1 h so the
 *     API is not hammered for artists with no tour dates.
 *   - Positive results are cached for 6 h (event listings change slowly).
 *
 * Graceful degradation:
 *   - When BANDSINTOWN_APP_ID is not set, every fetch is a no-op (the route
 *     still reads whatever is in the DB, which starts empty, and returns
 *     computing:false so the client settles immediately with an honest
 *     "no events" state rather than looping).
 */

import { db, artistEventsTable, artistEventsCacheTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";

const FETCH_TIMEOUT_MS   = 10_000;
const POSITIVE_TTL_MS    =  6 * 60 * 60 * 1000; // 6 h
const NEGATIVE_TTL_MS    =  1 * 60 * 60 * 1000; // 1 h

const MAX_CONCURRENT = 5;
let _inFlight = 0;
const _queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (_inFlight < MAX_CONCURRENT) { _inFlight++; return Promise.resolve(); }
  return new Promise<void>((resolve) => _queue.push(resolve));
}

function releaseSlot(): void {
  const next = _queue.shift();
  if (next) { next(); } else { _inFlight--; }
}

// ---------------------------------------------------------------------------
// Artist key normalisation
// ---------------------------------------------------------------------------

/**
 * Stable, lowercase, ASCII-folded cache key derived from an artist display name.
 * Shared with the Shows route so DB lookups are always key-consistent.
 */
export function normalizeArtistKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

// ---------------------------------------------------------------------------
// Freshness check
// ---------------------------------------------------------------------------

async function isFresh(artistKey: string): Promise<boolean> {
  const rows = await db
    .select({ fetchedAt: artistEventsCacheTable.fetchedAt, eventCount: artistEventsCacheTable.eventCount })
    .from(artistEventsCacheTable)
    .where(eq(artistEventsCacheTable.artistKey, artistKey))
    .limit(1);
  if (rows.length === 0) return false;
  const { fetchedAt, eventCount } = rows[0]!;
  const ttl = eventCount === 0 ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
  return Date.now() - fetchedAt.getTime() < ttl;
}

// ---------------------------------------------------------------------------
// Bandsintown API types
// ---------------------------------------------------------------------------

interface BandsintownApiEvent {
  id?: unknown;
  datetime?: unknown;
  venue?: {
    name?: unknown;
    city?: unknown;
    region?: unknown;
    country?: unknown;
  };
  url?: unknown;
  offers?: Array<{ url?: unknown }>;
}

function parseApiEvents(
  artistKey: string,
  data: unknown,
): Array<{
  artistKey: string; eventId: string; eventDatetime: Date; eventDate: string;
  venueName: string | null; venueCity: string;
  venueRegion: string | null; venueCountry: string | null;
  ticketUrl: string | null;
}> {
  if (!Array.isArray(data)) return [];
  const now = new Date();
  const events = [];
  for (const raw of data as BandsintownApiEvent[]) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id : typeof raw.id === "number" ? String(raw.id) : null;
    const datetimeRaw = typeof raw.datetime === "string" ? raw.datetime : null;
    if (!id || !datetimeRaw) continue;
    const eventDatetime = new Date(datetimeRaw);
    if (Number.isNaN(eventDatetime.getTime()) || eventDatetime <= now) continue;
    const city = typeof raw.venue?.city === "string" ? raw.venue.city.trim() : null;
    if (!city) continue;
    const ticketUrl = raw.url
      ?? (Array.isArray(raw.offers) && raw.offers.length > 0 ? raw.offers[0]?.url : null) ?? null;
    events.push({
      artistKey,
      eventId: id,
      eventDatetime,
      eventDate: datetimeRaw.slice(0, 10),
      venueName: typeof raw.venue?.name === "string" ? raw.venue.name.trim() : null,
      venueCity: city,
      venueRegion: typeof raw.venue?.region === "string" && raw.venue.region.trim() ? raw.venue.region.trim() : null,
      venueCountry: typeof raw.venue?.country === "string" && raw.venue.country.trim() ? raw.venue.country.trim() : null,
      ticketUrl: typeof ticketUrl === "string" ? ticketUrl : null,
    });
  }
  events.sort((a, b) => a.eventDatetime.getTime() - b.eventDatetime.getTime());
  return events;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch upcoming events for `artistName` from Bandsintown and persist them.
 *
 * No-op when:
 *   - BANDSINTOWN_APP_ID is not configured
 *   - The cached entry is still fresh (within TTL)
 *
 * Errors (network failures, non-404 HTTP errors) are logged and swallowed —
 * the cached entry is NOT updated so stale data continues to be served.
 * A 404 (artist not found) is treated as a negative cache entry.
 */
export async function fetchAndStoreEvents(artistName: string): Promise<void> {
  const appId = process.env["BANDSINTOWN_APP_ID"];
  if (!appId) return; // graceful degradation — no secret configured

  const artistKey = normalizeArtistKey(artistName);
  if (!artistKey) return;

  if (await isFresh(artistKey)) return;

  await acquireSlot();
  try {
    // Re-check after acquiring slot — another worker may have done the work
    if (await isFresh(artistKey)) return;

    const url =
      `https://rest.bandsintown.com/artists/${encodeURIComponent(artistName)}/events` +
      `?app_id=${encodeURIComponent(appId)}&date=upcoming`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let events: ReturnType<typeof parseApiEvents> = [];
    let errorSkip = false;

    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (resp.status === 404) {
        events = []; // artist not found — negative cache
      } else if (!resp.ok) {
        console.error(`[bandsintown] HTTP ${resp.status} for artist="${artistName}"`);
        errorSkip = true;
      } else {
        const raw = await resp.json() as unknown;
        events = parseApiEvents(artistKey, raw);
      }
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      console.error(`[bandsintown] ${isAbort ? "timeout" : "fetch error"} for artist="${artistName}": ${err}`);
      errorSkip = true;
    }

    if (errorSkip) return; // do not cache transient errors

    const now = new Date();

    // Delete old events and insert new ones atomically via serial awaits
    // (Drizzle doesn't support explicit transactions here without a client ref)
    await db.delete(artistEventsTable).where(eq(artistEventsTable.artistKey, artistKey));
    if (events.length > 0) {
      await db.insert(artistEventsTable).values(
        events.map((e) => ({
          artistKey: e.artistKey,
          eventId: e.eventId,
          eventDatetime: e.eventDatetime,
          eventDate: e.eventDate,
          venueName: e.venueName,
          venueCity: e.venueCity,
          venueRegion: e.venueRegion,
          venueCountry: e.venueCountry,
          ticketUrl: e.ticketUrl,
          fetchedAt: now,
        })),
      );
    }

    await db
      .insert(artistEventsCacheTable)
      .values({ artistKey, fetchedAt: now, eventCount: events.length })
      .onConflictDoUpdate({
        target: artistEventsCacheTable.artistKey,
        set: { fetchedAt: now, eventCount: events.length },
      });

    console.info(`[bandsintown] artist="${artistName}" events=${events.length}`);
  } finally {
    releaseSlot();
  }
}

/**
 * Read upcoming events from the DB for a set of normalized artist keys.
 * Only future events (event_datetime >= now) are returned.
 */
export async function getStoredEvents(
  artistKeys: string[],
): Promise<typeof artistEventsTable.$inferSelect[]> {
  if (artistKeys.length === 0) return [];
  const now = new Date();
  const keySql = sql.join(artistKeys.map((k) => sql`${k}`), sql`, `);
  return db
    .select()
    .from(artistEventsTable)
    .where(
      and(
        sql`${artistEventsTable.artistKey} = ANY(ARRAY[${keySql}]::text[])`,
        gte(artistEventsTable.eventDatetime, now),
      ),
    )
    .orderBy(artistEventsTable.eventDatetime);
}
