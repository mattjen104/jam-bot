import {
  db,
  stationsTable,
  radioBrowserStationsTable,
  stationExclusionsTable,
  type Station,
} from "@workspace/db";
import { sql, eq, and, isNull } from "drizzle-orm";
import { usableCoordinates } from "./station-location.js";

/**
 * radio-browser.info discovery worker.
 *
 * Queries radio-browser.info by genre tag, filters to live-checked stations
 * (lastcheckok=1), and upserts longtail candidates. New candidates are inserted
 * as active=false — the stream health worker promotes them after a successful
 * health check meeting the minimum bitrate threshold.
 *
 * Curated (source='curated') stations are never touched by this worker.
 */

const RADIO_BROWSER_HOST = "all.api.radio-browser.info";
const FETCH_TIMEOUT_MS = 15_000;
const RESULTS_PER_TAG = 200;

/**
 * Niche/underground genres aligned with the Lore taste profile (KEXP /
 * Radio Paradise / SomaFM audience). Only these tags trigger RadioBrowser
 * discovery — mainstream genres (pop, jazz, rock, edm, etc.) are excluded
 * because curated sources already cover them and RadioBrowser adds low-quality
 * duplicates there.
 */
export const RADIO_BROWSER_GENRE_WHITELIST = Object.freeze([
  "experimental",
  "avant-garde",
  "ambient",
  "drone",
  "noise",
  "idm",
  "shoegaze",
  "post-rock",
  "post-punk",
  "new wave",
  "minimal wave",
  "psychedelic",
  "modular synthesis",
  "electroacoustic",
  "free jazz",
  "nu-jazz",
  "alt-country",
  "americana",
  "folk",
  "world",
] as const);

export type RadioBrowserGenre = (typeof RADIO_BROWSER_GENRE_WHITELIST)[number];

/**
 * Name substrings (case-insensitive) that permanently disqualify a station
 * from RadioBrowser discovery, regardless of tags/bitrate/votes. Add brand
 * names here that slip in under a whitelisted genre tag despite being
 * low-quality/ad-heavy "lounge aggregator" style stations.
 *
 * **Important:** this guard only runs at ingest time. If you add a new entry
 * here you must also add the matching LIKE predicate to the companion boot
 * migration so that stations already in the database are retroactively hidden.
 * See `artifacts/api-server/src/lore/station-blocklist-hide-migration.ts`.
 */
/** Non-music utility streams excluded from Lore's music station catalogue. */
export const NON_MUSIC_UTILITY_PATTERNS = Object.freeze([
  "white noise",
  "rain sound",
  "sleep sound",
  "sleep radio",
  "baby sleep",
  "deep sleep",
  "sleeping pill",
  "music for sleep",
  "positively sleep",
  "nature radio sleep",
  "nature radio rain",
] as const);

export const RADIO_BROWSER_NAME_BLOCKLIST = Object.freeze([
  ...NON_MUSIC_UTILITY_PATTERNS,
  "epic lounge",
  // Single-artist stations don't fit Lore's mission of discovering music
  // through human-curated radio.  The "Exclusively X" family from Radio
  // Browser is the primary example; the prefix match catches all variants.
  "exclusively ",
  // Coffee-shop, covers, and algorithmic mood/background stations.
  "café calm",
  "cafe calm",
  "chillhop",
  "lofi girl",
  "lo-fi girl",
  "lofi hip hop",
  "lo-fi hip hop",
  "lofi hip-hop",
  "lo-fi hip-hop",
  "100 percent covers",
  "100% covers",
  // Coffee/cafe-named stations are background formats, not human-curated
  // programming ("#1 Splash Coffee", "Classical Coffee Bar", "COFFEE LOUNGE").
  "coffee",
  "cafe radio",
  "café radio",
  "radio cafe",
  "radio café",
  "lounge cafe",
  "lounge café",
  "cafe del mar",
  "café del mar",
  "hotel lounge",
  // "0R - <MOOD>" is an algorithmic mood-channel brand (HOTEL LOUNGE,
  // ROMANTIC PIANO, PIANO JAZZ LOUNGE, …).
  "0r - ",
  "study beats",
  "study lofi",
  "chill beats",
  "relaxing music",
  "background music",
  // Saudi Broadcasting Authority / commercial Gulf stations arriving through
  // the "world" tag — state/commercial pop programming, not human-curated
  // music discovery ("Saudia Radio 87.7 FM", "SBA Riyadh Radio 91.5 FM",
  // "MBC Loud 94.3 FM", "Galaxy FM KSA 99.9").
  "saudia radio",
  "sba riyadh",
  "sba jeddah",
  "sba saudia",
  "mbc loud",
  "galaxy fm ksa",
  // "#1 Splash <MOOD>" is an algorithmic background-channel brand (Spa, Jazz,
  // Coffee, …); only the Coffee variant was caught by the "coffee" entry.
  "#1 splash",
  // Syndicated brand subchannels with generic mood/format programming rather
  // than a distinct human selector identity.
  "drgnu -",
  "antenne niedersachsen relax",
] as const);

/**
 * Designated SomaFM musical ambient channels: Drone Zone, Groove Salad, and
 * Space Station. Matched by channel name (case-insensitive)
 * whenever the station name also mentions SomaFM — this covers every naming
 * variant in the database ("SomaFM — Drone Zone", "SomaFM Groove Salad
 * (128k MP3)", "SomaFM Space Station Soma (128k AAC)", "SomaFM Groove Salad
 * Classic", …) without needing per-variant slugs.
 */
export const SOMAFM_SLEEP_CHANNELS = Object.freeze([
  "drone zone",
  "groove salad",
  "space station",
] as const);

/**
 * Exact slugs for designated SomaFM sleep/ambient stations that should be
 * classified as sleep mode rather than blocked entirely. Kept alongside the
 * name-based SOMAFM_SLEEP_CHANNELS match as a belt-and-suspenders guard for
 * rows whose name lost the "SomaFM" prefix.
 */
export const SLEEP_STATION_SLUGS = Object.freeze([
  "somafm-drone-zone",
  "somafm-dronezone",
  "drone-zone",
  "somafm-groove-salad",
  "somafm-groovesalad",
  "groove-salad",
  "somafm-space-station",
  "somafm-spacestation",
  "space-station",
] as const);

function isNameBlocked(name: string | null | undefined): boolean {
  const lower = (name ?? "").toLowerCase();
  return RADIO_BROWSER_NAME_BLOCKLIST.some((b) => lower.includes(b));
}

/**
 * Heuristic: does a station name suggest a university or college campus station?
 *
 * Radio Browser doesn't supply an org/affiliation field, so we classify from
 * the station name alone.  Patterns cover the most common English and Romance/
 * Germanic university naming conventions seen in the radio-browser corpus.
 *
 * Used in `upsertRadioBrowserStations` to derive the "college" tag for stations
 * that radio-browser itself doesn't label as "college" in their tags field.
 * Intentionally conservative (word-boundary / suffix anchored) to avoid false
 * positives — a mis-tag is worse than a miss here.
 */
export function isCollegeStation(name: string | null | undefined): boolean {
  if (!name) return false;
  // Regex: case-insensitive, word-boundary or suffix anchored where possible.
  return (
    /\buniversity\b/i.test(name) ||
    /\buniversit[éèê]\b/i.test(name) ||
    /\buniversidade\b/i.test(name) ||
    /\buniversidad\b/i.test(name) ||
    /\buniversit[äa]t\b/i.test(name) ||
    /\buniversit[àá]\b/i.test(name) ||
    // "college" as a standalone word — avoids "College de France" being a
    // false-negative while still catching "Boston College Radio" etc.
    /\bcollege\b/i.test(name) ||
    /\bcampus\s+(?:radio|fm|station)\b/i.test(name)
  );
}

/**
 * Era/decade name patterns (case-insensitive, word-boundary matched):
 * decades (40s–00s and German 40er–90er forms), oldies, retro, revival,
 * decade, gen x, flower power, classic hits, classic rock, plus "80s80s".
 */
export const ERA_GENRE_ERA_PATTERNS = Object.freeze([
  "40s",
  "50s",
  "60s",
  "70s",
  "80s",
  "90s",
  "00s",
  "40er",
  "50er",
  "60er",
  "70er",
  "80er",
  "90er",
  "80s80s",
  "oldies",
  "retro",
  "revival",
  "decade",
  "gen x",
  "flower power",
  "classic hits",
  "classic rock",
] as const);
/**
 * Check if a station belongs to the legacy server-side ambient pool.
 * Only musical ambient channels qualify; sleep aids, nature sounds, and
 * white-noise utilities are permanently excluded by the name blocklist.
 */
export function isSleepStation(name: string | null | undefined, slug?: string | null): boolean {
  const lower = (name ?? "").toLowerCase();
  // SomaFM ambient channels — matched by channel name so every bitrate/format
  // variant row ("SomaFM Groove Salad (128k MP3)", "SomaFM — Drone Zone", …)
  // classifies consistently.
  if (
    lower.includes("somafm") &&
    SOMAFM_SLEEP_CHANNELS.some((c) => lower.includes(c))
  ) {
    return true;
  }
  if (slug) return (SLEEP_STATION_SLUGS as readonly string[]).includes(slug);
  return false;
}

/**
 * Seeded genre tags — these drive cold-start discovery before user-library
 * genre expansion is available. All entries must be in RADIO_BROWSER_GENRE_WHITELIST.
 */
export const SEED_GENRE_TAGS: string[] = [
  "experimental",
  "ambient",
  "drone",
  "noise",
  "idm",
  "shoegaze",
  "post-rock",
  "post-punk",
  "new wave",
  "psychedelic",
  "avant-garde",
  "folk",
  "world",
  "nu-jazz",
  "alt-country",
  "americana",
];

/** Minimum bitrate (kbps) required to accept or promote a longtail station. */
export const MIN_BITRATE_KBPS = 128;

/** Minimum community vote count required to accept a longtail station. */
export const MIN_VOTES = 100;

/** Maximum field length for text columns. */
const MAX_TEXT = 1000;

function clamp(s: string | null | undefined): string | null {
  if (!s || !s.trim()) return null;
  return s.trim().slice(0, MAX_TEXT);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Slugify a station name to a stable, URL-safe identifier.
 * Lowercased, non-alphanumeric runs collapsed to hyphens, trimmed.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/**
 * A single radio-browser station result (subset of fields we care about).
 */
export interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  url: string;
  tags: string;
  country: string;
  countrycode?: string;
  state?: string;
  geo_lat?: number | null;
  geo_long?: number | null;
  homepage: string;
  favicon: string;
  codec: string;
  bitrate: number;
  votes: number;
  clickcount: number;
  lastcheckok: number;
  lastchecktime?: string;
}

/**
 * Resolve a single Radio Browser station by UUID to its metadata.
 * Returns null when the UUID isn't found or the API is unreachable. Never throws.
 */
export async function fetchRadioBrowserStation(
  uuid: string,
): Promise<RadioBrowserStation | null> {
  try {
    const res = await fetch(
      `https://${RADIO_BROWSER_HOST}/json/stations/byuuid/${encodeURIComponent(uuid.trim())}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": `Lore-Radio/1.0 (${process.env["MUSICBRAINZ_CONTACT"] ?? "contact@example.com"})`,
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body) || body.length === 0) return null;
    return body[0] as RadioBrowserStation;
  } catch {
    return null;
  }
}

/**
 * Fetch stations from radio-browser.info for a single tag.
 * Returns an empty array on any error (network, timeout, unexpected shape).
 */
export async function fetchStationsByTag(
  tag: string,
  opts: {
    host?: string;
    limit?: number;
    fetchFn?: typeof fetch;
  } = {},
): Promise<RadioBrowserStation[]> {
  const host = opts.host ?? RADIO_BROWSER_HOST;
  const limit = opts.limit ?? RESULTS_PER_TAG;
  const fetchFn = opts.fetchFn ?? fetch;
  const url =
    `https://${host}/json/stations/bytag/${encodeURIComponent(tag)}` +
    `?hidebroken=true&order=clickcount&reverse=true&limit=${limit}`;
  try {
    const res = await fetchFn(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `Lore-Radio/1.0 (${process.env["MUSICBRAINZ_CONTACT"] ?? "contact@example.com"})`,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[radio-browser] tag="${tag}" HTTP ${res.status}`);
      return [];
    }
    const body = await res.json();
    if (!Array.isArray(body)) return [];
    return body as RadioBrowserStation[];
  } catch (err) {
    console.warn(`[radio-browser] tag="${tag}" fetch error`, err);
    return [];
  }
}

/**
 * Filter and deduplicate a list of radio-browser stations:
 * - lastcheckok=1 only
 * - Must have a name and a resolved/fallback stream URL
 * - Known bitrate must be >= minBitrateKbps (default MIN_BITRATE_KBPS=128)
 *   — stations reporting bitrate=0 (unknown) are allowed through and
 *   re-evaluated by the stream-health worker before promotion.
 * - Community votes must be >= minVotes (default MIN_VOTES=100)
 * - Deduplicate by resolved URL (keep highest-clickcount copy)
 */
export function filterStations(
  stations: RadioBrowserStation[],
  opts: { minBitrateKbps?: number; minVotes?: number } = {},
): RadioBrowserStation[] {
  const minBitrate = opts.minBitrateKbps ?? MIN_BITRATE_KBPS;
  const minVotes = opts.minVotes ?? MIN_VOTES;
  const seen = new Map<string, RadioBrowserStation>();
  for (const s of stations) {
    if (!s.lastcheckok) continue;
    const streamUrl = (s.url_resolved || s.url || "").trim();
    if (!streamUrl || !s.name?.trim()) continue;
    // Musical ambient pool stations are retained and classified during upsert.
    // Non-music utility and other blocklisted stations are rejected here.
    if (isNameBlocked(s.name)) continue;
    // Reject if known bitrate is below threshold; bitrate=0 means unknown → allow.
    if (s.bitrate > 0 && s.bitrate < minBitrate) continue;
    // Reject if below community vote threshold.
    if (num(s.votes) < minVotes) continue;
    const existing = seen.get(streamUrl);
    if (!existing || s.clickcount > existing.clickcount) {
      seen.set(streamUrl, { ...s, url_resolved: streamUrl });
    }
  }
  return [...seen.values()];
}

/**
 * Upsert a filtered set of radio-browser stations into the stations table.
 * Conflict target is `slug` — if a station with the same slug already exists
 * (curated or previously discovered), only the radio-browser metadata fields
 * are updated; source/tier/active are NOT clobbered on an existing curated row.
 *
 * New longtail rows start as active=false; the health worker promotes them
 * once the stream passes a live check and meets the bitrate threshold.
 */
/**
 * Radio Browser UUIDs the admin has permanently removed ("Remove from Lore").
 * Consulted by the discovery upsert so an excluded station is never
 * re-enrolled, regardless of quality filters or genre tags. Errors fail open
 * (empty set) so a transient DB hiccup never blocks a discovery pass — the
 * exclusion is re-checked on every run.
 */
export async function getExcludedRadioBrowserUuids(): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ uuid: stationExclusionsTable.radioBrowserUuid })
      .from(stationExclusionsTable);
    return new Set(
      rows.map((r) => r.uuid).filter((u): u is string => u != null),
    );
  } catch (err) {
    console.warn("[radio-browser] exclusion lookup failed (failing open)", err);
    return new Set();
  }
}

export async function upsertRadioBrowserStations(
  stations: RadioBrowserStation[],
  tag: string,
): Promise<number> {
  let upserted = 0;
  // Permanent-removal tombstones — an excluded UUID must never be re-enrolled.
  // Loaded once per upsert batch (covers both the discovery worker and the
  // for-you genre-expansion call site).
  const excludedUuids = await getExcludedRadioBrowserUuids();
  for (const s of stations) {
    if (s.stationuuid && excludedUuids.has(s.stationuuid)) continue;
    const streamUrl = (s.url_resolved || s.url || "").trim();
    if (!streamUrl || !s.name?.trim()) continue;
    // Belt-and-suspenders: filterStations should have caught these, but guard
    // at the DB boundary so direct callers also stay clean.
    if (isNameBlocked(s.name)) continue;
    if (num(s.votes) < MIN_VOTES) continue;
    if (s.bitrate > 0 && s.bitrate < MIN_BITRATE_KBPS) continue;

    const baseName = clamp(s.name) ?? "Unknown";
    const slug = slugify(baseName);
    if (!slug) continue;

    const tags: string[] = [tag];
    if (s.tags) {
      for (const t of s.tags.split(",")) {
        const trimmed = t.trim().toLowerCase();
        if (trimmed && !tags.includes(trimmed)) tags.push(trimmed);
      }
    }
    // Derive "college" from the station name when radio-browser doesn't supply
    // it in their tags field. Radio Browser provides no org/affiliation field,
    // so the name is the only reliable signal available at ingest time.
    if (!tags.includes("college") && isCollegeStation(baseName)) {
      tags.push("college");
    }

    // Classify legacy musical ambient-pool stations before upsert.
    const sleepStation = isSleepStation(baseName, slug);
    // Era/genre classification (ambient pool + blocklist take precedence inside the
    // helper). A newly discovered era/genre match is inserted hidden so it
    // never surfaces on the normal dial, and stays reachable via
    // GET /api/stations?mode=era-genre.
    const eraGenreStation = isEraGenreStation(baseName, slug);
    const hiddenAtInsert = sleepStation || eraGenreStation;
    const hasDirectoryLocation = usableCoordinates(s.geo_lat, s.geo_long);

    try {
      const [stationRow] = await db
        .insert(stationsTable)
        .values({
          slug,
          name: baseName,
          streamUrl,
          streamFormat: detectFormat(s.codec, streamUrl),
          country: clamp(s.country) ?? null,
          region: clamp(s.state) ?? null,
          latitude: hasDirectoryLocation ? s.geo_lat : null,
          longitude: hasDirectoryLocation ? s.geo_long : null,
          locationSource: hasDirectoryLocation ? "radio_browser" : null,
          locationConfidence: hasDirectoryLocation ? "directory" : null,
          homepageUrl: clamp(s.homepage) ?? null,
          logoUrl: clamp(s.favicon) ?? null,
          logoSource: clamp(s.favicon) ? "radio_browser" : null,
          source: "radio_browser",
          tier: "longtail",
          tags,
          clickcount: num(s.clickcount),
          votes: num(s.votes),
          bitrate: s.bitrate > 0 ? s.bitrate : null,
          codec: clamp(s.codec) ?? null,
          active: false,
          stationClass: "curated",
          nowPlayingSource: "radio_browser_icy",
          // Ambient-pool and era/genre stations are inserted hidden so they never
          // surface in the normal public dial. They remain accessible via
          // ?mode=sleep and ?mode=era-genre respectively.
          hidden: hiddenAtInsert,
          sleepMode: sleepStation,
          eraGenreMode: eraGenreStation,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: stationsTable.slug,
          set: {
            // Discovery supplies additive metadata, never an authority to erase
            // operator-reviewed or earlier explicit affiliation tags.
            tags: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN (
              SELECT COALESCE(jsonb_agg(DISTINCT tag), '[]'::jsonb) FROM (
                SELECT jsonb_array_elements_text(COALESCE(${stationsTable.tags}, '[]'::jsonb)) AS tag
                UNION
                SELECT jsonb_array_elements_text(COALESCE(${sql.raw("EXCLUDED.tags")}, '[]'::jsonb)) AS tag
              ) merged_tags
            ) ELSE ${stationsTable.tags} END`,
            clickcount: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN ${sql.raw("EXCLUDED.clickcount")} ELSE ${stationsTable.clickcount} END`,
            votes: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN ${sql.raw("EXCLUDED.votes")} ELSE ${stationsTable.votes} END`,
            bitrate: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN ${sql.raw("EXCLUDED.bitrate")} ELSE ${stationsTable.bitrate} END`,
            codec: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN ${sql.raw("EXCLUDED.codec")} ELSE ${stationsTable.codec} END`,
            region: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN COALESCE(EXCLUDED.region, ${stationsTable.region}) ELSE ${stationsTable.region} END`,
            latitude: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN COALESCE(EXCLUDED.latitude, ${stationsTable.latitude}) ELSE ${stationsTable.latitude} END`,
            longitude: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN COALESCE(EXCLUDED.longitude, ${stationsTable.longitude}) ELSE ${stationsTable.longitude} END`,
            locationSource: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' AND EXCLUDED.latitude IS NOT NULL AND EXCLUDED.longitude IS NOT NULL THEN EXCLUDED.location_source ELSE ${stationsTable.locationSource} END`,
            locationConfidence: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' AND EXCLUDED.latitude IS NOT NULL AND EXCLUDED.longitude IS NOT NULL THEN EXCLUDED.location_confidence ELSE ${stationsTable.locationConfidence} END`,
            // Only (re)activate ICY polling for genuine radio-browser rows —
            // never clobber a curated station that happens to share a slug.
            nowPlayingSource: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN 'radio_browser_icy' ELSE ${stationsTable.nowPlayingSource} END`,
            // Ensure sleep classification is applied consistently on re-ingest.
            // The sleep policy is name/slug-based, so a matching station stays
            // classified regardless of source; a previously-classified row is
            // never un-classified by re-discovery (the boot migration owns
            // retroactive classification).
            // Sleep hides unconditionally (name policy). Era/genre hides only
            // genuine radio_browser rows: a curated row sharing a slug (e.g.
            // the seeded FIP sub-channels) must keep polling/ingesting — its
            // hidden flag is owned by the migration/seed policy, not ingest.
            hidden: sql`CASE WHEN ${sql.raw("EXCLUDED.sleep_mode")} THEN true WHEN ${sql.raw("EXCLUDED.era_genre_mode")} AND ${stationsTable.source} = 'radio_browser' THEN true ELSE ${stationsTable.hidden} END`,
            sleepMode: sql`CASE WHEN ${sql.raw("EXCLUDED.sleep_mode")} THEN true ELSE ${stationsTable.sleepMode} END`,
            // Same policy as sleep: a re-discovered era/genre match stays
            // classified; an already-classified row is never un-classified
            // by re-discovery (the boot migration owns retroactive marking).
            eraGenreMode: sql`CASE WHEN ${sql.raw("EXCLUDED.era_genre_mode")} THEN true ELSE ${stationsTable.eraGenreMode} END`,
            updatedAt: new Date(),
          },
        })
        .returning();
      upserted++;

      // Enroll for server-side ICY metadata polling — mirrors what the manual
      // admin enroll endpoint does (radio_browser_stations row + nowPlayingConfig
      // pointer). Skipped when the slug collided with a non-radio_browser row.
      if (stationRow && stationRow.source === "radio_browser") {
        await enrollIcyPolling(stationRow.id, {
          radioBrowserUuid: s.stationuuid,
          streamUrl,
          name: baseName,
          faviconUrl: clamp(s.favicon),
        });
      }
    } catch (err) {
      console.warn(`[radio-browser] upsert failed for slug="${slug}"`, err);
    }
  }
  return upserted;
}

/**
 * Outcome of trying to bring a permanently removed Radio Browser station back
 * immediately. Removing its tombstone still lets the normal discovery pass
 * find it later, but an operator restore should not have to wait for that pass.
 */
export type RadioBrowserRestoreOutcome =
  | { state: "enrolled"; station: Station }
  | { state: "directory_unavailable" | "ineligible" | "enrollment_failed" };

/**
 * Recreate an eligible Radio Browser station from its directory UUID.
 *
 * This intentionally applies the same quality, blocklist, tag, and special
 * browse-mode rules as discovery. A station that no longer qualifies remains
 * eligible for a later directory pass only when its metadata changes; it is
 * not silently reintroduced to normal tracking by an admin restore.
 *
 * The caller must remove the exclusion tombstone before calling this helper:
 * `upsertRadioBrowserStations` consults that tombstone at its DB boundary.
 */
export async function restoreRadioBrowserStation(
  uuid: string,
): Promise<RadioBrowserRestoreOutcome> {
  const remote = await fetchRadioBrowserStation(uuid);
  if (!remote) return { state: "directory_unavailable" };

  const [candidate] = filterStations([remote]);
  if (!candidate) return { state: "ineligible" };

  const candidateSlug = slugify(candidate.name);
  if (
    !candidateSlug ||
    isSleepStation(candidate.name, candidateSlug) ||
    isEraGenreStation(candidate.name, candidateSlug)
  ) {
    return { state: "ineligible" };
  }

  const remoteTags = new Set(
    candidate.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  );
  const discoveryTag = RADIO_BROWSER_GENRE_WHITELIST.find((tag) =>
    remoteTags.has(tag),
  );
  if (!discoveryTag) return { state: "ineligible" };

  try {
    const upserted = await upsertRadioBrowserStations([candidate], discoveryTag);
    if (upserted !== 1) return { state: "enrollment_failed" };

    const [enrollment] = await db
      .select({ stationId: radioBrowserStationsTable.stationId })
      .from(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.radioBrowserUuid, candidate.stationuuid))
      .limit(1);
    if (!enrollment?.stationId) return { state: "enrollment_failed" };

    // This station was previously accepted into Lore. Its current directory
    // metadata has passed the discovery gate above, so restore its visible,
    // active state rather than making the operator wait for stream-health's
    // next promotion cycle.
    const [station] = await db
      .update(stationsTable)
      .set({ active: true, hidden: false, updatedAt: new Date() })
      .where(eq(stationsTable.id, enrollment.stationId))
      .returning();
    return station
      ? { state: "enrolled", station }
      : { state: "enrollment_failed" };
  } catch (err) {
    console.warn(
      `[radio-browser] could not immediately restore uuid="${uuid}"`,
      err,
    );
    return { state: "enrollment_failed" };
  }
}

/**
 * Upsert the radio_browser_stations ICY-tracking row for a station and point
 * the station's nowPlayingConfig at it. Idempotent on radioBrowserUuid.
 */
async function enrollIcyPolling(
  stationId: number,
  info: {
    radioBrowserUuid: string;
    streamUrl: string;
    name: string;
    faviconUrl: string | null;
  },
): Promise<void> {
  const [rbRow] = await db
    .insert(radioBrowserStationsTable)
    .values({
      radioBrowserUuid: info.radioBrowserUuid,
      streamUrl: info.streamUrl,
      name: info.name,
      faviconUrl: info.faviconUrl,
      stationId,
      icyStatus: "active",
      consecutiveErrors: 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: radioBrowserStationsTable.radioBrowserUuid,
      set: {
        streamUrl: info.streamUrl,
        name: info.name,
        faviconUrl: info.faviconUrl,
        stationId,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!rbRow) return;

  await db
    .update(stationsTable)
    .set({
      nowPlayingConfig: { streamUrl: info.streamUrl, radioBrowserId: rbRow.id },
      updatedAt: new Date(),
    })
    .where(eq(stationsTable.id, stationId));
}

/**
 * One-time backfill: activate server-side ICY polling for radio-browser
 * stations discovered before auto-enrollment existed (nowPlayingSource is
 * still null). Purely DB-driven — reuses the streamUrl/name already stored on
 * the stations row, so no RadioBrowser API calls are needed. Idempotent: once
 * every row has nowPlayingSource set, subsequent calls are a no-op. Safe to
 * call on every boot.
 */
export async function backfillRadioBrowserIcyEnrollment(): Promise<number> {
  const rows = await db
    .select()
    .from(stationsTable)
    .where(
      and(
        eq(stationsTable.source, "radio_browser"),
        isNull(stationsTable.nowPlayingSource),
      ),
    );

  let enrolled = 0;
  for (const station of rows) {
    try {
      await enrollIcyPolling(station.id, {
        // No real RadioBrowser UUID was stored for these legacy rows; a
        // slug-derived placeholder satisfies the unique constraint without
        // colliding with genuinely-enrolled UUIDs.
        radioBrowserUuid: `legacy-${station.slug}`,
        streamUrl: station.streamUrl,
        name: station.name,
        faviconUrl: station.logoUrl ?? null,
      });
      await db
        .update(stationsTable)
        .set({ nowPlayingSource: "radio_browser_icy", updatedAt: new Date() })
        .where(eq(stationsTable.id, station.id));
      enrolled++;
    } catch (err) {
      console.warn(
        `[radio-browser] backfill enroll failed for slug="${station.slug}"`,
        err,
      );
    }
  }
  if (enrolled > 0) {
    console.info(
      `[lore] radio-browser ICY backfill: enrolled ${enrolled} station(s)`,
    );
  }
  return enrolled;
}

/**
 * Delete RadioBrowser stations that no longer meet quality or genre criteria.
 * Safe to run on startup — curated stations are never touched.
 *
 * A station is removed if ANY of these are true:
 *   - It has no tag matching the RADIO_BROWSER_GENRE_WHITELIST
 *   - Its known bitrate is below MIN_BITRATE_KBPS (bitrate IS NOT NULL AND > 0)
 *   - Its vote count is below MIN_VOTES
 */
export async function purgeNonQualifyingStations(): Promise<number> {
  // Build JSONB containment check for any whitelisted tag.
  const tagChecks = RADIO_BROWSER_GENRE_WHITELIST.map(
    (g) => `tags @> '${JSON.stringify([g])}'::jsonb`,
  ).join(" OR ");

  const whereClause = `
    source = 'radio_browser'
    AND (
      NOT (${tagChecks})
      OR (bitrate IS NOT NULL AND bitrate > 0 AND bitrate < ${MIN_BITRATE_KBPS})
      OR votes < ${MIN_VOTES}
    )
  `;

  // Run the entire FK-ordered DELETE sequence inside a single transaction and
  // acquire an exclusive lock on radio_browser_stations up front.  Without the
  // lock the background discovery job can INSERT a new radio_browser_stations
  // row between our "DELETE FROM radio_browser_stations" step and the final
  // "DELETE FROM stations" step, producing a 23503 FK violation.
  // LOCK TABLE blocks concurrent INSERTs until the transaction commits while
  // still allowing SELECTs, so read-only queries (e.g. the now-playing poller)
  // are unaffected.
  let deleted = 0;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`LOCK TABLE radio_browser_stations IN EXCLUSIVE MODE`,
    );

    // No ON DELETE CASCADE on these references — dependents must be cleared
    // first (spins, shows, then the discovery-bookkeeping row in
    // radio_browser_stations, which is easy to miss since it isn't part of
    // the play-history spine) or the final DELETE hits a FK violation and
    // silently no-ops every startup. See lore-station-deletion-fk-order memory.
    await tx.execute(sql.raw(`
      DELETE FROM spins
      WHERE station_id IN (SELECT id FROM stations WHERE ${whereClause})
    `));
    await tx.execute(sql.raw(`
      DELETE FROM shows
      WHERE station_id IN (SELECT id FROM stations WHERE ${whereClause})
    `));
    await tx.execute(sql.raw(`
      DELETE FROM radio_browser_stations
      WHERE station_id IN (SELECT id FROM stations WHERE ${whereClause})
    `));
    // station_quality has a FK to stations with no CASCADE — must be cleared
    // before the stations row is deleted or every purge throws a 23503.
    await tx.execute(sql.raw(`
      DELETE FROM station_quality
      WHERE station_id IN (SELECT id FROM stations WHERE ${whereClause})
    `));
    // segue_edges also references stations without CASCADE (listKey-scoped
    // adjacency built by the segue job) — a purged station that ever appeared
    // in a segue would otherwise abort the purge with a 23503.
    await tx.execute(sql.raw(`
      DELETE FROM segue_edges
      WHERE station_id IN (SELECT id FROM stations WHERE ${whereClause})
    `));
    // scraped_shows (schedule-scraper weekly grid) also references stations
    // without CASCADE — a purged station whose schedule was ever scraped
    // would otherwise abort the purge with a 23503.
    await tx.execute(sql.raw(`
      DELETE FROM scraped_shows
      WHERE station_id IN (SELECT id FROM stations WHERE ${whereClause})
    `));
    const result = await tx.execute(sql.raw(`
      DELETE FROM stations
      WHERE ${whereClause}
    `));
    deleted = (result as { rowCount?: number }).rowCount ?? 0;
  });

  if (deleted > 0) {
    console.info(
      `[radio-browser] purged ${deleted} non-qualifying stations (whitelist + quality filter)`,
    );
  }
  return deleted;
}

/** Map radio-browser codec string to a Lore streamFormat hint. */
export function detectFormat(
  codec: string | null | undefined,
  url: string,
): string {
  const c = (codec ?? "").toUpperCase();
  if (c.includes("AAC")) return "aac";
  if (c.includes("OGG") || c.includes("VORBIS")) return "ogg";
  if (c.includes("FLAC")) return "flac";
  if (c.includes("HLS") || url.includes(".m3u8")) return "hls";
  return "mp3";
}

let started = false;
let timer: NodeJS.Timeout | null = null;
let warmup: NodeJS.Timeout | null = null;

const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h
const WARMUP_MS = 10 * 60 * 1000; // 10min after boot

function intervalMs(): number {
  const raw = process.env["RADIO_BROWSER_INTERVAL_MS"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MS;
}

async function runDiscovery(): Promise<void> {
  console.info("[radio-browser] discovery run starting");
  let totalUpserted = 0;
  for (const tag of SEED_GENRE_TAGS) {
    const raw = await fetchStationsByTag(tag);
    const filtered = filterStations(raw);
    const count = await upsertRadioBrowserStations(filtered, tag);
    totalUpserted += count;
    // Polite pause between tags
    await new Promise((r) => setTimeout(r, 500));
  }
  console.info(`[radio-browser] discovery complete — ${totalUpserted} upserted`);
}

/**
 * Start the radio-browser discovery worker. Idempotent. On first start:
 *   1. Immediately purges stations that no longer meet quality/genre criteria.
 *   2. After a warmup delay, runs a full discovery pass for all seed tags.
 *   3. Repeats discovery on the configured interval.
 * Errors never crash the server.
 */
export function startRadioBrowserWorker(): void {
  if (started) return;
  started = true;

  // Purge non-qualifying stations synchronously on startup (best-effort).
  void purgeNonQualifyingStations().catch((err) =>
    console.error("[radio-browser] startup purge failed", err),
  );

  warmup = setTimeout(() => {
    warmup = null;
    void runDiscovery().catch((err) =>
      console.error("[radio-browser] discovery failed", err),
    );
    timer = setInterval(() => {
      void runDiscovery().catch((err) =>
        console.error("[radio-browser] discovery failed", err),
      );
    }, intervalMs());
  }, WARMUP_MS);
}

/** Stop the worker (for tests / graceful shutdown). */
export function stopRadioBrowserWorker(): void {
  if (warmup) {
    clearTimeout(warmup);
    warmup = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}

/**
 * Returns true when the station should be classified into the era/genre bucket
 * (era_genre_mode=true, hidden=true), reachable via ?mode=era-genre.
 *
 * Precedence: sleep classification and permanent blocklist BOTH win first, so a
 * station that is a sleep station or a blocklist match is never era/genre
 * classified here (callers must apply this after those checks; the guards below
 * make the helper safe to call standalone in tests too).
 */
export function isEraGenreStation(
  name: string | null | undefined,
  slug?: string | null,
): boolean {
  // Sleep and blocklist take precedence.
  if (isSleepStation(name, slug)) return false;
  if (isNameBlocked(name)) return false;
  if (slug && (ERA_GENRE_FIP_SLUGS as readonly string[]).includes(slug)) {
    return true;
  }
  const text = name ?? "";
  if (!text.trim()) return false;
  return ERA_GENRE_STATION_PATTERNS.some((p) => matchesWordBoundary(text, p));
}

/**
 * Explicit FIP thematic sub-channel slugs (source='curated' seed stations) that
 * belong in the era/genre bucket. FIP Main and FIP Electro stay on the dial.
 * The radio-browser duplicate "FIP Musiques du monde" is caught by the name
 * patterns / migration name predicate rather than a slug.
 */
export const ERA_GENRE_FIP_SLUGS = Object.freeze([
  "fip-rock",
  "fip-jazz",
  "fip-groove",
  "fip-world",
  "fip-reggae",
  "fip-metal",
] as const);

/**
 * Case-insensitive word-boundary match: `pattern` matches `text` only when it
 * is delimited by non-alphanumeric characters (or string edges) on both sides.
 * This prevents accidental substring hits like "gems" inside "Experimentalgems"
 * or "ska" inside "Alaska", while still matching "70s" in "RADIO BOB - 70er
 * Rock" is handled by the explicit "70er" pattern. Multi-word patterns
 * (e.g. "drum and bass", "hip hop") are matched verbatim with the same
 * boundary rule.
 */
export function matchesWordBoundary(text: string, pattern: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerPattern = pattern.toLowerCase();
  let from = 0;
  for (;;) {
    const idx = lowerText.indexOf(lowerPattern, from);
    if (idx === -1) return false;
    const before = idx === 0 ? "" : lowerText[idx - 1];
    const afterIdx = idx + lowerPattern.length;
    const after = afterIdx >= lowerText.length ? "" : lowerText[afterIdx];
    const boundaryBefore = before === "" || !/[a-z0-9]/.test(before);
    const boundaryAfter = after === "" || !/[a-z0-9]/.test(after);
    if (boundaryBefore && boundaryAfter) return true;
    from = idx + 1;
  }
}

/**
 * Genre-format keyword patterns (case-insensitive, word-boundary matched):
 * single-genre brand channels whose names carry a genre keyword.
 */
export const ERA_GENRE_GENRE_PATTERNS = Object.freeze([
  "jazz",
  "blues",
  "folk",
  "bluegrass",
  "celtic",
  "classical",
  "piano",
  "violin",
  "trumpet",
  "opera",
  "reggae",
  "ska",
  "metal",
  "punk",
  "techno",
  "trance",
  "house",
  "edm",
  "disco",
  "funk",
  "soul",
  "gospel",
  "country",
  "americana",
  "schlager",
  "salsa",
  "tango",
  "flamenco",
  "bossa",
  "swing",
  "lounge",
  "chillout",
  "chill",
  "ambient",
  "new wave",
  "synthpop",
  "psychedelic",
  "shoegaze",
  "goa",
  "acid",
  "dub",
  "drum and bass",
  "hip hop",
  "rnb",
  "k-pop",
  "psychill",
  // The radio-browser duplicate of the FIP world sub-channel carries no English
  // genre keyword ("FIP Musiques du monde"); match its French genre phrase so
  // it joins the bucket alongside the seeded fip-world slug.
  "musiques du monde",
] as const);

/** Combined era + genre name patterns — the single shared classification list. */
export const ERA_GENRE_STATION_PATTERNS = Object.freeze([
  ...ERA_GENRE_ERA_PATTERNS,
  ...ERA_GENRE_GENRE_PATTERNS,
]);
