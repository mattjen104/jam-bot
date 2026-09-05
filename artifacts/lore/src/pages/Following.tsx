import { Link } from "wouter";
import { Play, Radio } from "lucide-react";
import { useDialData } from "../hooks/useDialData";
import { useStationFollows } from "../hooks/useStationFollows";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { usePlayer } from "../player/PlayerProvider";
import { PERSONAL_STATION_SLUG_PREFIX } from "../lib/addedStations";

export function rankFollowedStations<T extends {
  isLive: boolean;
  station: { name: string };
}>(stations: T[]): T[] {
  return [...stations].sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return a.station.name.localeCompare(b.station.name);
  });
}

/** A listener-owned view: quiet stations remain here even without a show/track. */
export default function Following() {
  const { stations, isCoreLoading } = useDialData("personal", {
    includeAllStations: true,
    crossingsEnabled: false,
    deferEnrichment: true,
  });
  const { followedSlugs, isFollowing, toggleFollow } = useStationFollows();
  const { radio } = usePlayer();
  const followed = rankFollowedStations(
    stations.filter(({ station }) => isFollowing(station.slug)),
  );
  // A deleted/unavailable station can remain in storage, but cannot be
  // truthfully rendered as a station card until it returns to the dial.
  const unavailableCount = followedSlugs.size - followed.length;

  return (
    <main className="explore-page" data-testid="following-page">
      <header className="explore-header">
        <div>
          <p className="explore-header__eyebrow">Now</p>
          <h1>Following</h1>
          <p>Stations followed on this device. Live details are optional — every available followed station stays here.</p>
        </div>
        <Link className="explore-card__link" href="/">Back to Now</Link>
      </header>
      {isCoreLoading ? <p className="explore-state">Loading your followed stations…</p> : followed.length ? (
        <div className="explore-grid" aria-label="Followed stations">
          {followed.map(({ station, liveTrack, shows }) => {
            const current = radio.station?.slug === station.slug;
            const playable = Boolean(resolvePlaybackSource(station));
            const track = liveTrack ?? shows.find((show) => show.state === "live")?.currentTrack;
            return (
              <article key={station.slug} className={`explore-card${current ? " explore-card--active" : ""}`}>
                <header className="explore-card__header">
                  <Radio size={18} aria-hidden="true" />
                  <div className="explore-card__identity">
                    {station.slug.startsWith(PERSONAL_STATION_SLUG_PREFIX)
                      ? <span>{station.name}</span>
                      : <Link href={`/archive/stations/${station.slug}`}>{station.name}</Link>}
                    <span>{[station.city, station.region, station.country].filter(Boolean).join(", ") || "Location unavailable"}</span>
                  </div>
                </header>
                <div className="explore-card__body">
                  <span className="explore-card__kicker">{track ? "On air now" : "Station follow"}</span>
                  <p>{track ? `${track.artist} · ${track.title}` : "Live metadata unavailable — this station is still followed."}</p>
                </div>
                <footer className="explore-card__footer">
                  <button type="button" className="explore-card__tune" disabled={!playable} onClick={() => playable && void radio.toggle(station)}>
                    <Play size={13} fill="currentColor" aria-hidden="true" />{current && radio.status === "playing" ? "Playing" : playable ? "Listen now" : "Stream unavailable"}
                  </button>
                  <button type="button" className="explore-card__link" onClick={() => toggleFollow(station.slug)} aria-pressed="true">
                    Unfollow
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="explore-state">
          <Radio size={24} aria-hidden="true" />
          <h2>No followed stations yet</h2>
          <p>Follow a station from Now, Explore, or its archive. Follows are saved only on this device.</p>
          <Link className="explore-card__link" href="/explore">Explore stations</Link>
        </div>
      )}
      {unavailableCount > 0 ? <p className="explore-notice">Some followed stations are temporarily unavailable and will return here when the dial can load them.</p> : null}
    </main>
  );
}