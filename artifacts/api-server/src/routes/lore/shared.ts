import type { Station, Picker } from "@workspace/db";
import {
  db,
  selectorClaimsTable,
  showsTable,
  spinsTable,
} from "@workspace/db";
import { eq, and, sql, type SQLWrapper } from "drizzle-orm";
import { eligibleDjName } from "@workspace/lore-attribution";
import { isRelayAllowed, relayUrlPath } from "../../lore/stream-relay.js";
import { playbackCandidatesForStation } from "../../lore/playback-candidates.js";
import { classifyFreshness } from "../../lore/freshness.js";
// Re-export from the lore layer so route files have one import site.
export { spinDayExpr } from "../../lore/runs.js";

/**
 * Drizzle `notExists` condition: true when the picker has NOT opted out.
 * Attach to any query that joins or filters on `pickersTable.id`.
 *
 * Usage:
 *   .where(and(eq(pickersTable.active, true), pickerNotOptedOut(pickersTable.id)))
 *
 * For raw SQL (CTE) queries use the inline fragment:
 *   `AND NOT EXISTS (SELECT 1 FROM selector_claims sc WHERE sc.picker_id = pk.id AND sc.opted_out = true)`
 */
export function pickerNotOptedOut(pickerIdCol: Parameters<typeof eq>[0]) {
  return sql`NOT EXISTS (
    SELECT 1 FROM selector_claims sc
    WHERE sc.picker_id = ${pickerIdCol}
      AND sc.opted_out = true
  )`;
}

/**
 * A show row is usable for a spin when it is directly curated, or when the
 * spin falls inside a non-voided scraped schedule block. Schedule-derived
 * shows share the `shows` table with curated shows, so direct source-backed
 * spins and manual entries are allowed through without requiring a schedule
 * receipt. Directly curated shows are identified by their picker linkage, not
 * by the spin source, because a curated show may be fed by several adapters.
 *
 * The two EXISTS branches deliberately distinguish overlapping recurring
 * blocks. Voiding one block must not hide a different, still-valid block for
 * the same show.
 */
export function validScheduleShowAttribution(
  spinStation: SQLWrapper = spinsTable.stationId,
  spinPlayedAt: SQLWrapper = spinsTable.playedAt,
  showName: SQLWrapper = showsTable.name,
  showPickerId: SQLWrapper = showsTable.pickerId,
) {
  return sql`(
    EXISTS (
      SELECT 1
      FROM scraped_shows schedule_valid
      WHERE schedule_valid.station_id = ${spinStation}
        AND schedule_valid.show_name = ${showName}
        AND schedule_valid.voided_at IS NULL
        AND (
          (
            schedule_valid.day_of_week = TO_CHAR(
              ${spinPlayedAt} AT TIME ZONE
                (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
              'Dy'
            )
            AND (
              (
                schedule_valid.end_time > schedule_valid.start_time
                AND TO_CHAR(
                  ${spinPlayedAt} AT TIME ZONE
                    (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
                  'HH24:MI'
                ) >= schedule_valid.start_time
                AND TO_CHAR(
                  ${spinPlayedAt} AT TIME ZONE
                    (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
                  'HH24:MI'
                ) < schedule_valid.end_time
              )
              OR (
                schedule_valid.end_time < schedule_valid.start_time
                AND TO_CHAR(
                  ${spinPlayedAt} AT TIME ZONE
                    (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
                  'HH24:MI'
                ) >= schedule_valid.start_time
              )
            )
          )
          OR (
            schedule_valid.end_time < schedule_valid.start_time
            AND schedule_valid.day_of_week = TO_CHAR(
              (${spinPlayedAt} - interval '1 day') AT TIME ZONE
                (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
              'Dy'
            )
            AND TO_CHAR(
              ${spinPlayedAt} AT TIME ZONE
                (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
              'HH24:MI'
            ) < schedule_valid.end_time
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM pickers direct_picker
      WHERE direct_picker.id = ${showPickerId}
        AND direct_picker.handle NOT LIKE 'show-dj-%'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM scraped_shows schedule_any
      WHERE schedule_any.station_id = ${spinStation}
        AND schedule_any.show_name = ${showName}
        AND (
          (
            schedule_any.day_of_week = TO_CHAR(
              ${spinPlayedAt} AT TIME ZONE
                (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
              'Dy'
            )
            AND (
              (
                schedule_any.end_time > schedule_any.start_time
                AND TO_CHAR(
                  ${spinPlayedAt} AT TIME ZONE
                    (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
                  'HH24:MI'
                ) >= schedule_any.start_time
                AND TO_CHAR(
                  ${spinPlayedAt} AT TIME ZONE
                    (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
                  'HH24:MI'
                ) < schedule_any.end_time
              )
              OR (
                schedule_any.end_time < schedule_any.start_time
                AND TO_CHAR(
                  ${spinPlayedAt} AT TIME ZONE
                    (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
                  'HH24:MI'
                ) >= schedule_any.start_time
              )
            )
          )
          OR (
            schedule_any.end_time < schedule_any.start_time
            AND schedule_any.day_of_week = TO_CHAR(
              (${spinPlayedAt} - interval '1 day') AT TIME ZONE
                (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
              'Dy'
            )
            AND TO_CHAR(
              ${spinPlayedAt} AT TIME ZONE
                (SELECT iana_timezone FROM stations WHERE id = ${spinStation}),
              'HH24:MI'
            ) < schedule_any.end_time
          )
        )
    )
  )`;
}

/**
 * Check whether a single picker is opted out.  Used by handle-based routes
 * that already fetched the picker row and just need a fast yes/no.
 */
export async function isPickerOptedOut(pickerId: number): Promise<boolean> {
  const [row] = await db
    .select({ optedOut: selectorClaimsTable.optedOut })
    .from(selectorClaimsTable)
    .where(
      and(
        eq(selectorClaimsTable.pickerId, pickerId),
        eq(selectorClaimsTable.optedOut, true),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * The seven mutually exclusive editorial station categories, in precedence
 * order (strongest wins for ambiguous stations).
 */
const ANCHOR_STATION_SLUGS = new Set([
  "kexp",
  "wfmu",
  "nts-1",
  "nts-2",
  "bbc-6music",
  "fip-main",
  "kcrw-eclectic24",
  "wwoz",
  "kutx",
  "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f",
  "rb-308a9f58-fb54-44dc-b95d-bb40fe4f3631",
  "dublab",
  "rinse-fm",
]);

const PUBLIC_STATION_SLUGS = new Set([
  "kcrw-eclectic24",
  "wbgo",
  "wpfw",
  "wdiy",
  "ckua",
]);

const INDIE_STATION_SLUGS = new Set([
  "worldwide-fm",
  "refuge-worldwide",
  "balamii",
  "the-lot-radio",
  "radio-nopal",
  "lookout-fm",
]);

/**
 * Derive the station's single primary editorial category.
 *
 * The seven labels form a mutually exclusive taxonomy answering "what kind of
 * station is this?", assigned with the precedence:
 *
 *   1. "ambient"    — ambient, drone, and atmospheric music (`sleep_mode`
 *                     legacy pool flag or an `ambient` seed tag).
 *   2. "campus"     — college/university-operated stations (`college` tag from
 *                     the curated seed or the college-tag boot migration).
 *   3. "specialist" — genre/era/format-focused channels (era_genre_mode flag
 *                     or a `specialist` seed tag; e.g. FIP sub-channels,
 *                     decade radio).
 *   4. "anchor"     — Core: broadly-programmed flagship stations (`anchor`
 *                     tag or the reviewed Core slug allowlist).
 *   5. "public"     — non-campus terrestrial/nonprofit community stations
 *                     (`public` tag or slug allowlist: KCRW, WBGO, WPFW, …).
 *   6. "indie"      — web-native DJ/selector stations (`indie` tag or slug
 *                     allowlist: Worldwide FM, Refuge Worldwide, Balamii, …).
 *   7. "discovery"  — everything else (Radio Browser and uncategorized
 *                     longtail).
 *
 * Always returns exactly one category. All inputs come from already-public
 * station fields; no nowPlayingConfig values or API keys are read or exposed.
 *
 * @param s           - DB station row.
 * @param _qualityTier - Joined from station_quality; retained for call-site
 *                       compatibility (no longer affects classification —
 *                       discovery is the unconditional fallback).
 */
export function deriveStationCategories(s: Station, _qualityTier?: string | null): string[] {
  const tags = Array.isArray(s.tags) ? (s.tags as string[]) : [];
  if (s.sleepMode === true || tags.includes("ambient")) return ["ambient"];
  if (tags.includes("college")) return ["campus"];
  if (s.eraGenreMode === true || tags.includes("specialist")) return ["specialist"];
  if (tags.includes("anchor") || ANCHOR_STATION_SLUGS.has(s.slug)) return ["anchor"];
  if (tags.includes("public") || PUBLIC_STATION_SLUGS.has(s.slug)) return ["public"];
  if (tags.includes("indie") || INDIE_STATION_SLUGS.has(s.slug)) return ["indie"];
  return ["discovery"];
}

/** Shape a DB station row into the public Station payload.
 *  `qualityTier` comes from a LEFT JOIN on station_quality and is null until
 *  the first nightly recompute has run.
 *  `resolvedAutomationClass` is the per-slot resolved value for `'mixed'`
 *  stations (either `'human'` or `'automated'`); when provided it replaces
 *  the stored `automationClass` so callers never see the raw `'mixed'` flag. */
export function toStation(
  s: Station,
  qualityTier?: string | null,
  resolvedAutomationClass?: string | null,
) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    org: s.org,
    country: s.country,
    city: s.city ?? null,
    ianaTimezone: s.ianaTimezone ?? null,
    streamUrl: s.streamUrl,
    streamQuality: s.streamQuality,
    streamFormat: s.streamFormat,
    mode: s.mode,
    homepageUrl: s.homepageUrl,
    donateUrl: s.donateUrl,
    logoUrl: s.logoUrl,
    attribution: s.attribution,
    tags: Array.isArray(s.tags) ? (s.tags as string[]) : null,
    mayHaveAds: s.mayHaveAds,
    votes: s.votes,
    clickcount: s.clickcount,
    discoveryScore: s.discoveryScore ?? null,
    homepageBlurb: s.homepageBlurb ?? null,
    upcomingShowCount: s.upcomingShowCount ?? 0,
    tier: s.tier ?? null,
    qualityTier: qualityTier ?? null,
    automationClass: resolvedAutomationClass !== undefined
      ? resolvedAutomationClass
      : (s.automationClass ?? null),
    // HTTPS relay path for allowlisted HTTP-only streams (mixed-content
    // workaround). Only emitted when the stored stream really is plain HTTP —
    // HTTPS streams play directly in the browser and need no relay.
    relayUrl:
      isRelayAllowed(s.slug) && s.streamUrl?.startsWith("http://")
        ? relayUrlPath(s.slug)
        : null,
    playbackCandidates: playbackCandidatesForStation(s),
    stationCategories: deriveStationCategories(s, qualityTier),
  };
}

/** Shape a DB picker row into the public Picker payload. */
export function toPicker(p: Picker, latestRunId: number | null = null) {
  return {
    id: p.id,
    pickerType: p.pickerType,
    name: p.name,
    handle: p.handle,
    homeUrl: p.homeUrl,
    trustTier: p.trustTier,
    description: p.description,
    active: p.active,
    latestRunId,
  };
}

/** Shape a joined now-playing spin row into the public NowPlaying payload. */
export function toNowPlaying(row: {
  spinId?: number | null;
  rawArtist: string | null;
  rawTitle: string | null;
  source: string | null;
  confidence: string;
  playedAt: Date;
  /** When Lore observed the metadata (ingestion time). Optional: older call
   * sites that don't select it simply omit freshness from the payload. */
  observedAt?: Date | null;
  mbid: string | null;
  title: string | null;
  artist: string | null;
  artistMbid?: string | null;
  artworkUrl: string | null;
  links: unknown;
  genres?: string[] | null;
  releaseYear?: number | null;
  /** MusicBrainz first-release date in partial-ISO form (YYYY / YYYY-MM / YYYY-MM-DD). */
  releaseDate?: string | null;
  showName: string | null;
  showDj: string | null;
  stationName?: string | null;
  isFirstSpin?: boolean;
  /** Server-computed library hit flags for the authenticated listener. */
  isLibraryHit?: boolean;
  isArtistHit?: boolean;
  /** Process-local cursor/version metadata for monotonic REST/SSE merges. */
  eventId?: number;
  stationVersion?: number;
}) {
  return {
    spinId: row.spinId ?? null,
    rawArtist: row.rawArtist ?? "",
    rawTitle: row.rawTitle ?? "",
    source: row.source,
    confidence: row.confidence,
    playedAt: row.playedAt.toISOString(),
    ...(row.observedAt
      ? {
          observedAt: row.observedAt.toISOString(),
          freshness: classifyFreshness(row.source, row.observedAt),
        }
      : {}),
    artworkUrl: row.artworkUrl ?? null,
    recording: row.mbid
      ? {
          mbid: row.mbid,
          title: row.title ?? row.rawTitle ?? "",
          artist: row.artist ?? row.rawArtist ?? "",
          artistMbid: row.artistMbid ?? null,
          artworkUrl: row.artworkUrl ?? null,
          links: row.links ?? [],
          genres: row.genres ?? null,
          releaseYear: row.releaseYear ?? null,
          releaseDate: row.releaseDate ?? null,
        }
      : null,
    show: row.showName
      ? {
          name: row.showName,
          djName: eligibleDjName(row.showDj, {
            artist: row.artist ?? row.rawArtist,
            title: row.title ?? row.rawTitle,
            showTitle: row.showName,
            stationName: row.stationName,
          }),
        }
      : null,
    isFirstSpin: row.isFirstSpin ?? false,
    isLibraryHit: row.isLibraryHit ?? false,
    isArtistHit: row.isArtistHit ?? false,
    ...(row.eventId != null ? { eventId: row.eventId } : {}),
    ...(row.stationVersion != null
      ? { stationVersion: row.stationVersion }
      : {}),
  };
}

/** Shape a joined recording row into an archive recording payload, or null. */
export function toArchiveRecording(row: {
  mbid: string | null;
  recTitle: string | null;
  recArtist: string | null;
  artworkUrl: string | null;
  links: unknown;
}) {
  return row.mbid
    ? {
        mbid: row.mbid,
        title: row.recTitle ?? "",
        artist: row.recArtist ?? "",
        artworkUrl: row.artworkUrl ?? null,
        links: row.links ?? [],
      }
    : null;
}
