/**
 * SetContextDeck — the 3-cover strip on a Library crate row.
 *
 * Shows the songs played immediately before / at / after the keep, side by
 * side in broadcast order. One cover is always selected (default: the kept
 * track) and the caption line under the strip names the selected song;
 * hovering, focusing, or tapping a cover selects it. Playable covers are
 * inline iTunes preview play buttons.
 *
 * Honest gaps: a missing neighbor renders an empty dimmed slot, and a track
 * without a MusicBrainz id is selectable (its caption works) but not
 * playable — previews resolve by MBID only.
 */
import { useRef, useState } from "react";
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

function DeckCover({ slot, onPlayStart, selected, onSelect, canHoverSelect }: {
  slot: DeckSlot;
  onPlayStart?: () => void;
  selected: boolean;
  onSelect: () => void;
  /** True only after the pointer has actually moved — a cursor resting over a
      cover from before render must not hijack the selection. */
  canHoverSelect: () => boolean;
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

  if (!track) {
    return (
      <span
        className={`set-context-deck__cover set-context-deck__cover--${role} set-context-deck__cover--empty`}
        title={label}
        data-testid={`set-context-cover-${role}`}
        data-empty="true"
      />
    );
  }

  if (!playable) {
    // No MBID → no preview, but the cover is still selectable so the caption
    // line can name it.
    return (
      <button
        type="button"
        className={`set-context-deck__cover set-context-deck__cover--${role}`}
        title={label}
        aria-label={`Show ${label}`}
        aria-pressed={selected}
        data-testid={`set-context-cover-${role}`}
        data-selected={selected ? "true" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onMouseEnter={() => {
          if (canHoverSelect()) onSelect();
        }}
        onFocus={onSelect}
      >
        {image}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`set-context-deck__cover set-context-deck__cover--${role} set-context-deck__cover--playable${isPlaying ? " is-playing" : ""}`}
      data-selected={selected ? "true" : undefined}
      onMouseEnter={() => {
        if (canHoverSelect()) onSelect();
      }}
      onFocus={onSelect}
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
        onSelect();
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
  const [selected, setSelected] = useState<DeckRole>("anchor");
  // Hover-select arms only once the pointer MOVES over the deck; otherwise a
  // cursor left resting on a cover would select it on mount/hot-reload.
  const hoverArmed = useRef(false);
  const slots: DeckSlot[] = [
    { role: "before", track: context.before },
    { role: "anchor", track: context.anchor },
    { role: "after", track: context.after },
  ];
  const selectedTrack = slots.find((slot) => slot.role === selected)?.track ?? context.anchor;
  return (
    <span className="set-context-deck__wrap">
      <span
        className="set-context-deck"
        style={{ "--deck-cover": `${size}px` } as React.CSSProperties}
        data-testid="set-context-deck"
        role="group"
        aria-label="Songs played around this keep"
        onMouseMove={() => {
          hoverArmed.current = true;
        }}
      >
        {slots.map((slot) => (
          <DeckCover
            key={slot.role}
            slot={slot}
            onPlayStart={onPlayStart}
            selected={selected === slot.role}
            onSelect={() => setSelected(slot.role)}
            canHoverSelect={() => hoverArmed.current}
          />
        ))}
      </span>
      {/* The line under the covers names the SELECTED one, aligned beneath
          that cover (centered under the kept middle cover by default). */}
      <span
        className="set-context-deck__caption"
        data-testid="set-context-caption"
        data-role={selected}
        aria-live="polite"
      >
        {selectedTrack ? trackLabel(selectedTrack, selected) : " "}
      </span>
      {context.anchorKind === "artist-fallback" && (
        <span className="set-context-deck__note" data-testid="set-context-note">
          latest set
        </span>
      )}
    </span>
  );
}
