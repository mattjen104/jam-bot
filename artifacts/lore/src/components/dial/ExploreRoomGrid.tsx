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
      <div className="explore-room-grid" data-testid="explore-room-grid">
        {visibleRows.map((row) => {
          const { station, liveTrack } = row.ds;
          const track = liveTrack ?? row.show?.currentTrack ?? null;
          const isActive = activeSlug === station.slug;
          const hasPersonalMatch = Boolean(track?.isLibraryHit || track?.isArtistHit);
          const showName = row.show?.showName?.trim();

          return (
            <article
              key={station.slug}
              className={`explore-room-card${isActive ? " explore-room-card--active" : ""}`}
            >
              <div className="explore-room-card__identity">
                <StationMark
                  name={station.name}
                  logoUrl={station.logoUrl}
                  variant="cube"
                  className="explore-room-card__mark"
                />
                <div className="explore-room-card__station-copy">
                  <span className="explore-room-card__kicker">
                    {isActive ? "Listening now" : hasPersonalMatch ? "Your music is here" : "Live room"}
                  </span>
                  <h3 className="explore-room-card__station">{station.name}</h3>
                </div>
              </div>

              <div className="explore-room-card__now">
                <strong>{track?.artist?.trim() || showName || "Live broadcast"}</strong>
                <span>{track?.title?.trim() || (showName && track?.artist?.trim() ? showName : "On air now")}</span>
              </div>

              <div className="explore-room-card__footer">
                <span>{showName || (hasPersonalMatch ? "Crossing now" : "Broadcasting live")}</span>
                <button
                  type="button"
                  className="explore-room-card__tune"
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
          className="explore-room-grid__all"
          onClick={onOpenScan}
        >
          Scan all {rows.length} live rooms
        </button>
      )}
    </>
  );
}