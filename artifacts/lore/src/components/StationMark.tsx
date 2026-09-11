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
 *  - Missing, invalid, failed, or undersized logo URLs use a sharp generated
 *    station badge — never a stretched favicon, broken image, or album art.
 *  - Decorative: adjacent station-name text stays the accessible identity,
 *    so the mark is hidden from assistive tech and never interactive.
 */
import { useState } from "react";
import { Radio } from "lucide-react";
import { proxyArtUrl } from "../lib/proxyArt";
import { stationInitials } from "../lib/stationArt";
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
  /** Remote tiles should use compact station favicons, never shared provider
   * branding or larger rectangular station artwork. */
  faviconOnly?: boolean;
  className?: string;
}

function isSharedProviderLogo(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().includes("spinitron.com");
  } catch {
    return false;
  }
}

export function StationMark({
  name,
  logoUrl,
  variant = "inline",
  faviconOnly = false,
  className,
}: StationMarkProps) {
  // Track the failed URL (not a boolean) so a later, different logoUrl gets
  // a fresh attempt instead of inheriting the failure.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const safeCandidate = safeHttpUrl(logoUrl);
  const safe = safeCandidate && (!faviconOnly || !isSharedProviderLogo(safeCandidate))
    ? safeCandidate
    : null;
  const primarySrc = safe ? proxyArtUrl(safe) : null;
  const src = primarySrc && failedSrc !== primarySrc ? primarySrc : null;

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
        <Radio className="station-mark__radio" aria-hidden="true" />
        <span className="station-mark__initials">{stationInitials(name)}</span>
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
      onLoad={(event) => {
        const image = event.currentTarget;
        const renderedSide = Math.max(
          image.clientWidth,
          image.clientHeight,
          variant === "cube" ? 22 : 14,
        );
        const isSquare = image.naturalWidth > 0
          && image.naturalHeight > 0
          && Math.abs(image.naturalWidth - image.naturalHeight)
            <= Math.max(1, Math.round(Math.max(image.naturalWidth, image.naturalHeight) * 0.05));
        // The Library remote deliberately accepts small favicons, but only
        // square ones. Other surfaces retain the sharper 2x source-size rule.
        if (faviconOnly ? !isSquare : (
          image.naturalWidth > 0 &&
          image.naturalHeight > 0 &&
          Math.min(image.naturalWidth, image.naturalHeight) <
            Math.ceil(renderedSide * 2)
        )) {
          setFailedSrc(src);
        }
      }}
      onError={() => setFailedSrc(src)}
      data-station-mark="logo"
    />
  );
}
