/**
 * CompactDial — the SplitHome mini dial feed.
 *
 * Layout model
 * ─────────────
 * activeRows  — stations NOT in the skip set, sliced to the current page
 *               (5 normal / 10 compact / 15 micro). These fill the dial band.
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
import type { DialDisplayMode } from "../hooks/useDialData";
import { FrontDoorRow } from "./dial/FrontDoorRow";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import { CompactPlayButton } from "./CompactPlayButton";
import { CompactDialRemote } from "./CompactDialRemote";
import { MicroDialRemote } from "./MicroDialRemote";
import { type CrossingScope, DEFAULT_CROSSING_SCOPE, hasAnyCrossing } from "../lib/crossingScope";
import type { DialDensity } from "../lib/dialDensityState";
import type { LastSetSummary } from "../lib/latestSet";

const COMPACT_DIAL_SIZE = 5;
/** Rows per page at the "compact" (name-only remote) density. */
const COMPACT_REMOTE_SIZE = 10;

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
  /** Active crossing scope — drives the per-row ⬤ dot meaning. */
  crossingScope?: CrossingScope;
  /** When true (crossings off), no ⬤ dots render. */
  suppressCrossings?: boolean;
  displayMode?: DialDisplayMode;
  seedsLower?: Set<string>;
  onAddArtist?: (name: string) => void;
  /**
   * Display density (default "normal"). "compact" renders name-only remote
   * rows (10 per page); "micro" renders the page as a numbered keypad (15
   * per page). Remote-control densities never expand a row.
   */
  density?: DialDensity;
  /**
   * 1-based ordinal of activeRows[0] within the FULL active list (i.e. the
   * caller's scan offset + 1), so remote rows/keys show their position across
   * the whole list rather than within the visible page. Default 1.
   */
  firstOrdinal?: number;
  /** Opens the station's last-set scanner (normal-density rows only). */
  onOpenLastSet?: (row: DialLaneRow) => void;
  /**
   * Latest-completed-set summary per station slug — undefined while loading,
   * null when the station has no completed set (affordance hidden).
   */
  lastSetSummaries?: ReadonlyMap<string, LastSetSummary | null>;
  /** Stations still playing whatever the listener's last scan sampled —
   *  drives the "unchanged since your last scan" cue on rows and keys. */
  unchangedSlugs?: ReadonlySet<string>;
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
  crossingScope = DEFAULT_CROSSING_SCOPE,
  suppressCrossings = false,
  displayMode,
  seedsLower,
  onAddArtist,
  onOpenLastSet,
  lastSetSummaries,
  unchangedSlugs,
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
  crossingScope?: CrossingScope;
  suppressCrossings?: boolean;
  displayMode?: DialDisplayMode;
  seedsLower?: Set<string>;
  onAddArtist?: (name: string) => void;
  onOpenLastSet?: (row: DialLaneRow) => void;
  lastSetSummaries?: ReadonlyMap<string, LastSetSummary | null>;
  unchangedSlugs?: ReadonlySet<string>;
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
        displayMode={displayMode}
        seedsLower={seedsLower}
        onAddArtist={onAddArtist}
        suppressCrossings={suppressCrossings}
        crossingScope={crossingScope}
        hasCrossing={!suppressCrossings && hasAnyCrossing(row.ds, crossingScope)}
        onOpenLastSet={onOpenLastSet ? () => onOpenLastSet(row) : undefined}
        lastSetSummary={lastSetSummaries?.get(slug)}
        unchangedSinceScan={unchangedSlugs?.has(slug) === true}
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
  crossingScope = DEFAULT_CROSSING_SCOPE,
  suppressCrossings = false,
  displayMode,
  seedsLower,
  onAddArtist,
  density = "normal",
  firstOrdinal = 1,
  onOpenLastSet,
  lastSetSummaries,
  unchangedSlugs,
}: CompactDialProps) {
  const totalRows = activeRows.length + skippedRows.length;

  if (totalRows === 0) {
    return (
      <div className="compact-dial compact-dial--empty">
        <p className="compact-dial__empty-msg">No stations to show right now.</p>
      </div>
    );
  }

  // ── Micro density: the current 15-station page as a numbered keypad.
  //    Skipped rows and track detail stay on the normal density — one tap
  //    on the remote's density key brings them back. ─────────────────────
  if (density === "micro") {
    return (
      <div className="compact-dial compact-dial--micro">
        <MicroDialRemote
          rows={activeRows}
          firstOrdinal={firstOrdinal}
          samplingRowIdx={samplingRowIdx}
          activeSlug={activeSlug}
          onTuneIn={onTuneIn}
          unchangedSlugs={unchangedSlugs}
        />
      </div>
    );
  }

  // ── Compact density: name-only remote rows, ten to a page. ────────────
  if (density === "compact") {
    const emptyRemoteSlots = Math.max(0, COMPACT_REMOTE_SIZE - activeRows.length);
    return (
      <div className="compact-dial compact-dial--compact">
        {activeRows.map((row, i) => (
          <CompactDialRemote
            key={row.ds.station.slug}
            row={row}
            ordinal={firstOrdinal + i}
            isSampling={samplingRowIdx === i}
            isActive={row.ds.station.slug === activeSlug}
            onTuneIn={onTuneIn}
            unchanged={unchangedSlugs?.has(row.ds.station.slug) === true}
          />
        ))}
        {/* Empty filler slots so the grid always spans 10 rows */}
        {Array.from({ length: emptyRemoteSlots }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="compact-dial__remote-row compact-dial__remote-row--empty"
            aria-hidden="true"
          />
        ))}
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
          crossingScope={crossingScope}
          suppressCrossings={suppressCrossings}
          displayMode={displayMode}
          seedsLower={seedsLower}
          onAddArtist={onAddArtist}
          onOpenLastSet={onOpenLastSet}
          lastSetSummaries={lastSetSummaries}
          unchangedSlugs={unchangedSlugs}
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
              crossingScope={crossingScope}
              suppressCrossings={suppressCrossings}
              displayMode={displayMode}
              seedsLower={seedsLower}
              onAddArtist={onAddArtist}
            />
          ))}
        </div>
      )}
    </div>
  );
}
