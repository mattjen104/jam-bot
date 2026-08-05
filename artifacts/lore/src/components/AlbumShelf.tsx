import { useState, useEffect } from "react";
import { proxyArtUrl } from "../lib/proxyArt";
import {
  useGetRecordingAlbumTracks,
  getGetRecordingAlbumTracksQueryKey,
} from "@workspace/api-client-react";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import { KeepButton } from "./KeepButton";
import { ArtistPortalStrip } from "./ArtistPortalStrip";
import { ExternalLink } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function artGradient(a: string, b: string): string {
  let x = 0;
  for (const c of a + b) x = ((x * 31 + c.charCodeAt(0)) >>> 0);
  const h = x % 360;
  return `linear-gradient(150deg,hsl(${h},22%,20%),hsl(${(h + 42) % 360},28%,32%))`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return "";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const TRACK_PREVIEW_COUNT = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShelfTrack {
  mbid: string;
  title: string;
  artist: string;
  durationMs: number | null;
  position: number;
}

interface ShelfAlbum {
  rgMbid: string;
  rgTitle: string | null;
  rgType: string | null;
  releaseYear: number | null;
  artworkUrl: string | null;
  tracks: ShelfTrack[];
}

// ---------------------------------------------------------------------------
// AlbumShelf
// ---------------------------------------------------------------------------

interface AlbumShelfProps {
  /** Kept recording MBID — used to resolve the album */
  mbid: string;
  /** Artist name for display */
  artistName: string;
}

export function AlbumShelf({ mbid, artistName }: AlbumShelfProps) {
  // Active release group: null = use the recording's primary RG
  const [swappedAlbum, setSwappedAlbum] = useState<ShelfAlbum | null>(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Primary album for the kept recording
  const {
    data: primaryAlbumRaw,
    isLoading: primaryLoading,
    isError: primaryError,
  } = useGetRecordingAlbumTracks(mbid, {
    query: {
      queryKey: getGetRecordingAlbumTracksQueryKey(mbid),
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
    },
  });

  // Normalize primary album into ShelfAlbum shape
  const primaryAlbum: ShelfAlbum | null = primaryAlbumRaw
    ? {
        rgMbid: primaryAlbumRaw.rgMbid,
        rgTitle: primaryAlbumRaw.rgTitle,
        rgType: primaryAlbumRaw.rgType,
        releaseYear: (primaryAlbumRaw as { releaseYear?: number | null }).releaseYear ?? null,
        artworkUrl: (primaryAlbumRaw as { artworkUrl?: string | null }).artworkUrl ?? null,
        tracks: primaryAlbumRaw.tracks.map((t, idx) => ({
          mbid: t.mbid,
          title: t.title,
          artist: t.artist,
          durationMs: (t as { durationMs?: number | null }).durationMs ?? null,
          position: (t as { position?: number }).position ?? idx + 1,
        })),
      }
    : null;

  const album = swappedAlbum ?? primaryAlbum;
  const isLoading = primaryLoading && !swappedAlbum;
  const isError = primaryError && !swappedAlbum;

  const activeRgMbid = swappedAlbum?.rgMbid ?? primaryAlbum?.rgMbid ?? null;

  const { ride, spotify } = usePlayer();

  // Reset "show all" when the album changes
  useEffect(() => { setShowAll(false); }, [swappedAlbum?.rgMbid]);

  async function handleSwapAlbum(rgMbid: string) {
    if (rgMbid === activeRgMbid) return;
    setSwapLoading(true);
    setShowAll(false);
    try {
      const res = await fetch(`/api/release-groups/${rgMbid}/tracks`);
      if (!res.ok) throw new Error("not_found");
      const data = await res.json() as ShelfAlbum;
      setSwappedAlbum(data);
    } catch {
      // ignore — keep showing current album
    } finally {
      setSwapLoading(false);
    }
  }

  function handlePlayTrack(t: ShelfTrack) {
    const seed: RideSeed = {
      mbid: t.mbid,
      title: t.title,
      artist: t.artist,
      artworkUrl: album?.artworkUrl ?? null,
      links: [],
    };
    ride.startReplay([seed], t.title, { timeOrientation: "curated", context: "library" });
  }

  function handlePlayAlbum() {
    if (!album || album.tracks.length === 0) return;
    const seeds: RideSeed[] = album.tracks.map((t) => ({
      mbid: t.mbid,
      title: t.title,
      artist: t.artist,
      artworkUrl: album.artworkUrl ?? null,
      links: [],
    }));
    ride.startReplay(seeds, album.rgTitle ?? artistName, { timeOrientation: "curated", context: "library" });
  }

  const tracks = album?.tracks ?? [];
  const visibleTracks = showAll ? tracks : tracks.slice(0, TRACK_PREVIEW_COUNT);
  const hiddenCount = tracks.length - TRACK_PREVIEW_COUNT;

  void spotify; // suppress unused

  return (
    <div className="lrow__shelf" onClick={(e) => e.stopPropagation()}>
      {/* Loading skeleton */}
      {(isLoading || swapLoading) ? (
        <div className="lrow__shelf-hd">
          <span className="lrow__shelf-art lrow__shelf-art--skel" />
          <div className="lrow__shelf-meta">
            <div className="lrow__shelf-skel lrow__shelf-skel--title" />
            <div className="lrow__shelf-skel lrow__shelf-skel--year" />
          </div>
        </div>
      ) : isError ? (
        /* Error state */
        <div className="lrow__shelf-error">
          <span>Couldn't load album</span>
          <a
            href={`https://musicbrainz.org/recording/${mbid}`}
            target="_blank"
            rel="noreferrer"
            className="lrow__shelf-mb-link"
          >
            <ExternalLink style={{ width: 10, height: 10, display: "inline", verticalAlign: "middle", marginRight: 3 }} />
            View on MusicBrainz
          </a>
        </div>
      ) : album ? (
        <>
          {/* Album header */}
          <div className="lrow__shelf-hd">
            {album.artworkUrl ? (
              <img
                src={proxyArtUrl(album.artworkUrl)!}
                alt=""
                className="lrow__shelf-art"
                loading="lazy"
              />
            ) : (
              <span
                className="lrow__shelf-art lrow__shelf-art--grad"
                style={{ background: artGradient(album.rgTitle ?? "", artistName) }}
              />
            )}
            <div className="lrow__shelf-meta">
              <div className="lrow__shelf-album-title">
                {album.rgTitle ?? "Unknown album"}
              </div>
              <div className="lrow__shelf-album-sub">
                {[album.rgType, album.releaseYear].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button
              type="button"
              className="lrow__shelf-play-all"
              onClick={handlePlayAlbum}
              title="Play album from track 1"
              disabled={tracks.length === 0}
            >
              ▶ Album
            </button>
          </div>

          {/* Tracklist skeleton while swapping */}
          {swapLoading ? (
            <ul className="lrow__shelf-tracks">
              {[1, 2, 3].map((i) => (
                <li key={i} className="lrow__shelf-track lrow__shelf-track--skel">
                  <span className="lrow__shelf-track-pos" />
                  <span className="lrow__shelf-skel lrow__shelf-skel--track" />
                </li>
              ))}
            </ul>
          ) : (
            <>
              <ul className="lrow__shelf-tracks">
                {visibleTracks.map((t) => (
                  <li key={t.mbid} className="lrow__shelf-track">
                    <span className="lrow__shelf-track-pos">{t.position}</span>
                    <button
                      type="button"
                      className="lrow__shelf-track-title"
                      onClick={() => handlePlayTrack(t)}
                      title={`Play ${t.title}`}
                    >
                      {t.title}
                    </button>
                    {t.durationMs != null && (
                      <span className="lrow__shelf-track-dur">{fmtDuration(t.durationMs)}</span>
                    )}
                    <KeepButton mbid={t.mbid} compact />
                  </li>
                ))}
              </ul>

              {!showAll && hiddenCount > 0 && (
                <button
                  type="button"
                  className="lrow__shelf-show-all"
                  onClick={() => setShowAll(true)}
                >
                  Show all {tracks.length} tracks
                </button>
              )}
            </>
          )}

          {/* Artist portal strip */}
          <ArtistPortalStrip
            recordingMbid={mbid}
            activeRgMbid={activeRgMbid}
            artistName={artistName}
            onSelect={handleSwapAlbum}
          />
        </>
      ) : null}
    </div>
  );
}
