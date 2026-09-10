import { useMemo, useState } from "react";
import { usePlayer } from "../player/PlayerProvider";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { StationChangeCountdown } from "./StationChangeCountdown";
import { StationMark } from "./StationMark";
import type { DialStation } from "../hooks/useDialData";
import { Play } from "lucide-react";
import { SetContextSheet } from "./SetContextSheet";
import { anchorKey, useSetContexts } from "../lib/setContexts";

const ROSTER_SLUGS = ["kcrw", "kexp", "wfmu", "worldwide-fm", "wxyc"];

export function RadioSurface({ 
  stations, 
  visibleSeeds, 
  hasSeeds,
  hasLibrary,
  showHeader = true,
  sort = "overlap",
  focusedArtist = null,
}: {
  stations: DialStation[];
  visibleSeeds: string[];
  hasSeeds: boolean;
  hasLibrary: boolean;
  showHeader?: boolean;
  sort?: "overlap" | "live" | "discovery" | "name";
  focusedArtist?: string | null;
}) {
  const { radio } = usePlayer();
  const [sheetAnchorId, setSheetAnchorId] = useState<number | null>(null);
  const [openingSetSlug, setOpeningSetSlug] = useState<string | null>(null);
  const sheetAnchors = useMemo(
    () => sheetAnchorId == null ? [] : [{ kind: "spin" as const, spinId: sheetAnchorId }],
    [sheetAnchorId],
  );
  const sheetContexts = useSetContexts(sheetAnchors);
  const sheetContext = sheetAnchorId == null
    ? null
    : sheetContexts.get(anchorKey({ kind: "spin", spinId: sheetAnchorId }));

  const openCurrentSet = async (stationSlug: string, title: string, artist: string, mbid?: string | null) => {
    setOpeningSetSlug(stationSlug);
    try {
      const response = await fetch(`/api/stations/${encodeURIComponent(stationSlug)}/recent-spins`);
      if (!response.ok) return;
      const data = await response.json() as {
        items?: Array<{ spins?: Array<{ spinId: number; title: string; artist: string }> }>;
      };
      const current = data.items?.[0]?.spins?.[0] as
        | { spinId: number; mbid?: string | null; title: string; artist: string }
        | undefined;
      const normalize = (value: string) => value.trim().toLocaleLowerCase();
      const sameTrack = current && (
        (mbid != null && current.mbid === mbid)
        || (normalize(current.title) === normalize(title) && normalize(current.artist) === normalize(artist))
      );
      if (!current || !sameTrack) return;
      setSheetAnchorId(current.spinId);
    } catch {
      // Keep the explanation non-destructive when current history is unavailable.
    } finally {
      setOpeningSetSlug(null);
    }
  };

  const allCrossings = useMemo(() => {
    const list = focusedArtist
      ? [...stations]
      : stations.filter(ds => ds.lifetimeCrossings + ds.lifetimeArtistCrossings > 0);
    if (sort === "name") {
      return list.sort((a, b) => a.station.name.localeCompare(b.station.name));
    }
    if (sort === "live") {
      return list.sort((a, b) =>
        Number(b.isLive) - Number(a.isLive)
        || (b.lifetimeCrossings + b.lifetimeArtistCrossings)
          - (a.lifetimeCrossings + a.lifetimeArtistCrossings),
      );
    }
    if (sort === "discovery") {
      return list.sort((a, b) =>
        (a.lifetimeCrossings + a.lifetimeArtistCrossings)
          - (b.lifetimeCrossings + b.lifetimeArtistCrossings),
      );
    }
    return list.sort((a, b) => {
      const aTotal = a.lifetimeCrossings + a.lifetimeArtistCrossings;
      const bTotal = b.lifetimeCrossings + b.lifetimeArtistCrossings;
      return bTotal - aTotal;
    });
  }, [stations, sort, focusedArtist]);

  const hasData = hasSeeds || hasLibrary;
  const showCrossings = hasData && allCrossings.length > 0;

  const rosterStations = useMemo(() => {
    const excludedSlugs = showCrossings ? new Set(allCrossings.map(ds => ds.station.slug)) : new Set<string>();
    const mapped = ROSTER_SLUGS.map(slug => stations.find(s => s.station.slug === slug)).filter(Boolean) as DialStation[];
    const list = mapped.filter(ds => !excludedSlugs.has(ds.station.slug));
    if (sort === "name") {
      return list.sort((a, b) => a.station.name.localeCompare(b.station.name));
    }
    return list;
  }, [stations, showCrossings, allCrossings, sort]);

  const localTime = new Date().toLocaleTimeString("en-US", { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '');

  const renderRow = (ds: DialStation, demoted: boolean) => {
    const track = ds.liveTrack ?? ds.shows.find(s => s.state === 'live')?.currentTrack;
    const isLive = ds.isLive && !!track && !track.resolving && (track.isLibraryHit || track.isArtistHit);
    
    // Gap handling
    const rawTitle = track?.title;
    const rawArtist = track?.artist;
    const title = rawTitle || "—";
    const artist = rawArtist || (rawTitle ? "Unknown artist" : "Artist unknown");

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
    const selectorLine = djNames.length === 1 ? `Selected by ${djNames[0]}` : null;
    if (demoted) {
      return (
        <div className="demo-radio__row demo-radio__row--compact" key={ds.station.slug}>
          <StationMark
            name={ds.station.name}
            logoUrl={ds.station.logoUrl}
            className="demo-radio__station-mark demo-radio__station-mark--compact"
          />
          <div className="demo-radio__body">
            <div className="demo-radio__station-name">{ds.station.name}</div>
            <div className="demo-radio__compact-title">{artist}</div>
            <div className="demo-radio__reason">
              {selectorLine ? `${selectorLine} · no overlap yet` : "No overlap yet"}
            </div>
          </div>
          <button className="demo-radio__play demo-radio__play--quiet" aria-label={`Listen to ${ds.station.name}`} onClick={() => radio.toggle(ds.station)}>
            <Play size={14} fill="currentColor" />
          </button>
        </div>
      );
    }

    const lifetimeTotal = ds.lifetimeCrossings + ds.lifetimeArtistCrossings;
    const reasonLine = focusedArtist
      ? `Has played ${focusedArtist} from your music`
      : ds.topArtistNamesLifetime.length > 0
      ? `Has played your artists ${lifetimeTotal} times · ${ds.topArtistNamesLifetime.length === 1 ? `mostly ${ds.topArtistNamesLifetime[0]}` : ds.topArtistNamesLifetime.slice(0,2).join(", ")}`
      : "";

    return (
      <div key={ds.station.slug} className="demo-radio__featured">
        <div className="demo-radio__row demo-radio__row--featured">
          <StationMark
            name={ds.station.name}
            logoUrl={ds.station.logoUrl}
            className="demo-radio__station-mark"
          />
          <div className="demo-radio__body">
            <div className="demo-radio__station-identity">
              <strong>{ds.station.name}</strong>
              {ds.station.city ? <span>{ds.station.city}</span> : null}
            </div>
            {isLive && <span className="demo-radio__pill">Library match · on air</span>}
            <div className="demo-radio__artist demo-radio__artist--primary">{artist}</div>
            {selectorLine ? <div className="demo-radio__byline">{selectorLine}</div> : null}
            {isLive ? (
              <button
                type="button"
                className="demo-radio__reason demo-radio__reason--featured"
                onClick={() => void openCurrentSet(ds.station.slug, title, artist, track?.mbid)}
                disabled={openingSetSlug === ds.station.slug}
              >
                {openingSetSlug === ds.station.slug ? "Opening set…" : "Open this set"}
              </button>
            ) : null}
          </div>
          <button className="demo-radio__play" aria-label={`Listen to ${ds.station.name}`} onClick={() => radio.toggle(ds.station)}>
            <Play size={16} fill="currentColor" />
            {radio.station?.slug === ds.station.slug ? <StationChangeCountdown track={track} /> : null}
          </button>
        </div>
        {reasonLine && (
          <div className="demo-radio__reason demo-radio__reason--featured">{reasonLine}</div>
        )}
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
        <span>{focusedArtist ? `Stations that play ${focusedArtist}` : "Plays your music"}</span>
        <span>
          {focusedArtist
            ? `${allCrossings.length} match${allCrossings.length === 1 ? "" : "es"}`
            : `${visibleSeeds.length} artists`}
        </span>
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
      <SetContextSheet
        open={sheetAnchorId !== null && sheetContext !== undefined}
        onOpenChange={(nextOpen) => { if (!nextOpen) setSheetAnchorId(null); }}
        context={sheetContext ?? null}
      />
    </section>
  );
}