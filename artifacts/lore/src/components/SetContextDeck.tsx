/**
 * SetContextDeck — the peek-a-set cover on a Library crate row.
 *
 * One cover is visible at a time (the kept track by default). The songs
 * played immediately before / after the keep stay hidden until the listener
 * swipes horizontally across the cover or taps the flanking chevrons (‹ ›).
 * The visible cover keeps its inline iTunes preview behavior (tap to play;
 * previews resolve by MBID only).
 *
 * Peeks are reported to the host via onSelectionChange so the row's copy
 * column can name the song on the visible cover ((null, "anchor") when back
 * on the kept track). Honest gaps: a missing neighbor is still reachable and
 * renders an empty dimmed slot whose label says nothing was played there.
 */
import { useEffect, useRef, useState } from "react";
import type { SetContext, SetContextTrack } from "../lib/setContexts";
import { useInlinePreview } from "../player/inlinePreview";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";

type DeckRole = "before" | "anchor" | "after";

const ROLE_ORDER: readonly DeckRole[] = ["before", "anchor", "after"];

/** Horizontal distance (px) that separates a swipe from a sloppy tap. */
const SWIPE_MIN_PX = 40;

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
    <img src={proxyArtUrl(art) ?? art} alt="" onError={onArtError} />
  ) : (
    <img
      src={`${import.meta.env.BASE_URL}rumours.jpg`}
      alt=""
      className="set-context-deck__fallback"
    />
  );

  if (!track) {
    return (
      <span
        className={`set-context-deck__cover set-context-deck__cover--${role} set-context-deck__cover--empty`}
        title={label}
        aria-label={label}
        data-testid={`set-context-cover-${role}`}
        data-empty="true"
      />
    );
  }

  if (!playable) {
    // No MBID → no preview; the host's caption still names the track.
    return (
      <span
        className={`set-context-deck__cover set-context-deck__cover--${role}`}
        title={label}
        role="img"
        aria-label={label}
        data-testid={`set-context-cover-${role}`}
      >
        {image}
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
  /** Minimum pixel size of the visible cover; kept-track rows grow it to the full card height. */
  size?: number;
  /** Called before a preview starts so the host can yield other audio. */
  onPlayStart?: () => void;
  /** Reports peeks: (label, role) for before/after, (null, "anchor") when back on the kept track. */
  onSelectionChange?: (label: string | null, role: "before" | "anchor" | "after") => void;
}

export function SetContextDeck({ context, size = 92, onPlayStart, onSelectionChange }: SetContextDeckProps) {
  const [selected, setSelected] = useState<DeckRole>("anchor");
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const slots: DeckSlot[] = [
    { role: "before", track: context.before },
    { role: "anchor", track: context.anchor },
    { role: "after", track: context.after },
  ];
  const index = ROLE_ORDER.indexOf(selected);
  const visible = slots.find((slot) => slot.role === selected) ?? slots[1];
  // Identity of the track on the visible cover; keys DeckCover so per-track
  // preview state (e.g. "unavailable") can never leak onto the next song.
  const visibleKey = `${visible.role}:${visible.track?.mbid ?? visible.track?.spinId ?? "empty"}`;
  // Peeks are reported from an effect keyed on the visible track, not from
  // the navigation handlers: if fresh context data changes the neighbor on
  // display under a steady selection, the host's caption still re-syncs.
  const lastReported = useRef(visibleKey);
  useEffect(() => {
    if (lastReported.current === visibleKey) return;
    lastReported.current = visibleKey;
    onSelectionChange?.(
      selected === "anchor" ? null : trackLabel(visible.track, selected),
      selected,
    );
  }, [visibleKey, selected, visible.track, onSelectionChange]);

  const select = (role: DeckRole) => {
    setSelected(role);
  };
  const goPrev = () => {
    if (index > 0) select(ROLE_ORDER[index - 1]);
  };
  const goNext = () => {
    if (index < ROLE_ORDER.length - 1) select(ROLE_ORDER[index + 1]);
  };
  /** Chevron labels name the actual destination, including the way back. */
  const destinationLabel = (slot: DeckSlot): string =>
    slot.role === "anchor"
      ? `Back to the kept track: ${trackLabel(slot.track, slot.role)}`
      : `Show the song played ${slot.role}: ${trackLabel(slot.track, slot.role)}`;

  return (
    <span className="set-context-deck__wrap">
      <span
        className="set-context-deck"
        style={{ "--deck-cover": `${size}px` } as React.CSSProperties}
        data-testid="set-context-deck"
        role="group"
        aria-label="Songs played around this keep"
        onTouchStart={(e) => {
          if (e.touches.length !== 1) {
            touchStart.current = null; // multi-touch is a pinch/zoom, not a peek
            return;
          }
          const t = e.touches[0];
          if (t) touchStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchCancel={() => {
          touchStart.current = null;
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          touchStart.current = null;
          const t = e.changedTouches[0];
          if (!start || !t) return;
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          // Deliberate horizontal swipes only — never steal a vertical scroll.
          if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
          // A recognized swipe must not also fire the browser's compatibility
          // click (it would play the newly shown cover or re-hit a chevron).
          e.preventDefault();
          if (dx < 0) goNext();
          else goPrev();
        }}
      >
        <button
          type="button"
          className="set-context-deck__chevron"
          aria-label={index > 0 ? destinationLabel(slots[index - 1]) : "No earlier song in this set"}
          title="Played before"
          data-testid="set-context-prev"
          disabled={index === 0}
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
        >
          ‹
        </button>
        <DeckCover key={visibleKey} slot={visible} onPlayStart={onPlayStart} />
        <button
          type="button"
          className="set-context-deck__chevron"
          aria-label={index < ROLE_ORDER.length - 1 ? destinationLabel(slots[index + 1]) : "No later song in this set"}
          title="Played after"
          data-testid="set-context-next"
          disabled={index === ROLE_ORDER.length - 1}
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
        >
          ›
        </button>
      </span>
      {context.anchorKind === "artist-fallback" && (
        <span className="set-context-deck__note" data-testid="set-context-note">
          latest set
        </span>
      )}
    </span>
  );
}
