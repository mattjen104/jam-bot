/**
 * CoverRails — the music-object row grammar for Explore.
 *
 * Explore has exactly two row grammars, and they must never blur:
 *
 *   1. Music-object cards (THIS module): the album cover leads and the
 *      station appears only as provenance ("KEXP played", "First play ·
 *      KEXP"). Used for music the listener is browsing AS RECORDS — live
 *      crossings, album crossings, and first plays. The cover/title is the
 *      record action (opens the album or recording detail); a separate
 *      "Tune in" action enters the live broadcast; "Preview" (exact-track
 *      replay) stays a distinctly styled, labelled action — a cover never
 *      implies streaming playback.
 *
 *   2. Station-destination rows (DialFeedLane/FrontDoorRow, the scanner,
 *      editorial discovery): the station name/mark leads and the current
 *      track is secondary context, because the listener is choosing a
 *      broadcast, not a record. Those rows stay station-first; no
 *      now-playing cover piles.
 *
 * Artwork honesty:
 *   - A cover is shown only when it is release-exact: confirmed
 *     album-crossing artwork, or Cover Art Archive by the crossing's own
 *     release-group MBID. Nothing is ever guessed from fuzzy search.
 *   - Artist-only crossings have no trustworthy release identity, so they
 *     never get a cover here — they stay text rows in the station feed.
 *   - Provisional (resolving) now-playing entries never promote to a card.
 *   - Missing or failed art renders Lore's quiet RUMOURS fallback via
 *     onArtError, never an unrelated cover.
 *
 * Performance: rails are bounded (max CROSSING_COVER_LIMIT /
 * FIRST_PLAY_LIMIT cards), images lazy-load, and card dimensions are fixed
 * so live re-sorting cannot cause layout jumps.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { type DialLaneRow } from "./DialFeedLane";
import { type DialSpin, type DialStation } from "../../hooks/useDialData";
import { proxyArtUrl } from "../../lib/proxyArt";
import { RUMOURS, onArtError } from "../../lib/rumours";
import { releaseDateLabel } from "../../lib/firstPlayDate";
import { usePlayer } from "../../player/PlayerProvider";

/** Bounds keep the live station list from becoming a slow wall of images. */
export const CROSSING_COVER_LIMIT = 8;
export const FIRST_PLAY_LIMIT = 12;
/**
 * The history endpoint only serves the public, release-qualified home fast
 * lane (identical results for signed-in and anonymous listeners) when the
 * request carries EXACTLY limit=18 with home=1 — see isHomeFirstPlayRail in
 * the API server. Fetch the required 18, then bound the rendered rail to
 * FIRST_PLAY_LIMIT cards.
 */
export const FIRST_PLAY_REQUEST_LIMIT = 18;

// ---------------------------------------------------------------------------
// Live crossings — cover-first cards for confirmed exact/album crossings
// ---------------------------------------------------------------------------

export interface CrossingCoverItem {
  key: string;
  row: DialLaneRow;
  stationSlug: string;
  stationName: string;
  artist: string;
  title: string;
  releaseGroupMbid: string | null;
  artworkUrl: string;
  matchKind: "record" | "artist";
  /** Record action destination — album when release identity exists, else song. */
  detailHref: string;
}

/**
 * Resolve release-exact artwork for a confirmed crossing track.
 *
 * Order of trust:
 *   1. The server-joined album-crossing entry whose recording or
 *      release-group identity matches the track (artwork came from the
 *      resolved library/recording row).
 *   2. Cover Art Archive front-500 derived from the track's own
 *      release-group MBID (release-exact by construction).
 *
 * Returns null when neither exists — the caller must fall back to a text
 * treatment rather than guess art.
 */
export function crossingArtworkFor(
  ds: DialStation,
  track: Pick<DialSpin, "mbid" | "releaseGroupMbid">,
): { artworkUrl: string; releaseGroupMbid: string | null } | null {
  const match = (ds.albumCrossings ?? []).find((cx) =>
    (track.mbid != null && cx.recordingMbid === track.mbid) ||
    (track.releaseGroupMbid != null && cx.releaseGroupMbid != null &&
      cx.releaseGroupMbid === track.releaseGroupMbid));
  const releaseGroupMbid = match?.releaseGroupMbid ?? track.releaseGroupMbid ?? null;
  if (match?.artworkUrl) return { artworkUrl: match.artworkUrl, releaseGroupMbid };
  if (releaseGroupMbid) {
    return {
      artworkUrl: `https://coverartarchive.org/release-group/${releaseGroupMbid}/front-500`,
      releaseGroupMbid,
    };
  }
  return null;
}

/**
 * Derive the bounded cover-card set from the live feed rows. A row qualifies
 * only when its current track is a confirmed record or artist crossing with
 * release-exact artwork available. Artist crossings qualify only when the
 * playing release itself is identified, so the cover never comes from a
 * fuzzy artist search.
 */
export function crossingCoverItems(
  rows: DialLaneRow[],
  limit = CROSSING_COVER_LIMIT,
): CrossingCoverItem[] {
  const items: CrossingCoverItem[] = [];
  for (const row of rows) {
    const { ds, show } = row;
    if (!ds.isLive) continue;
    const track = ds.liveTrack ?? show?.currentTrack ?? null;
    // Provisional entries are never promoted. Both record and artist
    // crossings still require release-exact art below.
    if (!track || track.resolving || (!track.isLibraryHit && !track.isArtistHit)) continue;
    const art = crossingArtworkFor(ds, track);
    if (!art) continue;
    const detailHref = art.releaseGroupMbid
      ? `/album/${art.releaseGroupMbid}`
      : track.mbid
        ? `/song/${track.mbid}`
        : null;
    if (!detailHref) continue;
    items.push({
      key: ds.station.slug,
      row,
      stationSlug: ds.station.slug,
      stationName: ds.station.name,
      artist: track.artist,
      title: track.title,
      releaseGroupMbid: art.releaseGroupMbid,
      artworkUrl: art.artworkUrl,
      matchKind: track.isLibraryHit ? "record" : "artist",
      detailHref,
    });
  }
  // Most recent play first; one card per station is inherent (a station airs
  // one track at a time), so the slice is the only bound needed.
  return items.slice(0, limit);
}

export function LiveCrossingCoverRail({
  rows,
  onTuneIn,
}: {
  rows: DialLaneRow[];
  onTuneIn: (row: DialLaneRow) => void;
}) {
  const items = useMemo(() => crossingCoverItems(rows), [rows]);
  if (items.length === 0) return null;
  return (
    <section
      className="cover-rail"
      aria-label="Your records on air now"
      data-testid="crossing-cover-rail"
    >
      <header className="cover-rail__header">
        <h2 className="cover-rail__title">Crossings on air</h2>
        <span className="cover-rail__context">on air now</span>
      </header>
      <div className="cover-rail__scroll">
        {items.map((item) => (
          <article
            key={item.key}
            className="cover-card"
            data-testid={`crossing-cover-card-${item.stationSlug}`}
          >
            <Link
              href={item.detailHref}
              className="cover-card__record"
              aria-label={`Open ${item.title} by ${item.artist}`}
            >
              <img
                className="cover-card__art"
                src={proxyArtUrl(item.artworkUrl) ?? RUMOURS}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={onArtError}
              />
              <span className="cover-card__artist">{item.artist}</span>
              <span className="cover-card__title">{item.title}</span>
            </Link>
            <span className="cover-card__provenance">
              {item.stationName} · {item.matchKind === "record" ? "record crossing" : "artist crossing"}
            </span>
            <div className="cover-card__actions">
              <button
                type="button"
                className="cover-card__action cover-card__action--tune"
                aria-label={`Tune in to ${item.stationName}`}
                onClick={() => onTuneIn(item.row)}
              >
                Tune in
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// First plays — cover-first cards for confirmed first appearances in Lore
// ---------------------------------------------------------------------------

export interface FirstPlayCoverItem {
  id: number;
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  releaseYear: number | null;
  releaseDate: string | null;
  playedAt?: string;
  station: { slug: string; name: string };
}

/**
 * Explore's first-play rail. Reuses the existing first-plays history path
 * (/api/player/history?filter=firstPlays — the same archive read the home
 * rail uses) so "first play" keeps its established meaning: a confirmed,
 * resolved first appearance in Lore, never an inferred "premiere".
 *
 * Action split per card: the cover/title opens the recording detail,
 * "Preview" starts an exact-track preview replay, and "Tune in" (only shown
 * while the station is live) enters the live broadcast.
 */
export function FirstPlayCoverRail({
  liveSlugs,
  onTuneStation,
  limit = FIRST_PLAY_LIMIT,
}: {
  /** Slugs of stations currently live — gates the per-card Tune in action. */
  liveSlugs: ReadonlySet<string>;
  onTuneStation: (slug: string) => void;
  limit?: number;
}) {
  const { ride } = usePlayer();
  // null = still loading or unavailable (the rail stays out of the layout
  // entirely until real items arrive, so nothing jumps when they do).
  const [items, setItems] = useState<FirstPlayCoverItem[] | null>(null);

  useEffect(() => {
    if (typeof fetch !== "function") return;
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    // limit MUST stay FIRST_PLAY_REQUEST_LIMIT regardless of the render cap:
    // any other value silently drops the request onto the personalized
    // archive path for signed-in listeners (see the contract note above).
    void fetch(
      `/api/player/history?scope=7d&filter=firstPlays&order=desc&limit=${FIRST_PLAY_REQUEST_LIMIT}&home=1`,
      { signal: controller.signal },
    )
      .then((response) => {
        if (!response.ok) throw new Error("first plays unavailable");
        return response.json() as Promise<{ items?: FirstPlayCoverItem[] }>;
      })
      .then((data) => {
        if (!cancelled) setItems((data.items ?? []).slice(0, limit));
      })
      .catch(() => {
        // Optional archive read: fail quietly, the live feed stands alone.
        if (!cancelled) setItems([]);
      })
      .finally(() => clearTimeout(timeoutId));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [limit]);

  if (!items || items.length === 0) return null;
  return (
    <section
      className="cover-rail"
      aria-label="First plays"
      data-testid="first-play-cover-rail"
    >
      <header className="cover-rail__header">
        <h2 className="cover-rail__title">New to Lore</h2>
        <span className="cover-rail__context">first plays across the dial</span>
      </header>
      <div className="cover-rail__scroll">
        {items.map((item) => (
          <article
            key={item.id}
            className="cover-card"
            data-testid={`first-play-cover-card-${item.id}`}
          >
            <Link
              href={`/song/${item.mbid}`}
              className="cover-card__record"
              aria-label={`Open ${item.title} by ${item.artist}`}
            >
              <img
                className="cover-card__art"
                src={item.artworkUrl ? proxyArtUrl(item.artworkUrl) ?? RUMOURS : RUMOURS}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={onArtError}
                data-testid="first-play-cover-art"
              />
              <span className="cover-card__artist">{item.artist}</span>
              <span className="cover-card__title">{item.title}</span>
            </Link>
            <span className="cover-card__provenance">
              First play · {item.station.name}
              <span aria-hidden="true"> · </span>
              {releaseDateLabel(item)}
            </span>
            <div className="cover-card__actions">
              <button
                type="button"
                className="cover-card__action cover-card__action--preview"
                aria-label={`Preview ${item.artist} — ${item.title}`}
                onClick={() => {
                  ride.startReplay(
                    [{
                      mbid: item.mbid,
                      title: item.title,
                      artist: item.artist,
                      artworkUrl: item.artworkUrl,
                      links: [],
                    }],
                    `First play · ${item.station.name}`,
                    { timeOrientation: "curated", previewOnly: true, previewDwellMs: 7_000 },
                  );
                }}
              >
                Preview
              </button>
              {liveSlugs.has(item.station.slug) && (
                <button
                  type="button"
                  className="cover-card__action cover-card__action--tune"
                  aria-label={`Tune in to ${item.station.name}`}
                  onClick={() => onTuneStation(item.station.slug)}
                >
                  Tune in
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
