import type { Station, Picker } from "@workspace/db";
import {
  db,
  selectorClaimsTable,
  showsTable,
  spinsTable,
} from "@workspace/db";
import { eq, and, sql, type SQLWrapper } from "drizzle-orm";
import { eligibleDjName } from "@workspace/lore-attribution";
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
  mbid: string | null;
  title: string | null;
  artist: string | null;
  artistMbid?: string | null;
  artworkUrl: string | null;
  links: unknown;
  genres?: string[] | null;
  showName: string | null;
  showDj: string | null;
  stationName?: string | null;
  isFirstSpin?: boolean;
  /** Server-computed library hit flags for the authenticated listener. */
  isLibraryHit?: boolean;
  isArtistHit?: boolean;
}) {
  return {
    spinId: row.spinId ?? null,
    rawArtist: row.rawArtist ?? "",
    rawTitle: row.rawTitle ?? "",
    source: row.source,
    confidence: row.confidence,
    playedAt: row.playedAt.toISOString(),
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
