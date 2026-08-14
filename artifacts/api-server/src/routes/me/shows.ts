/**
 * GET /api/me/shows — Shows lens: upcoming concerts for the listener's taste set.
 *
 * Taste sources queried (same set as crossings):
 *   - taste_seeds (user-supplied artist names)
 *   - library_items → recordings.artist (resolved MBID library)
 *   - spotify_library_items with null mbid (unresolved soft artists)
 *
 * Workflow:
 *   1. Fast-path: no taste → 200 { events:[], computing:false, hasTaste:false }.
 *   2. Read stored events for all taste artists from artist_events (DB).
 *   3. Fire background fetches (off hot path) for artists whose cache is stale;
 *      set computing:true while any fetch is pending.
 *   4. Return what's stored immediately (settled or stale-while-revalidate).
 *
 * City matching:
 *   When `?city=Portland, OR` is supplied, events whose venue city/region
 *   matches get nearCity:true and sort to the top of the list.  No geocoding —
 *   simple normalized string inclusion.
 *
 * Bandsintown attribution: clients must render "Powered by Bandsintown" per
 * Bandsintown API terms.  This route sets `x-bandsintown-powered: true` on
 * every response that includes event data.
 */

import { Router, type IRouter } from "express";
import {
  db,
  libraryItemsTable,
  recordingsTable,
  spotifyLibraryItemsTable,
  tasteSeedsTable,
} from "@workspace/db";
import { eq, and, isNull, ne } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";
import {
  normalizeArtistKey,
  fetchAndStoreEvents,
  getStoredEvents,
} from "../../lore/bandsintown-fetcher.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// City matching
// ---------------------------------------------------------------------------

function normalizeCity(city: string): string {
  return city
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesCity(
  query: string,
  venueCity: string,
  venueRegion: string | null,
): boolean {
  if (!query) return false;
  const q = normalizeCity(query);
  const city = normalizeCity(venueCity);
  const region = venueRegion ? normalizeCity(venueRegion) : "";
  const combined = region ? `${city} ${region}` : city;
  return (
    city.includes(q) ||
    (!!region && region.includes(q)) ||
    combined.includes(q) ||
    q.includes(city)
  );
}

// ---------------------------------------------------------------------------
// Taste artist collection
// ---------------------------------------------------------------------------

async function collectTasteArtistNames(userId: number): Promise<string[]> {
  const [libArtists, seedArtists, softArtists] = await Promise.all([
    // Resolved library: distinct artist names from recordings the user saved
    db
      .selectDistinct({ artist: recordingsTable.artist })
      .from(recordingsTable)
      .innerJoin(libraryItemsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
      .where(
        and(eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt)),
      )
      .limit(200),

    // Taste seeds
    db
      .selectDistinct({ artistName: tasteSeedsTable.artistName })
      .from(tasteSeedsTable)
      .where(eq(tasteSeedsTable.userId, userId)),

    // Unresolved Spotify imports
    db
      .selectDistinct({ artist: spotifyLibraryItemsTable.artist })
      .from(spotifyLibraryItemsTable)
      .where(
        and(
          eq(spotifyLibraryItemsTable.userId, userId),
          isNull(spotifyLibraryItemsTable.mbid),
          isNull(spotifyLibraryItemsTable.removedAt),
          ne(spotifyLibraryItemsTable.artist, ""),
        ),
      )
      .limit(200),
  ]);

  // Seeds first (user-entered taste signals), then library, then soft imports.
  // Deduplication by normalized key so "The Beatles" and "the beatles" merge.
  const seen = new Set<string>();
  const names: string[] = [];

  const add = (name: string) => {
    const key = normalizeArtistKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  for (const r of seedArtists) add(r.artistName);
  for (const r of libArtists) add(r.artist);
  for (const r of softArtists) add(r.artist);

  return names.slice(0, 300); // hard cap so the Bandsintown round-trips are bounded
}

// ---------------------------------------------------------------------------
// In-process fetch-trigger tracking (avoids firing N background jobs per page view)
// ---------------------------------------------------------------------------

const FETCH_COOLDOWN_MS = 15 * 60 * 1000; // 15 min
interface FetchEntry { triggeredAt: number }
const fetchCooldown = new Map<number, FetchEntry>();

/** Users whose background fetch batch is currently in flight.  While a user is
 *  in this set the route reports computing:true so the client keeps polling
 *  until the whole batch has landed — not just for the triggering request. */
const activeBatches = new Set<number>();

/** Batch-internal fan-out width.  Bounds BOTH the freshness-check DB queries
 *  and the upstream requests kicked off per user (the fetcher's own semaphore
 *  additionally caps upstream concurrency process-wide). */
const BATCH_WORKERS = 5;

async function runFetchBatch(userId: number, artistNames: string[]): Promise<void> {
  activeBatches.add(userId);
  try {
    const queue = [...artistNames];
    await Promise.all(
      Array.from({ length: Math.min(BATCH_WORKERS, queue.length) }, async () => {
        for (;;) {
          const name = queue.shift();
          if (name === undefined) return;
          try {
            await fetchAndStoreEvents(name);
          } catch (err) {
            console.error(`[shows] background fetch error for artist="${name}": ${err}`);
          }
        }
      }),
    );
  } finally {
    activeBatches.delete(userId);
  }
}

export function bustShowsCache(userId: number): void {
  fetchCooldown.delete(userId);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * GET /api/me/shows?city=Portland%2C+OR
 *
 * Response: { events, computing, hasTaste }
 *   computing — true while the user's background fetch batch is in flight
 *               (from the triggering request until the last artist has been
 *               checked); clients poll at ~5 s until it settles to false.
 *   hasTaste  — false when the listener has no library/seeds/soft imports.
 */
router.get(
  "/me/shows",
  h(async (req, res) => {
    const user = (req as AuthedRequest).loreUser;
    const cityParam =
      typeof req.query["city"] === "string" ? req.query["city"].trim() : null;

    // ── Taste fast-path ──────────────────────────────────────────────────────
    const [libRows, seedRows, softRows] = await Promise.all([
      db
        .select({ id: libraryItemsTable.id })
        .from(libraryItemsTable)
        .where(and(eq(libraryItemsTable.userId, user.id), isNull(libraryItemsTable.removedAt)))
        .limit(1),
      db
        .select({ id: tasteSeedsTable.id })
        .from(tasteSeedsTable)
        .where(eq(tasteSeedsTable.userId, user.id))
        .limit(1),
      db
        .select({ id: spotifyLibraryItemsTable.id })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, user.id),
            isNull(spotifyLibraryItemsTable.removedAt),
          ),
        )
        .limit(1),
    ]);
    const hasTaste = libRows.length > 0 || seedRows.length > 0 || softRows.length > 0;
    if (!hasTaste) {
      return res.json({ events: [], computing: false, hasTaste: false });
    }

    // ── Collect taste artists ─────────────────────────────────────────────────
    const artistNames = await collectTasteArtistNames(user.id);
    const artistKeys = artistNames.map(normalizeArtistKey).filter(Boolean);

    // ── Background fetch trigger (off hot path) ───────────────────────────────
    // Only trigger if Bandsintown is configured and the cooldown has expired.
    const cooldownEntry = fetchCooldown.get(user.id);
    const shouldTrigger =
      !!process.env["BANDSINTOWN_APP_ID"] &&
      (!cooldownEntry || Date.now() - cooldownEntry.triggeredAt >= FETCH_COOLDOWN_MS);

    if (shouldTrigger && !activeBatches.has(user.id)) {
      fetchCooldown.set(user.id, { triggeredAt: Date.now() });
      // Fire and forget — the response is built from what's already stored.
      // runFetchBatch marks the user active for the whole batch so subsequent
      // polls keep seeing computing:true until every artist has been checked.
      void runFetchBatch(user.id, artistNames);
    }
    const computing = activeBatches.has(user.id);

    // ── Read stored events ────────────────────────────────────────────────────
    const stored = await getStoredEvents(artistKeys);

    // Build response items with display artist name + city flag
    const events = stored.map((e) => {
      // Recover display artist name from the original list (round-trip via key)
      const displayName = artistNames.find((n) => normalizeArtistKey(n) === e.artistKey) ?? e.artistKey;
      const nearCity = cityParam ? matchesCity(cityParam, e.venueCity, e.venueRegion) : false;
      return {
        id: `${e.artistKey}:${e.eventId}`,
        artistName: displayName,
        eventDatetime: e.eventDatetime.toISOString(),
        eventDate: e.eventDate,
        venueName: e.venueName,
        venueCity: e.venueCity,
        venueRegion: e.venueRegion,
        venueCountry: e.venueCountry,
        ticketUrl: e.ticketUrl,
        nearCity,
      };
    });

    // Sort: near-city first (soonest-first within each band), then elsewhere
    if (cityParam) {
      events.sort((a, b) => {
        if (a.nearCity !== b.nearCity) return a.nearCity ? -1 : 1;
        return new Date(a.eventDatetime).getTime() - new Date(b.eventDatetime).getTime();
      });
    }
    // Already ordered by event_datetime from the DB query when no city split needed

    if (events.length > 0) {
      res.setHeader("x-bandsintown-powered", "true");
    }

    return res.json({ events, computing, hasTaste: true });
  }),
);

export default router;
