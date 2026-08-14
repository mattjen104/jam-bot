/**
 * CompactStack — the bottom band of the SplitHome layout.
 *
 * Shows up to 5 album groups, newest-first, from the listener's combined
 * kept + Spotify-imported library (first page of useMyLibraryInfinite,
 * grouped with buildAlbumGroups). Each
 * row is a read-only summary — `album title · artist` — over a full-bleed
 * cassette-spine strip: the album artwork as a blurred/darkened background
 * so the text stays legible. No expand/collapse, no scrolling.
 */

import { useMemo } from "react";
import { useLocation } from "wouter";
import { useMyLibraryInfinite } from "../lib/meHooks";
import { buildAlbumGroups, type AlbumGroup } from "../pages/Library";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";

const COMPACT_STACK_SIZE = 5;

export function CompactStack() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useMyLibraryInfinite({}, 100);

  const groups = useMemo<AlbumGroup[]>(() => {
    const items = data?.pages[0]?.items ?? [];
    return buildAlbumGroups(items).slice(0, COMPACT_STACK_SIZE);
  }, [data]);

  return (
    <div className="compact-stack" aria-label="Recent keeps">
      {groups.map((group) => {
        const art = proxyArtUrl(group.artworkUrl);
        const label = group.artist
          ? `${group.albumTitle} · ${group.artist}`
          : group.albumTitle;
        return (
          <button
            key={group.key}
            type="button"
            className="compact-stack__row"
            aria-label={`Open ${label} in your Stack`}
            onClick={() =>
              setLocation(`/library?openAlbum=${encodeURIComponent(group.key)}`)
            }
          >
            {/* Cassette-spine background: blurred/darkened album art.
                An <img> (not background-image) so onArtError retry/fallback
                works; the overlay div keeps the text legible. */}
            {art && (
              <img
                className="compact-stack__spine-art"
                src={art}
                alt=""
                aria-hidden="true"
                loading="lazy"
                onError={onArtError}
              />
            )}
            <div className="compact-stack__overlay" aria-hidden="true" />
            <span className="compact-stack__text">
              <span className="compact-stack__album">{group.albumTitle}</span>
              {group.artist && (
                <>
                  <span className="compact-stack__sep" aria-hidden="true">·</span>
                  <span className="compact-stack__artist">{group.artist}</span>
                </>
              )}
            </span>
          </button>
        );
      })}
      {!isLoading && groups.length === 0 && (
        <button
          type="button"
          className="compact-stack__empty"
          onClick={() => setLocation("/library")}
        >
          Nothing kept yet — your Stack starts with the first track you keep.
        </button>
      )}
    </div>
  );
}
