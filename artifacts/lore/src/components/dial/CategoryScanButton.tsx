/**
 * CategoryScanButton — one station-category tile in the Dial's Scan lens.
 *
 * Shows the category label, a rotating now-playing line
 * (`artist · station name`), and a faint "N live" badge. Every ~4 s the
 * displayed station advances to the next station in the category that has a
 * known artist currently playing; stations with unknown/blank artists are
 * skipped entirely. Tapping the button tunes to the station whose track is
 * shown at that moment.
 *
 * Pure presentational: all data arrives via props (no fetches here).
 */
import { useEffect, useMemo, useState } from "react";
import type { Station } from "@workspace/api-client-react";
import type { DialSpin } from "../../hooks/useDialData";
import type { StationCategory } from "../../lib/dialCategories";
import { cleanLiveValue } from "../dialViewHelpers";

/** How long each station holds the button before the rotation advances. */
export const SCAN_ROTATE_MS = 4000;

/**
 * Artist-field placeholders that survive cleanLiveValue's generic blocklist
 * but are never real artists. Scan only rotates through KNOWN artists.
 */
const SCAN_UNKNOWN_ARTISTS = new Set([
  "unknown artist",
  "artist unknown",
  "various artists",
  "no artist",
]);

/** The station's live artist, or null when it is blank/unknown/placeholder. */
function knownLiveArtist(nowPlayingBySlug: Map<string, DialSpin>, slug: string): string | null {
  const artist = cleanLiveValue(nowPlayingBySlug.get(slug)?.artist);
  if (!artist) return null;
  return SCAN_UNKNOWN_ARTISTS.has(artist.toLowerCase()) ? null : artist;
}

export interface CategoryScanButtonProps {
  category: StationCategory;
  label: string;
  /** Curated stations in this category. */
  stations: Station[];
  /** Live now-playing track per station slug (REST poll + SSE overrides). */
  nowPlayingBySlug: Map<string, DialSpin>;
  /** Slug of the station the listener is currently tuned to, if any. */
  activeSlug: string | null;
  onTuneIn: (slug: string) => void;
  newMusicCount?: number;
  onScanCategory?: (category: StationCategory) => void;
}

export function CategoryScanButton({
  category,
  label,
  stations,
  nowPlayingBySlug,
  activeSlug,
  onTuneIn,
  newMusicCount = 0,
  onScanCategory,
}: CategoryScanButtonProps) {
  // Only stations airing a known artist right now participate — the rotation
  // and the "N live" badge both draw from this list. cleanLiveValue drops
  // blank and placeholder ("unknown", "n/a", …) artist fields.
  const live = useMemo(
    () =>
      stations
        .map((station) => ({
          station,
          artist: knownLiveArtist(nowPlayingBySlug, station.slug),
        }))
        .filter((entry): entry is { station: Station; artist: string } => entry.artist != null),
    [stations, nowPlayingBySlug],
  );

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (live.length < 2) return;
    const id = window.setInterval(() => setTick((t) => t + 1), SCAN_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [live.length]);

  // Modulo at render (not in the interval) so a shrinking live list never
  // points the rotation out of range.
  const current = live.length > 0 ? live[tick % live.length] : null;
  const isActive = current != null && current.station.slug === activeSlug;

  return (
    <button
      type="button"
      className={`dial-scan__btn${isActive ? " dial-scan__btn--active" : ""}`}
      disabled={current == null}
      data-testid={`dial-scan-${category}`}
      onClick={() => {
        if (newMusicCount > 0 && onScanCategory) onScanCategory(category);
        else if (current) onTuneIn(current.station.slug);
      }}
    >
      <span className="dial-scan__label">{label}</span>
      <span className="dial-scan__now">
        {current ? (
          <>
            {current.artist}
            {" · "}
            <b className="dial-scan__station">{current.station.name}</b>
          </>
        ) : (
          "Quiet right now"
        )}
      </span>
       <span className="dial-scan__count">
         {newMusicCount > 0 ? `${newMusicCount} new · preview` : `${live.length} live`}
       </span>
    </button>
  );
}
