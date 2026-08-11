/**
 * Zone2Lane — the Dial's "Missed while you were away" lane: ghost stations
 * that played the listener's artists but aren't currently on air.
 *
 * Uses infinite scroll (IntersectionObserver sentinel) instead of a
 * See-all / See-less toggle so the list grows naturally as the user scrolls.
 */
import { useRef, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { type GhostStation } from "../../lib/meHooks";
import { agoLabel } from "./FrontDoorRow";

/** Initial page size — rows shown before the first infinite-scroll reveal. */
export const ZONE2_INITIAL = 6;

interface GhostRowProps {
  station: GhostStation;
  isActive: boolean;
  /** Called when the station has no qualifying run (runId === null). */
  onTuneIn: () => void;
}

export function GhostRow({ station, isActive, onTuneIn }: GhostRowProps) {
  const [, navigate] = useLocation();
  const cls = ["ghost-row", isActive ? "ghost-row--playing" : ""].filter(Boolean).join(" ");

  const hasReplay = station.runId != null;

  function handleClick() {
    if (hasReplay) {
      navigate(`/replay/${station.runId}`);
    } else {
      onTuneIn();
    }
  }

  const displayName = station.showName ?? station.name;
  const timeLabel = station.playedAt ? agoLabel(station.playedAt) : null;

  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
    >
      <div className="ghost-row__c">
        <div className="ghost-row__reason">
          {hasReplay ? (
            <>
              <span className="ghost-row__show">{displayName}</span>
              {" played "}
              <b className="fdrow__artist">{station.artistName}</b>
              {timeLabel && <> · <span className="ghost-row__time">{timeLabel}</span></>}
            </>
          ) : (
            <b className="fdrow__artist">{station.artistName}</b>
          )}
        </div>
      </div>
      <div className="fdrow__station-label" aria-hidden="true">{station.name}</div>
    </div>
  );
}

export interface Zone2LaneProps {
  ghost: GhostStation[];
  activeSlug: string | null;
  onTuneGhost: (g: GhostStation) => void;
}

export function Zone2Lane({ ghost, activeSlug, onTuneGhost }: Zone2LaneProps) {
  const [visible, setVisible] = useState(ZONE2_INITIAL);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset visible count when ghost list membership changes. Render-phase
  // state adjustment (not an effect) so the shrunken list paints in one pass.
  const [prevLen, setPrevLen] = useState(ghost.length);
  if (prevLen !== ghost.length) {
    setPrevLen(ghost.length);
    setVisible(ZONE2_INITIAL);
  }

  // Progressive enhancement: without IntersectionObserver (jsdom, very old
  // browsers) the list renders in full — no toggle, no dead end.
  const hasObserver = typeof IntersectionObserver !== "undefined";

  // Infinite scroll: expand by a page whenever the sentinel enters viewport.
  useEffect(() => {
    if (!hasObserver) return;
    const el = sentinelRef.current;
    if (!el || visible >= ghost.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => Math.min(v + ZONE2_INITIAL, ghost.length));
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasObserver, visible, ghost.length]);

  if (ghost.length === 0) return null;

  const shown = hasObserver ? ghost.slice(0, visible) : ghost;

  return (
    <div id="zone2-rows">
      {shown.map((g) => (
        <GhostRow
          key={g.slug}
          station={g}
          isActive={g.slug === activeSlug}
          onTuneIn={() => onTuneGhost(g)}
        />
      ))}
      {/* Sentinel — triggers the next page load when scrolled into view. */}
      {hasObserver && visible < ghost.length && (
        <div ref={sentinelRef} className="zone2-sentinel" aria-hidden="true" />
      )}
    </div>
  );
}
