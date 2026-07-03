import { spinsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Station, Picker } from "@workspace/db";

/** UTC broadcast day of a spin, as YYYY-MM-DD (the run grouping key). */
export const spinDayExpr = sql<string>`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

/** Shape a DB station row into the public Station payload. */
export function toStation(s: Station) {
  return {
    slug: s.slug,
    name: s.name,
    org: s.org,
    country: s.country,
    streamUrl: s.streamUrl,
    streamQuality: s.streamQuality,
    streamFormat: s.streamFormat,
    mode: s.mode,
    homepageUrl: s.homepageUrl,
    donateUrl: s.donateUrl,
    logoUrl: s.logoUrl,
    attribution: s.attribution,
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
  rawArtist: string | null;
  rawTitle: string | null;
  source: string | null;
  confidence: string;
  playedAt: Date;
  mbid: string | null;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
  links: unknown;
  showName: string | null;
  showDj: string | null;
}) {
  return {
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
          artworkUrl: row.artworkUrl ?? null,
          links: row.links ?? [],
        }
      : null,
    show: row.showName
      ? { name: row.showName, djName: row.showDj ?? null }
      : null,
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
