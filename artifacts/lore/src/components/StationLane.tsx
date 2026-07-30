/**
 * StationLane — one horizontal scrollable lane in the Dial view.
 *
 * On mount the row scrolls so the live (or most-recent) block's left edge
 * sits just left of the `--now-x` needle.
 */
import { useEffect, useRef } from "react";
import type { DialStation, DialShow } from "../hooks/useDialData";

// CSS layout constants — must match :root in index.css
const NEEDLE_X = 270; // px — position of the NOW needle in each viewport
const LIVE_TARGET_LEFT = NEEDLE_X - 74; // 74 = ~half a block width
const BLK_W = 148;
const BLK_GAP = 6;
const BLK_STRIDE = BLK_W + BLK_GAP;
const LANE_PAD = 15;

function fmtHM(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${m}${ampm}`;
}

function blockClasses(show: DialShow): string {
  const parts = ["dial-blk"];
  parts.push(`dial-blk--${show.state}`);
  if (show.state !== "future") {
    if (show.isPickerShow) parts.push("dial-blk--picker");
    else if (show.crossings > 0) parts.push("dial-blk--warm");
  }
  return parts.join(" ");
}

interface ShowBlockProps {
  show: DialShow;
  onClick: () => void;
}

function ShowBlock({ show, onClick }: ShowBlockProps) {
  const { state, showName, djName, startedAt, endedAt, crossings, topArtists, currentTrack, isPickerShow } = show;
  const isLive = state === "live";
  const isPast = state === "past";

  const startFmt = fmtHM(startedAt);
  const endFmt = isLive ? "now" : fmtHM(endedAt);

  return (
    <button className={blockClasses(show)} onClick={onClick} type="button">
      {/* kind label */}
      <div className="dial-blk__kind">
        {isLive && <span className="dial-blk__livepip">●</span>}
        {isLive && " Live now"}
        {isPast && isPickerShow && <span className="dial-blk__pickerbadge">◆ Selector</span>}
        {isPast && !isPickerShow && crossings > 0 && `Past · ${crossings} yours`}
        {isPast && !isPickerShow && crossings === 0 && "Past"}
        {state === "future" && "Scheduled"}
      </div>

      {/* show + dj */}
      <div className="dial-blk__show">{showName}</div>
      {djName && <div className="dial-blk__dj">{djName}</div>}

      {/* current track on live block */}
      {isLive && currentTrack && (
        <>
          <div className="dial-blk__now">{currentTrack.title}</div>
          <div className="dial-blk__now-ar">{currentTrack.artist}</div>
        </>
      )}

      {/* your artists */}
      {state !== "future" && (
        <div className={`dial-blk__artists${topArtists.length === 0 ? " dial-blk__artists--zero" : ""}`}>
          {topArtists.length > 0 ? topArtists.join(" · ") : "no crossings"}
        </div>
      )}

      {/* footer */}
      <div className="dial-blk__foot">
        <span className="dial-blk__time">{startFmt}–{endFmt}</span>
        {isPast && <span className="dial-blk__ride">▶ Ride set</span>}
      </div>
    </button>
  );
}

interface StationLaneProps {
  dialStation: DialStation;
  isPinned: boolean;
  onStationClick: () => void;
  onShowClick: (show: DialShow) => void;
  onPinToggle: () => void;
  onPlay: () => void;
  isActive: boolean;
}

export function StationLane({ dialStation, isPinned, onStationClick, onShowClick, onPinToggle, onPlay, isActive }: StationLaneProps) {
  const { station, isLive, shows, crossings } = dialStation;
  const rowRef = useRef<HTMLDivElement>(null);

  // Scroll so the live (or most-recent) block's left edge lands at LIVE_TARGET_LEFT
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const liveIdx = shows.findIndex((s) => s.state === "live");
    const refIdx = liveIdx >= 0 ? liveIdx : shows.filter((s) => s.state === "past").length - 1;
    if (refIdx < 0) return;
    const blockContentLeft = LANE_PAD + refIdx * BLK_STRIDE;
    row.scrollLeft = blockContentLeft - LIVE_TARGET_LEFT;
  }, [shows]);

  return (
    <div className="dial-lane">
      {/* lane header */}
      <div className="dial-lane__hd" onClick={onStationClick} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onStationClick()}>
        {isLive && <span className="dial-lane__dot" aria-hidden="true" />}
        <span className={`dial-lane__name${isActive ? " dial-lane__name--tuned" : ""}`}>
          {station.name}
        </span>
        <span className={`dial-lane__cross${crossings === 0 ? " dial-lane__cross--zero" : ""}`}>
          {crossings > 0 ? `◆ ${crossings}` : "—"}
        </span>
        <button
          type="button"
          className={`dial-lane__play${isActive ? " dial-lane__play--on" : ""}`}
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          aria-label={isActive ? `Stop ${station.name}` : `Play ${station.name}`}
        >
          {isActive ? "■" : "▶"}
        </button>
      </div>

      {/* block row with NOW needle */}
      <div className="dial-row-wrap">
        {isLive && (
          <div className="dial-needle" style={{ left: NEEDLE_X }}>
            <span className="dial-needle__label">NOW</span>
          </div>
        )}
        <div className="dial-block-row" ref={rowRef}>
          {shows.map((show, i) => (
            <ShowBlock key={show.runId ?? i} show={show} onClick={() => onShowClick(show)} />
          ))}
          {shows.length === 0 && (
            <div className="dial-blk dial-blk--past" style={{ opacity: 0.3 }}>
              <div className="dial-blk__show" style={{ fontSize: 11 }}>No data today</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
