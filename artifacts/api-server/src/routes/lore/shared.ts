import type { Station, Picker } from "@workspace/db";
// Re-export from the lore layer so route files have one import site.
export { spinDayExpr } from "../../lore/runs.js";

/** Shape a DB station row into the public Station payload.
 *  `qualityTier` comes from a LEFT JOIN on station_quality and is null until
 *  the first nightly recompute has run. */
export function toStation(
  s: Station,
  qualityTier?: string | null,
) {
  return {
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
