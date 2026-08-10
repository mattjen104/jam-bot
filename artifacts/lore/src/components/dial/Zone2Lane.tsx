/**
 * Zone2Lane — the Dial's Zone 2 lane: ghost stations ("Missed while you were
 * away") that played the listener's artists but aren't currently on air in
 * Zone 1/3.
 *
 * Extracted from DialView.tsx. The same lane renders in live mode and past
 * mode with different container ids (`idSuffix`) so the two collapse buttons
 * keep distinct aria-controls targets. All expand/collapse state and anchor
 * bookkeeping stays in DialView.
 */
import { useLocation } from "wouter";
import { type GhostStation } from "../../lib/meHooks";
import { agoLabel } from "./FrontDoorRow";

/** Cap on ghost rows shown before the "See all" expand affordance. */
export const ZONE2_VISIBLE = 3;

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
  expanded: boolean;
  /** Suffix appended to the rows-container id (past mode uses "-day"). */
  idSuffix?: string;
  activeSlug: string | null;
  onTuneGhost: (g: GhostStation) => void;
  /** "See all N" / "See less" toggle — DialView owns the anchor bookkeeping. */
  onToggleExpanded: () => void;
  /** Inline "See less" collapse (label row) — plain collapse, no anchor. */
  onCollapse: () => void;
}

export function Zone2Lane({
  ghost,
  expanded,
  idSuffix = "",
  activeSlug,
  onTuneGhost,
  onToggleExpanded,
  onCollapse,
}: Zone2LaneProps) {
  if (ghost.length === 0) return null;
  const rowsId = `zone2-rows${idSuffix}`;
  return (
    <>
      <div className="fdzone-lbl-row">
        {expanded && ghost.length > ZONE2_VISIBLE && (
          <button
            className="dial-show-more-inline"
            aria-expanded={true}
            aria-controls={rowsId}
            onClick={onCollapse}
          >
            See less
          </button>
        )}
      </div>
      <>
        <div id={rowsId}>
          {ghost.slice(0, expanded ? ghost.length : ZONE2_VISIBLE).map((g) => (
            <GhostRow
              key={g.slug}
              station={g}
              isActive={g.slug === activeSlug}
              onTuneIn={() => onTuneGhost(g)}
            />
          ))}
        </div>
        {ghost.length > ZONE2_VISIBLE && (
          <button
            className="dial-show-more"
            aria-expanded={expanded}
            aria-controls={rowsId}
            onClick={onToggleExpanded}
          >
            {expanded ? "See less" : `See all ${ghost.length}`}
          </button>
        )}
      </>
    </>
  );
}
