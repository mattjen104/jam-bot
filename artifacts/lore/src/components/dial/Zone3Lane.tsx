/**
 * Zone3Lane — the Dial's Zone 3 lane: also-on-air stations without a current
 * crossing reason, split into two bands:
 *
 *   djBand   — r=5 rows (attributed show on air, no crossing yet). Always
 *              fully shown, "DJs on air" sub-label.
 *   restBand — r=0/6/7 rows (unattributed / dark). Capped at ZONE3_VISIBLE
 *              with an expand toggle; pinned stations float above non-pinned.
 *
 * Band order follows the sort triangle: ▲ renders DJ band then rest band;
 * ▼ renders rest band (rarest-first) then DJ band above them.
 *
 * Extracted from DialView.tsx; all sorting and expand-state bookkeeping stays
 * in DialView and arrives via typed props.
 */
import { type ReactNode } from "react";
import { type DialDisplayMode } from "../../hooks/useDialData";
import { type StationPresence } from "../../hooks/useStationPresence";
import { FrontDoorRow, ZoneLabel } from "./FrontDoorRow";
import { type DialLaneRow } from "./Zone1Lane";

/** Cap on rest-band rows shown before the "See all" expand affordance. */
export const ZONE3_VISIBLE = 3;

export interface Zone3LaneProps {
  /** r=5 band — attributed DJs on air, sorted by DialView. */
  djBand: DialLaneRow[];
  /** r=0/6/7 band — unattributed rows, sorted by DialView. */
  restBand: DialLaneRow[];
  /** Sort direction: ▲ (true) DJ band leads; ▼ (false) rest band leads. */
  popSortDesc: boolean;
  expanded: boolean;
  activeSlug: string | null;
  displayMode: DialDisplayMode;
  presenceMap: Map<number, StationPresence>;
  artworkUrl: string | null;
  /** Popular-crossing sentence for a station slug, or null when none. */
  popLineFor: (slug: string) => ReactNode | null;
  /** Per-row overlap figure (picker overlap for DJ band, lifetime for rest). */
  ovFor: (row: DialLaneRow, band: "dj" | "rest") => number;
  onTuneIn: (row: DialLaneRow) => void;
  /** "See all N" / "See less" toggle — DialView owns the anchor bookkeeping. */
  onToggleExpanded: () => void;
  /** Inline "See less" collapse (label row) — plain collapse, no anchor. */
  onCollapse: () => void;
}

export function Zone3Lane({
  djBand,
  restBand,
  popSortDesc,
  expanded,
  activeSlug,
  displayMode,
  presenceMap,
  artworkUrl,
  popLineFor,
  ovFor,
  onTuneIn,
  onToggleExpanded,
  onCollapse,
}: Zone3LaneProps) {
  if (djBand.length === 0 && restBand.length === 0) return null;

  const rowJsx = (row: DialLaneRow, band: "dj" | "rest") => (
    <FrontDoorRow
      key={row.ds.station.slug}
      ds={row.ds}
      show={row.show}
      ov={ovFor(row, band)}
      scrubSlug={row.ds.station.slug}
      isActive={row.ds.station.slug === activeSlug}
      isSampling={false}
      onTuneIn={() => onTuneIn(row)}
      displayMode={displayMode}
      presence={presenceMap.get(row.ds.station.id)}
      artworkUrl={artworkUrl}
      popLine={popLineFor(row.ds.station.slug)}
    />
  );

  const djBandJsx = djBand.length > 0 && (
    <>
      <ZoneLabel label="DJs on air" accent="picker" />
      {djBand.map((row) => rowJsx(row, "dj"))}
    </>
  );
  const restBandJsx = restBand.length > 0 && (
    <>
      <div id="zone3-rows">
        {restBand.slice(0, expanded ? restBand.length : ZONE3_VISIBLE).map((row) => rowJsx(row, "rest"))}
      </div>
      {restBand.length > ZONE3_VISIBLE && (
        <button
          className="dial-show-more"
          aria-expanded={expanded}
          aria-controls="zone3-rows"
          onClick={onToggleExpanded}
        >
          {expanded ? "See less" : `See all ${restBand.length}`}
        </button>
      )}
    </>
  );

  return (
    <>
      <div className="fdzone-lbl-row">
        {expanded && restBand.length > ZONE3_VISIBLE && (
          <button
            className="dial-show-more-inline"
            aria-expanded={true}
            aria-controls="zone3-rows"
            onClick={onCollapse}
          >
            See less
          </button>
        )}
      </div>
      {popSortDesc ? <>{djBandJsx}{restBandJsx}</> : <>{restBandJsx}{djBandJsx}</>}
    </>
  );
}
