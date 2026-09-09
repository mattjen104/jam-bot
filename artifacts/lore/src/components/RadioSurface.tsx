import { useMemo } from "react";
import { usePlayer } from "../player/PlayerProvider";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { StationChangeCountdown } from "./StationChangeCountdown";
import type { DialStation } from "../hooks/useDialData";
import { Play } from "lucide-react";

const ROSTER_SLUGS = ["kcrw", "kexp", "wfmu", "worldwide-fm", "wxyc"];

export function RadioSurface({ 
  stations, 
  visibleSeeds, 
  hasSeeds,
  hasLibrary,
  showHeader = true,
}: {
  stations: DialStation[];
  visibleSeeds: string[];
  hasSeeds: boolean;
  hasLibrary: boolean;
  showHeader?: boolean;
}) {
  const { radio } = usePlayer();

  const allCrossings = useMemo(() => {
    return stations
      .filter(ds => ds.lifetimeCrossings + ds.lifetimeArtistCrossings > 0)
      .sort((a, b) => {
        const aTotal = a.lifetimeCrossings + a.lifetimeArtistCrossings;
        const bTotal = b.lifetimeCrossings + b.lifetimeArtistCrossings;
        return bTotal - aTotal;
      });
  }, [stations]);

  const hasData = hasSeeds || hasLibrary;
  const showCrossings = hasData && allCrossings.length > 0;

  const rosterStations = useMemo(() => {
    const excludedSlugs = showCrossings ? new Set(allCrossings.map(ds => ds.station.slug)) : new Set<string>();
    const mapped = ROSTER_SLUGS.map(slug => stations.find(s => s.station.slug === slug)).filter(Boolean) as DialStation[];
    return mapped.filter(ds => !excludedSlugs.has(ds.station.slug));
  }, [stations, showCrossings, allCrossings]);

  const localTime = new Date().toLocaleTimeString("en-US", { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '');

  const renderRow = (ds: DialStation, demoted: boolean) => {
    const track = ds.liveTrack ?? ds.shows.find(s => s.state === 'live')?.currentTrack;
    const isLive = ds.isLive && !!track && !track.resolving && (track.isLibraryHit || track.isArtistHit);
    
    // Gap handling
    const rawTitle = track?.title;
    const rawArtist = track?.artist;
    const title = rawTitle || "—";
    const artist = rawArtist || (rawTitle ? "Unknown" : "Now: unknown");

    const liveShow = ds.shows.find(s => s.state === 'live');
    const djNames = eligibleDjNames({
      name: liveShow?.showName ?? "",
      djName: liveShow?.djName ?? undefined,
      djNames: liveShow?.djNames
    }, {
      artist,
      title,
      showTitle: liveShow?.showName,
      stationName: ds.station.name
    });
    const bylineHuman = djNames.length === 1
      ? `Selected by ${djNames[0]}`
      : `${ds.station.name} †`;
    const bylineCite = [ds.station.name, ds.station.city].filter(Boolean).join(" · ");

    if (demoted) {
      const citeText = djNames.length > 0 ? djNames[0] : `${ds.station.name} †`;
      return (
        <div className="demo-radio__row demo-radio__row--compact" key={ds.station.slug}>
          <div className="demo-radio__cover demo-radio__cover--compact" aria-hidden="true" />
          <div className="demo-radio__body">
            <div className="demo-radio__compact-title">{ds.station.name} · {title}, {artist}</div>
            <div className="demo-radio__reason">{citeText} · no overlap yet</div>
          </div>
          <button className="demo-radio__play demo-radio__play--quiet" aria-label={`Listen to ${ds.station.name}`} onClick={() => radio.toggle(ds.station)}>
            <Play size={14} fill="currentColor" />
          </button>
        </div>
      );
    }

    const lifetimeTotal = ds.lifetimeCrossings + ds.lifetimeArtistCrossings;
    const reasonLine = ds.topArtistNamesLifetime.length > 0
      ? `Has played your artists ${lifetimeTotal} times · ${ds.topArtistNamesLifetime.length === 1 ? `mostly ${ds.topArtistNamesLifetime[0]}` : ds.topArtistNamesLifetime.slice(0,2).join(", ")}`
      : "";

    return (
      <div key={ds.station.slug} className="demo-radio__featured">
        <div className="demo-radio__row demo-radio__row--featured">
          <div className="demo-radio__cover" aria-hidden="true" />
          <div className="demo-radio__body">
            {isLive && <span className="demo-radio__pill">Playing {rawArtist} now</span>}
            <div className="demo-radio__title">{title}</div>
            <div className="demo-radio__artist">{artist}</div>
            <div className="demo-radio__byline">
              {bylineHuman} <span>· {bylineCite}</span>
            </div>
          </div>
          <button className="demo-radio__play" aria-label={`Listen to ${ds.station.name}`} onClick={() => radio.toggle(ds.station)}>
            <Play size={16} fill="currentColor" />
            {radio.station?.slug === ds.station.slug ? <StationChangeCountdown track={track} /> : null}
          </button>
        </div>
        {reasonLine && <div className="demo-radio__reason demo-radio__reason--featured">{reasonLine}</div>}
      </div>
    );
  };

  return (
    <section className="demo-radio" aria-label="Radio">
      {showHeader ? (
        <header className="demo-radio__header">
          <h1>Radio</h1>
          <time>{localTime}</time>
        </header>
      ) : null}

      <div className="demo-radio__section-label">
        <span>Plays your music</span>
        <span>{visibleSeeds.length} artists</span>
      </div>

      {showCrossings ? (
        allCrossings.map(ds => renderRow(ds, false))
      ) : (
        <div className="demo-radio__empty">
          <p>Keep a song, or add artists you love, and the stations that play your music will show up here.</p>
        </div>
      )}

      <div className="demo-radio__section-label demo-radio__section-label--secondary">
        <span>{showCrossings ? "Also on air" : "On air now"}</span>
      </div>

      {rosterStations.map(ds => renderRow(ds, showCrossings))}
      {rosterStations.length === 0 ? (
        <p className="demo-radio__unavailable">The editorial stations are temporarily unavailable.</p>
      ) : null}
    </section>
  );
}