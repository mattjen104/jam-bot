import { useState, useEffect } from "react";

/** Deterministic gradient for album art fallback */
function artGradient(a: string, b: string): string {
  let x = 0;
  for (const c of a + b) x = ((x * 31 + c.charCodeAt(0)) >>> 0);
  const h = x % 360;
  return `linear-gradient(150deg,hsl(${h},22%,20%),hsl(${(h + 42) % 360},28%,32%))`;
}

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
              {r.artworkUrl ? (
                <img
                  src={r.artworkUrl}
                  alt={r.title ?? ""}
                  className="lrow__portal-tile-art"
                  loading="lazy"
                />
              ) : (
                <span
                  className="lrow__portal-tile-art--grad"
                  style={{ background: artGradient(r.title ?? "", artistName) }}
                />
              )}
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
