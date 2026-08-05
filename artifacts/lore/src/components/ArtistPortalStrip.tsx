import { useState, useEffect } from "react";
import { RUMOURS, onArtError } from "../lib/rumours";

interface ArtistRelease {
  releaseGroupMbid: string;
  title: string | null;
  primaryType: string | null;
  releaseYear: number | null;
  artworkUrl: string | null;
}

interface ArtistPortalStripProps {
  /** The kept recording MBID (used to discover the artist's releases) */
  recordingMbid: string;
  /** Currently active release group MBID (highlighted) */
  activeRgMbid: string | null;
  /** Artist name for display label */
  artistName: string;
  /** Called when the user taps a different album tile */
  onSelect: (rgMbid: string) => void;
}

export function ArtistPortalStrip({
  recordingMbid,
  activeRgMbid,
  artistName,
  onSelect,
}: ArtistPortalStripProps) {
  const [releases, setReleases] = useState<ArtistRelease[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/recordings/${recordingMbid}/artist-releases`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { releases: ArtistRelease[] }) => {
        if (!cancelled) setReleases(data.releases ?? []);
      })
      .catch(() => {
        if (!cancelled) setReleases([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [recordingMbid]);

  // Don't render if loading or no other releases
  if (loading || !releases || releases.length <= 1) return null;

  // Filter out the active release group so it still appears but can be re-selected
  const displayReleases = releases;

  return (
    <div className="lrow__portal">
      <div className="lrow__portal-label">More by {artistName}</div>
      <div className="lrow__portal-scroll">
        {displayReleases.map((r) => {
          const isActive = r.releaseGroupMbid === activeRgMbid;
          return (
            <button
              key={r.releaseGroupMbid}
              type="button"
              className={`lrow__portal-tile${isActive ? " lrow__portal-tile--active" : ""}`}
              onClick={() => onSelect(r.releaseGroupMbid)}
              title={[r.title, r.releaseYear].filter(Boolean).join(" · ")}
            >
              <img
                src={r.artworkUrl ?? RUMOURS}
                alt={r.title ?? ""}
                className="lrow__portal-tile-art"
                loading="lazy"
                onError={onArtError}
              />
              <div className="lrow__portal-tile-name">
                {r.title ?? r.primaryType ?? ""}
                {r.releaseYear ? ` '${String(r.releaseYear).slice(-2)}` : ""}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
