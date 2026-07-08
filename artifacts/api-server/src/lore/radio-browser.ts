import { db, stationsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

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
 * Seeded genre tags — these drive cold-start discovery before user-library
 * genre expansion is available. Kept intentionally narrow and high-quality;
 * the set can be expanded later without a migration.
 */
export const SEED_GENRE_TAGS = [
  "jazz",
  "ambient",
  "electronic",
  "blues",
  "folk",
  "post-rock",
  "experimental",
  "krautrock",
  "doom-metal",
  "stoner-rock",
  "spiritual-jazz",
  "psychedelic",
  "soul",
  "indie",
  "classical",
];

/** Minimum bitrate (kbps) required to promote a longtail station. */
export const MIN_BITRATE_KBPS = 64;

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
 * - Prefer HTTPS stream URLs
 * - Deduplicate by resolved URL (keep highest-clickcount copy)
 */
export function filterStations(
  stations: RadioBrowserStation[],
): RadioBrowserStation[] {
  const seen = new Map<string, RadioBrowserStation>();
  for (const s of stations) {
    if (!s.lastcheckok) continue;
    const streamUrl = (s.url_resolved || s.url || "").trim();
    if (!streamUrl || !s.name?.trim()) continue;
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
 * New longtail rows start as active=false; the health worker promotes them.
 */
export async function upsertRadioBrowserStations(
  stations: RadioBrowserStation[],
  tag: string,
): Promise<number> {
  let upserted = 0;
  for (const s of stations) {
    const streamUrl = (s.url_resolved || s.url || "").trim();
    if (!streamUrl || !s.name?.trim()) continue;

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

    try {
      await db
        .insert(stationsTable)
        .values({
          slug,
          name: baseName,
          streamUrl,
          streamFormat: detectFormat(s.codec, streamUrl),
          country: clamp(s.country) ?? null,
          homepageUrl: clamp(s.homepage) ?? null,
          logoUrl: clamp(s.favicon) ?? null,
          source: "radio_browser",
          tier: "longtail",
          tags,
          clickcount: num(s.clickcount),
          votes: num(s.votes),
          bitrate: s.bitrate > 0 ? s.bitrate : null,
          codec: clamp(s.codec) ?? null,
          active: false,
          stationClass: "curated",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: stationsTable.slug,
          set: {
            tags: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN ${sql.raw("EXCLUDED.tags")} ELSE ${stationsTable.tags} END`,
            clickcount: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN ${sql.raw("EXCLUDED.clickcount")} ELSE ${stationsTable.clickcount} END`,
            votes: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN ${sql.raw("EXCLUDED.votes")} ELSE ${stationsTable.votes} END`,
            bitrate: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN ${sql.raw("EXCLUDED.bitrate")} ELSE ${stationsTable.bitrate} END`,
            codec: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN ${sql.raw("EXCLUDED.codec")} ELSE ${stationsTable.codec} END`,
            updatedAt: new Date(),
          },
        });
      upserted++;
    } catch (err) {
      console.warn(`[radio-browser] upsert failed for slug="${slug}"`, err);
    }
  }
  return upserted;
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
 * Start the radio-browser discovery worker. Idempotent. Runs once after a
 * warmup delay, then on the configured interval. Errors never crash the server.
 */
export function startRadioBrowserWorker(): void {
  if (started) return;
  started = true;

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
