import { Radio } from "lucide-react";
import type { DialLaneRow } from "./DialFeedLane";
import { StationMark } from "../StationMark";

const EXPLORE_ROOM_LIMIT = 8;

interface ExploreRoomGridProps {
  rows: DialLaneRow[];
  activeSlug: string | null;
  onTuneIn: (row: DialLaneRow) => void;
  onOpenScan: () => void;
  limit?: number;
}

/**
 * The station-destination grammar for Explore.
 *
 * Covers lead in the music rails above this section. Here the station remains
 * the primary identity because the action enters a live broadcast.
 */
export function ExploreRoomGrid({
  rows,
  activeSlug,
  onTuneIn,
  onOpenScan,
  limit = EXPLORE_ROOM_LIMIT,
}: ExploreRoomGridProps) {
  const visibleRows = rows.slice(0, limit);

  return (
    <>
      <div className="explore-station-grid" data-testid="explore-station-grid">
        {visibleRows.map((row) => {
          const { station, liveTrack } = row.ds;
          const track = liveTrack ?? row.show?.currentTrack ?? null;
          const isActive = activeSlug === station.slug;
          const hasPersonalMatch = Boolean(track?.isLibraryHit || track?.isArtistHit);
          const showName = row.show?.showName?.trim();

          return (
            <article
              key={station.slug}
              className={`explore-station-card${isActive ? " explore-station-card--active" : ""}`}
            >
              <div className="explore-station-card__identity">
                <StationMark
                  name={station.name}
                  logoUrl={station.logoUrl}
                  variant="cube"
                  className="explore-station-card__mark"
                />
                <div className="explore-station-card__station-copy">
                  <span className="explore-station-card__kicker">
                    {isActive ? "Listening now" : hasPersonalMatch ? "Your music is here" : "Live station"}
                  </span>
                  <h3 className="explore-station-card__station">{station.name}</h3>
                </div>
              </div>

              <div className="explore-station-card__now">
                <strong>{track?.artist?.trim() || showName || "Live broadcast"}</strong>
                <span>{track?.title?.trim() || (showName && track?.artist?.trim() ? showName : "On air now")}</span>
              </div>

              <div className="explore-station-card__footer">
                <span>{showName || (hasPersonalMatch ? "Crossing now" : "Broadcasting live")}</span>
                <button
                  type="button"
                  className="explore-station-card__tune"
                  aria-pressed={isActive}
                  aria-label={isActive ? `${station.name} is playing` : `Tune in to ${station.name}`}
                  disabled={isActive}
                  onClick={() => onTuneIn(row)}
                >
                  <Radio aria-hidden="true" size={13} />
                  {isActive ? "Playing" : "Tune in"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {rows.length > visibleRows.length && (
        <button
          type="button"
          className="explore-station-grid__all"
          onClick={onOpenScan}
        >
          Scan all {rows.length} live stations
        </button>
      )}
    </>
  );
}