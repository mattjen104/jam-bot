/**
 * CompactDial — a compact, non-scrolling 5-row dial feed for the SplitHome.
 *
 * Slices `sortedRows` by offset and renders each row using the existing
 * FrontDoorRow infrastructure. No filter bar, no skeleton, no infinite scroll.
 *
 * Each row carries a subtle skip toggle (checkbox icon). Checked = included
 * in scan (default). Unchecked = skipped stations are pushed to the last scan
 * page and excluded from Scan all / page scan.
 */

import type { DialLaneRow } from "./dial/DialFeedLane";
import type { StationPresence } from "../hooks/useStationPresence";
import { FrontDoorRow } from "./dial/FrontDoorRow";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import { CompactPlayButton } from "./CompactPlayButton";

const COMPACT_DIAL_SIZE = 5;

export interface CompactDialProps {
  rows: DialLaneRow[];
  offset: number;
  /**
   * Raw index into `rows` of the station currently being sampled by the
   * homepage scan remote (null when no scan is active). Rows outside the
   * visible window are simply not highlighted.
   */
  samplingRowIdx?: number | null;
  activeSlug: string | null;
  playerStatus: PlayerStatus;
  presenceMap: Map<number, StationPresence>;
  onTuneIn: (row: DialLaneRow) => void;
  onPlay: (row: DialLaneRow) => void;
  /** Set of station slugs the listener has opted out of scanning. */
  skipped?: ReadonlySet<string>;
  /** Toggle skip state for a station slug. */
  onToggleSkip?: (slug: string) => void;
}

export function CompactDial({
  rows,
  offset,
  samplingRowIdx = null,
  activeSlug,
  playerStatus,
  presenceMap,
  onTuneIn,
  onPlay,
  skipped,
  onToggleSkip,
}: CompactDialProps) {
  const slice = rows.slice(offset, offset + COMPACT_DIAL_SIZE);

  if (rows.length === 0) {
    return (
      <div className="compact-dial compact-dial--empty">
        <p className="compact-dial__empty-msg">No stations on air right now.</p>
      </div>
    );
  }

  return (
    <div className="compact-dial">
      {slice.map((row, i) => {
        const isSampling = samplingRowIdx != null && samplingRowIdx === offset + i;
        const slug = row.ds.station.slug;
        const isSkipped = skipped?.has(slug) ?? false;
        return (
        <div
          key={slug}
          className={`compact-dial__row${isSampling ? " compact-dial__row--sampling" : ""}${isSkipped ? " compact-dial__row--skipped" : ""}`}
        >
          {resolvePlaybackSource(row.ds.station) != null && (
            <CompactPlayButton
              title={row.ds.station.name}
              isPlaying={
                slug === activeSlug &&
                playerStatus === "playing"
              }
              isLoading={
                slug === activeSlug &&
                playerStatus === "loading"
              }
              onClick={() => onPlay(row)}
              testId={`compact-dial-play-${slug}`}
            />
          )}
          <FrontDoorRow
            ds={row.ds}
            show={row.show}
            ov={0}
            scrubSlug={slug}
            isActive={slug === activeSlug}
            isSampling={isSampling}
            onTuneIn={() => onTuneIn(row)}
            presence={presenceMap.get(row.ds.station.id)}
            compactSentence
          />
          {onToggleSkip && (
            <button
              type="button"
              className={`compact-dial__skip-btn${isSkipped ? " compact-dial__skip-btn--skipped" : ""}`}
              aria-pressed={isSkipped}
              aria-label={isSkipped ? `Include ${row.ds.station.name} in scan` : `Skip ${row.ds.station.name} in scan`}
              title={isSkipped ? "Excluded from scan — click to include" : "Click to exclude from scan"}
              onClick={(e) => { e.stopPropagation(); onToggleSkip(slug); }}
            >
              {isSkipped ? "○" : "●"}
            </button>
          )}
        </div>
        );
      })}
      {/* Empty slots when fewer than 5 rows are available */}
      {Array.from({ length: Math.max(0, COMPACT_DIAL_SIZE - slice.length) }).map((_, i) => (
        <div key={`empty-${i}`} className="compact-dial__row compact-dial__row--empty" aria-hidden="true" />
      ))}
    </div>
  );
}
