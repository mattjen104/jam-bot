/**
 * StationMark — the station's own identity image (`Station.logoUrl`: Radio
 * Browser favicon for discovered stations, curated logos when available).
 *
 * Purpose: give listeners an instant station-level identifier that never
 * waits on per-track resolution (MusicBrainz, album art, fingerprinting).
 * The mark is station identity only — track artwork stays reserved for the
 * track and is never substituted here.
 *
 * Behaviour contract:
 *  - Reads the URL already present on the station payload; fires no requests
 *    of its own beyond the (lazy, async-decoded) image itself.
 *  - External URLs route through the existing art proxy (same caching and
 *    mixed-content upgrade as other external imagery); non-http(s) values
 *    are rejected by safeHttpUrl.
 *  - Missing, invalid, or failed logo URLs try the station homepage favicon
 *    before falling back to a neutral radio-glyph mark — never a broken image
 *    or album artwork.
 *  - Decorative: adjacent station-name text stays the accessible identity,
 *    so the mark is hidden from assistive tech and never interactive.
 */
import { useState } from "react";
import { Radio } from "lucide-react";
import { proxyArtUrl } from "../lib/proxyArt";
import { stationFaviconUrl } from "../lib/stationArt";
import { safeHttpUrl } from "../lib/utils";

export interface StationMarkProps {
  /** Station name — used only for the fallback title; the visible/accessible
   *  station name is always rendered separately by the caller. */
  name: string;
  logoUrl?: string | null;
  homepageUrl?: string | null;
  /** "inline" sits beside text at cap height; "cube" is the larger block used
   *  to the left of now-playing text in single-station lists. */
  variant?: "inline" | "cube";
  className?: string;
}

export function StationMark({
  name,
  logoUrl,
  homepageUrl,
  variant = "inline",
  className,
}: StationMarkProps) {
  // Track the failed URL (not a boolean) so a later, different logoUrl gets
  // a fresh attempt instead of inheriting the failure.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const safe = safeHttpUrl(logoUrl);
  const fallback = stationFaviconUrl(homepageUrl);
  const fallbackSrc = fallback ? proxyArtUrl(fallback) : null;
  const primarySrc = safe ? proxyArtUrl(safe) : null;
  // A failed explicit logo should not strand the station on a glyph when its
  // homepage still has a usable domain favicon.
  const src = primarySrc && failedSrc !== primarySrc ? primarySrc : fallbackSrc;

  const cls = ["station-mark", `station-mark--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  if (!src || failedSrc === src) {
    return (
      <span
        className={`${cls} station-mark--fallback`}
        title={name}
        aria-hidden="true"
        data-station-mark="fallback"
      >
        <Radio aria-hidden="true" />
      </span>
    );
  }

  return (
    <img
      className={cls}
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailedSrc(src)}
      data-station-mark="logo"
    />
  );
}
