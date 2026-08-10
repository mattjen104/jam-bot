/**
 * Zone1Lane — the Dial's Zone 1 lane: live stations WITH a crossing reason
 * (attribution rungs 1–4 plus 24h station-level evidence, rungs 6/7).
 *
 * Pure presentational extraction from DialView.tsx: renders one FrontDoorRow
 * per display row inside the #zone1-rows container. All state (sort order,
 * active station, sampling cursor, popular-crossing map, seeds) stays in
 * DialView and arrives via typed props.
 */
import { type PopularCrossingArtist } from "../../lib/meHooks";
import { type DialStation, type DialShow, type DialDisplayMode } from "../../hooks/useDialData";
import { type StationPresence } from "../../hooks/useStationPresence";
import { FrontDoorRow } from "./FrontDoorRow";

/** The shape shared by all sorted dial rows (Zone 1 and Zone 3 bands). */
export interface DialLaneRow {
  ds: DialStation;
  show: DialShow | null;
  effectiveDjName: string | null;
}

export interface Zone1LaneProps {
  /** Rows already in display order (▲ ladder order / ▼ inverted). */
  rows: DialLaneRow[];
  /** Slug of the currently playing station, if any. */
  activeSlug: string | null;
  /** Slug of the station currently being sampled by the front-door scan. */
  samplingSlug: string | null;
  displayMode: DialDisplayMode;
  presenceMap: Map<number, StationPresence>;
  /** Popular-crossing setlists keyed by station slug. */
  popMap: Map<string, PopularCrossingArtist[]>;
  seedsLower: Set<string>;
  /** Per-row overlap figure (picker overlap or lifetime crossings). */
  ovFor: (row: DialLaneRow) => number;
  onAddArtist: (name: string) => void;
  onTuneIn: (row: DialLaneRow) => void;
  onSetExpand: (row: DialLaneRow) => void;
  onOpenWorkspace: (row: DialLaneRow) => void;
}

export function Zone1Lane({
  rows,
  activeSlug,
  samplingSlug,
  displayMode,
  presenceMap,
  popMap,
  seedsLower,
  ovFor,
  onAddArtist,
  onTuneIn,
  onSetExpand,
  onOpenWorkspace,
}: Zone1LaneProps) {
  return (
    <div id="zone1-rows">
      {rows.map((row) => (
        <div key={row.ds.station.slug}>
          <FrontDoorRow
            ds={row.ds}
            show={row.show}
            ov={ovFor(row)}
            scrubSlug={row.ds.station.slug}
            isActive={row.ds.station.slug === activeSlug}
            isSampling={samplingSlug != null && samplingSlug === row.ds.station.slug}
            onTuneIn={() => onTuneIn(row)}
            displayMode={displayMode}
            presence={presenceMap.get(row.ds.station.id)}
            setArtists={popMap.get(row.ds.station.slug) ?? null}
            seedsLower={seedsLower}
            onAddArtist={onAddArtist}
            onSetExpand={() => onSetExpand(row)}
            onOpenWorkspace={() => onOpenWorkspace(row)}
          />
        </div>
      ))}
    </div>
  );
}
