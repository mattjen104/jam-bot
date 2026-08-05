/**
 * ListenerAvatarStack — compact horizontal stack of album-cover thumbnails
 * representing community listeners currently tuned into a station.
 *
 * Props:
 *   avatars  — privacy-thresholded covers from useStationPresence
 *   count    — total listener count (may be > avatars.length)
 *   isActive — true when the viewer themselves is tuned into this station
 */

// ---------------------------------------------------------------------------
// Keyframe injection (once per document)
// ---------------------------------------------------------------------------

const STYLE_ID = "listener-avatar-stack-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes las-pulse {
      0%   { box-shadow: 0 0 0 0 hsl(var(--las-live) / 0.55); }
      60%  { box-shadow: 0 0 0 4px hsl(var(--las-live) / 0); }
      100% { box-shadow: 0 0 0 0 hsl(var(--las-live) / 0); }
    }
    .las-dot {
      position: absolute;
      bottom: -2px;
      right: -2px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: hsl(var(--las-live));
      border: 1.5px solid var(--las-bg, #1a1625);
      animation: las-pulse 2.4s ease-out infinite;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";

const MAX_VISIBLE = 4;

export interface ListenerAvatarStackProps {
  avatars: Array<{ artworkUrl: string; albumTitle: string; artist: string }>;
  count: number;
  isActive?: boolean;
}

export function ListenerAvatarStack({
  avatars,
  count,
  isActive = false,
}: ListenerAvatarStackProps) {
  if (count <= 0) return null;

  const shown = avatars.slice(0, MAX_VISIBLE);
  const overflow = count - shown.length;
  // Others present beyond the viewer themselves
  const othersCount = isActive ? count - 1 : count;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 5,
        // CSS custom properties for the live-dot colour, sourced from existing
        // dial token palette (accent = yellow-green 76 90% 60%).
        // We use the accent hue for the live dot rather than --live (blue) to
        // visually distinguish "people here now" from the live-broadcast dot.
        ["--las-live" as string]: "76 80% 52%",
      }}
    >
      {/* Avatar stack */}
      {shown.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
          }}
        >
          {shown.map((av, i) => (
            <div
              key={`${av.artworkUrl}-${i}`}
              title={`${av.albumTitle} · ${av.artist}`}
              style={{
                position: "relative",
                marginLeft: i === 0 ? 0 : -8,
                zIndex: shown.length - i,
                flexShrink: 0,
              }}
            >
              <img
                src={proxyArtUrl(av.artworkUrl)!}
                alt={av.albumTitle}
                onError={onArtError}
                width={28}
                height={28}
                style={{
                  display: "block",
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  objectFit: "cover",
                  border: "1.5px solid var(--background, #1a1625)",
                }}
              />
              {/* Live indicator dot */}
              <span className="las-dot" aria-hidden="true" />
            </div>
          ))}
        </div>
      )}

      {/* +N overflow chip when there are more listeners than shown covers */}
      {overflow > 0 && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 20,
            minWidth: 20,
            padding: "0 5px",
            borderRadius: 10,
            background: "hsl(var(--accent) / 0.18)",
            border: "1px solid hsl(var(--accent) / 0.3)",
            fontSize: 10,
            fontWeight: 600,
            color: "hsl(var(--accent-foreground, 80 40% 15%))",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            // ensure the chip is readable on dim rows
            opacity: 0.9,
          }}
          aria-label={`${overflow} more listeners`}
        >
          +{overflow}
        </span>
      )}

      {/* "also here" / "you + N others" framing */}
      <span
        style={{
          fontSize: 11,
          color: "hsl(var(--muted-foreground) / 0.7)",
          lineHeight: 1,
        }}
      >
        {isActive && othersCount > 0
          ? `you + ${othersCount} other${othersCount === 1 ? "" : "s"} here`
          : isActive
            ? "you're here"
            : shown.length === 0
              ? `${count} listener${count === 1 ? "" : "s"} here`
              : "also here"}
      </span>
    </div>
  );
}
