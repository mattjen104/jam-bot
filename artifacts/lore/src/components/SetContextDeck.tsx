/**
 * SetContextDeck — the 3-cover cluster on a Library crate row.
 *
 * Shows the kept/crossed track's cover on top with the covers of the songs
 * played immediately before and after it stacked behind. Hovering or
 * keyboard-focusing the deck fans all three out side by side ("swap what the
 * row shows"); each cover is an inline iTunes preview play button.
 *
 * Honest gaps: a missing neighbor renders an empty dimmed slot, and a track
 * without a MusicBrainz id renders its cover (when known) but is not
 * playable — previews resolve by MBID only.
 */
import { useState } from "react";
import type { SetContext, SetContextTrack } from "../lib/setContexts";
import { useInlinePreview } from "../player/inlinePreview";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";

type DeckRole = "before" | "anchor" | "after";

interface DeckSlot {
  role: DeckRole;
  track: SetContextTrack | null;
}

function coverUrl(track: SetContextTrack | null): string | null {
  if (!track) return null;
  if (track.artworkUrl) return track.artworkUrl;
  if (track.releaseGroupMbid) {
    return `https://coverartarchive.org/release-group/${track.releaseGroupMbid}/front-1200`;
  }
  return null;
}

function trackLabel(track: SetContextTrack | null, role: DeckRole): string {
  if (!track) return role === "anchor" ? "Kept track" : `Nothing ${role} in this set`;
  const title = track.title ?? "Unknown track";
  const artist = track.artist ?? "Unknown artist";
  return `${title} — ${artist}`;
}

function DeckCover({ slot, onPlayStart }: {
  slot: DeckSlot;
  onPlayStart?: () => void;
}) {
  const { playingMbid, loadingMbid, toggle } = useInlinePreview();
  const [unavailable, setUnavailable] = useState(false);
  const { role, track } = slot;
  const art = coverUrl(track);
  const label = trackLabel(track, role);
  const playable = track?.mbid != null;
  const isPlaying = track?.mbid != null && playingMbid === track.mbid;
  const isLoading = track?.mbid != null && loadingMbid === track.mbid;

  const image = art ? (
    <img src={proxyArtUrl(art) ?? art} alt="" onError={onArtError} loading="lazy" />
  ) : (
    <img
      src={`${import.meta.env.BASE_URL}rumours.jpg`}
      alt=""
      className="set-context-deck__fallback"
      loading="lazy"
    />
  );

  if (!track || !playable) {
    return (
      <span
        className={`set-context-deck__cover set-context-deck__cover--${role}${!track ? " set-context-deck__cover--empty" : ""}`}
        title={label}
        data-testid={`set-context-cover-${role}`}
        data-empty={track ? undefined : "true"}
      >
        {track ? image : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`set-context-deck__cover set-context-deck__cover--${role} set-context-deck__cover--playable${isPlaying ? " is-playing" : ""}`}
      title={
        unavailable
          ? `${label} — no preview available`
          : isPlaying
            ? `Stop preview: ${label}`
            : `Play preview: ${label}`
      }
      aria-label={
        unavailable
          ? `No preview available for ${label}`
          : isPlaying
            ? `Stop preview of ${label}`
            : `Play preview of ${label}`
      }
      aria-pressed={isPlaying}
      data-testid={`set-context-play-${role}`}
      onClick={(e) => {
        e.stopPropagation();
        onPlayStart?.();
        void toggle(track.mbid!).then((outcome) => {
          setUnavailable(outcome === "unavailable");
        });
      }}
    >
      {image}
      <span className="set-context-deck__glyph" aria-hidden="true">
        {isLoading ? "…" : isPlaying ? "❚❚" : unavailable ? "–" : "▶"}
      </span>
    </button>
  );
}

export interface SetContextDeckProps {
  /** Resolved set context; null/undefined callers should render their fallback cover. */
  context: SetContext;
  /** Pixel size of each cover (crate rows use the track-art size). */
  size?: number;
  /** Called before a preview starts so the host can yield other audio. */
  onPlayStart?: () => void;
}

export function SetContextDeck({ context, size = 92, onPlayStart }: SetContextDeckProps) {
  const slots: DeckSlot[] = [
    { role: "before", track: context.before },
    { role: "anchor", track: context.anchor },
    { role: "after", track: context.after },
  ];
  return (
    <span className="set-context-deck__wrap">
      <span
        className="set-context-deck"
        style={{ "--deck-cover": `${size}px` } as React.CSSProperties}
        data-testid="set-context-deck"
      >
        {slots.map((slot) => (
          <DeckCover key={slot.role} slot={slot} onPlayStart={onPlayStart} />
        ))}
      </span>
      {context.anchorKind === "artist-fallback" && (
        <span className="set-context-deck__note" data-testid="set-context-note">
          latest set
        </span>
      )}
    </span>
  );
}
