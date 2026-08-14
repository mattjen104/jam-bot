/**
 * CompactDial — a compact, non-scrolling 5-row dial feed for the SplitHome.
 *
 * Slices `sortedRows` by offset and renders each row using the existing
 * FrontDoorRow infrastructure. No filter bar, no skeleton, no infinite scroll.
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
  activeSlug: string | null;
  playerStatus: PlayerStatus;
  presenceMap: Map<number, StationPresence>;
  onTuneIn: (row: DialLaneRow) => void;
  onPlay: (row: DialLaneRow) => void;
}

export function CompactDial({
  rows,
  offset,
  activeSlug,
  playerStatus,
  presenceMap,
  onTuneIn,
  onPlay,
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
      {slice.map((row) => (
        <div
          key={row.ds.station.slug}
          className="compact-dial__row"
        >
          {resolvePlaybackSource(row.ds.station) != null && (
            <CompactPlayButton
              title={row.ds.station.name}
              isPlaying={
                row.ds.station.slug === activeSlug &&
                playerStatus === "playing"
              }
              isLoading={
                row.ds.station.slug === activeSlug &&
                playerStatus === "loading"
              }
              onClick={() => onPlay(row)}
              testId={`compact-dial-play-${row.ds.station.slug}`}
            />
          )}
          <FrontDoorRow
            ds={row.ds}
            show={row.show}
            ov={0}
            scrubSlug={row.ds.station.slug}
            isActive={row.ds.station.slug === activeSlug}
            isSampling={false}
            onTuneIn={() => onTuneIn(row)}
            presence={presenceMap.get(row.ds.station.id)}
            compactSentence
          />
        </div>
      ))}
      {/* Empty slots when fewer than 5 rows are available */}
      {Array.from({ length: Math.max(0, COMPACT_DIAL_SIZE - slice.length) }).map((_, i) => (
        <div key={`empty-${i}`} className="compact-dial__row compact-dial__row--empty" aria-hidden="true" />
      ))}
    </div>
  );
}
