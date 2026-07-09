import { db, stationsTable, radioBrowserStationsTable } from "@workspace/db";
import { sql, eq, and, isNull } from "drizzle-orm";

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
 */
export const RADIO_BROWSER_NAME_BLOCKLIST = Object.freeze([
  "epic lounge",
] as const);

function isNameBlocked(name: string | null | undefined): boolean {
  const lower = (name ?? "").toLowerCase();
  return RADIO_BROWSER_NAME_BLOCKLIST.some((b) => lower.includes(b));
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
export async function upsertRadioBrowserStations(
  stations: RadioBrowserStation[],
  tag: string,
): Promise<number> {
  let upserted = 0;
  for (const s of stations) {
    const streamUrl = (s.url_resolved || s.url || "").trim();
    if (!streamUrl || !s.name?.trim()) continue;
    // Belt-and-suspenders: filterStations should have caught these, but guard
    // at the DB boundary so direct callers also stay clean.
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

    try {
      const [stationRow] = await db
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
          nowPlayingSource: "radio_browser_icy",
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
            // Only (re)activate ICY polling for genuine radio-browser rows —
            // never clobber a curated station that happens to share a slug.
            nowPlayingSource: sql`CASE WHEN ${stationsTable.source} = 'radio_browser' THEN 'radio_browser_icy' ELSE ${stationsTable.nowPlayingSource} END`,
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

  const result = await db.execute(sql.raw(`
    DELETE FROM stations
    WHERE source = 'radio_browser'
      AND (
        NOT (${tagChecks})
        OR (bitrate IS NOT NULL AND bitrate > 0 AND bitrate < ${MIN_BITRATE_KBPS})
        OR votes < ${MIN_VOTES}
      )
  `));
  const deleted = (result as { rowCount?: number }).rowCount ?? 0;
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
