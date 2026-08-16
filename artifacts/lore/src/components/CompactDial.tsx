/**
 * CompactDial — the SplitHome mini dial feed.
 *
 * Layout model
 * ─────────────
 * activeRows  — stations NOT in the skip set, sliced to the current page
 *               (up to 5). These fill the fixed five-slot grid at the top.
 * skippedRows — ALL skipped stations, appended below in a scrollable
 *               overflow region so the listener can still reach them without
 *               navigating to a different page.
 *
 * The scan remote's page count and candidate indices are derived from
 * activeRows only — skipped stations never participate in a scan.
 *
 * Checkbox: far-right trailing edge of each row.
 *   Checked  (active)  → filled key, normal opacity
 *   Unchecked (skipped) → open key, row dims, row lives in the below-fold
 *                         overflow region regardless of alphabetical position
 */

import type { DialLaneRow } from "./dial/DialFeedLane";
import type { StationPresence } from "../hooks/useStationPresence";
import { FrontDoorRow } from "./dial/FrontDoorRow";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import { CompactPlayButton } from "./CompactPlayButton";

const COMPACT_DIAL_SIZE = 5;

export interface CompactDialProps {
  /**
   * Active (non-skipped) rows for the current page — already sliced to at
   * most 5 by SplitHome before being passed in. Scan indices in
   * `samplingRowIdx` are positions in the FULL activeRows array (i.e. the
   * pre-sliced list), offset corrected by the caller.
   */
  activeRows: DialLaneRow[];
  /**
   * All skipped rows across the entire filtered list. Rendered below the
   * active grid in a scrollable overflow region.
   */
  skippedRows: DialLaneRow[];
  /**
   * Index into the current page's activeRows of the station being sampled.
   * Null when no scan is running.
   */
  samplingRowIdx?: number | null;
  activeSlug: string | null;
  playerStatus: PlayerStatus;
  presenceMap: Map<number, StationPresence>;
  onTuneIn: (row: DialLaneRow) => void;
  onPlay: (row: DialLaneRow) => void;
  /** Toggle skip state for a station slug (checks ↔ unchecks). */
  onToggleSkip?: (slug: string) => void;
}

function DialRow({
  row,
  isSampling,
  isSkipped,
  activeSlug,
  playerStatus,
  presenceMap,
  onTuneIn,
  onPlay,
  onToggleSkip,
}: {
  row: DialLaneRow;
  isSampling: boolean;
  isSkipped: boolean;
  activeSlug: string | null;
  playerStatus: PlayerStatus;
  presenceMap: Map<number, StationPresence>;
  onTuneIn: (row: DialLaneRow) => void;
  onPlay: (row: DialLaneRow) => void;
  onToggleSkip?: (slug: string) => void;
}) {
  const slug = row.ds.station.slug;
  return (
    <div
      className={[
        "compact-dial__row",
        isSampling ? "compact-dial__row--sampling" : "",
        isSkipped ? "compact-dial__row--skipped" : "",
      ].filter(Boolean).join(" ")}
    >
      {resolvePlaybackSource(row.ds.station) != null && (
        <CompactPlayButton
          title={row.ds.station.name}
          isPlaying={slug === activeSlug && playerStatus === "playing"}
          isLoading={slug === activeSlug && playerStatus === "loading"}
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
        <input
          type="checkbox"
          className="compact-dial__scan-checkbox"
          checked={!isSkipped}
          aria-label={
            isSkipped
              ? `Include ${row.ds.station.name} in scan`
              : `Skip ${row.ds.station.name} in scan`
          }
          title={
            isSkipped
              ? "Excluded from scan — check to include"
              : "Included in scan — uncheck to skip"
          }
          onChange={() => onToggleSkip(slug)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}

export function CompactDial({
  activeRows,
  skippedRows,
  samplingRowIdx = null,
  activeSlug,
  playerStatus,
  presenceMap,
  onTuneIn,
  onPlay,
  onToggleSkip,
}: CompactDialProps) {
  const totalRows = activeRows.length + skippedRows.length;

  if (totalRows === 0) {
    return (
      <div className="compact-dial compact-dial--empty">
        <p className="compact-dial__empty-msg">No stations to show right now.</p>
      </div>
    );
  }

  const emptySlots = Math.max(0, COMPACT_DIAL_SIZE - activeRows.length);

  return (
    <div className="compact-dial">
      {/* ── Active rows: fixed 5-slot grid ─────────────────────────────── */}
      {activeRows.map((row, i) => (
        <DialRow
          key={row.ds.station.slug}
          row={row}
          isSampling={samplingRowIdx === i}
          isSkipped={false}
          activeSlug={activeSlug}
          playerStatus={playerStatus}
          presenceMap={presenceMap}
          onTuneIn={onTuneIn}
          onPlay={onPlay}
          onToggleSkip={onToggleSkip}
        />
      ))}
      {/* Empty filler slots so the grid always spans 5 rows */}
      {Array.from({ length: emptySlots }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="compact-dial__row compact-dial__row--empty"
          aria-hidden="true"
        />
      ))}
      {/* ── Skipped rows: scrollable overflow below the fold ────────────── */}
      {skippedRows.length > 0 && (
        <div className="compact-dial__skipped-region" aria-label="Excluded from scan">
          {skippedRows.map((row) => (
            <DialRow
              key={row.ds.station.slug}
              row={row}
              isSampling={false}
              isSkipped={true}
              activeSlug={activeSlug}
              playerStatus={playerStatus}
              presenceMap={presenceMap}
              onTuneIn={onTuneIn}
              onPlay={onPlay}
              onToggleSkip={onToggleSkip}
            />
          ))}
        </div>
      )}
    </div>
  );
}
