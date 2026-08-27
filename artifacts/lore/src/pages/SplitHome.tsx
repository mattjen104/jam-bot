/**
 * Lore's front door.  The full category browser remains on /feed; home is
 * deliberately a read-first discovery surface for live radio and catches.
 */
import { useCallback, useMemo, useState } from "react";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { useDialData } from "../hooks/useDialData";
import { usePlayer } from "../player/PlayerProvider";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import type { DialLaneRow } from "../components/dial/DialFeedLane";
import { HomeDiscovery } from "../components/HomeDiscovery";
import { useMyLibraryInfinite } from "../lib/meHooks";
import {
  nextCrossingScope,
  readCrossingScope,
  writeCrossingScope,
} from "../lib/crossingScope";
import { HomePress } from "../components/HomePress";
import { readDialLens, writeDialLens, type DialLens } from "../lib/dialLensState";

export default function SplitHome() {
  const { radio } = usePlayer();

  const [lens, setLens] = useState<DialLens>(() =>
    readDialLens() === "press" ? "press" : "radio",
  );

  const handleSetLens = (newLens: DialLens) => {
    if (newLens === "press" || newLens === "radio") {
      setLens(newLens);
      writeDialLens(newLens);
    }
  };

  const { stations, hasLibrary } = useDialData("personal", {
    includeAllStations: false,
    crossingsEnabled: true,
    deferEnrichment: false,
  });
  const libraryQuery = useMyLibraryInfinite({ source: "lore", sort: "added" }, 50);
  const libraryItems = useMemo(
    () => libraryQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [libraryQuery.data],
  );
  const [crossingScope, setCrossingScope] = useState(readCrossingScope);
  const onCycleCrossingScope = useCallback(() => {
    setCrossingScope((current) => {
      const next = nextCrossingScope(current);
      writeCrossingScope(next);
      return next;
    });
  }, []);

  const rows = useMemo<DialLaneRow[]>(
    () => stations
      .map((ds) => {
        const show = ds.shows.find((candidate) => candidate.state === "live") ?? null;
        const names = eligibleDjNames(
          {
            name: show?.showName ?? "",
            djName: show?.djName ?? undefined,
            djNames: show?.djNames,
          },
          {
            artist: ds.liveTrack?.artist ?? show?.currentTrack?.artist,
            title: ds.liveTrack?.title ?? show?.currentTrack?.title,
            showTitle: show?.showName,
            stationName: ds.station.name,
          },
        );
        return {
          ds,
          show: show && names.length === 1 && names[0] !== show.djName
            ? { ...show, djName: names[0] }
            : show,
          effectiveDjName: names.length === 1 ? names[0] : null,
        };
      })
      .filter((row) => row.ds.isLive),
    [stations],
  );

  const warm = hasLibrary;
  const playRow = useCallback((row: DialLaneRow) => {
    if (resolvePlaybackSource(row.ds.station) == null) return;
    void radio.toggle(row.ds.station);
  }, [radio]);

  return (
    <main className="split-home split-home--discovery">
      <div className="split-home__discovery-shell">
        <header className="split-home__discovery-intro">
          <div className="split-home__lens-toggle" role="group" aria-label="Lens selection">
            <button
              type="button"
              className={`split-home__lens-btn${lens === "radio" ? " split-home__lens-btn--active" : ""}`}
              aria-pressed={lens === "radio"}
              onClick={() => handleSetLens("radio")}
            >
              Lore radio
            </button>
            <span className="split-home__lens-sep" aria-hidden="true">|</span>
            <button
              type="button"
              className={`split-home__lens-btn${lens === "press" ? " split-home__lens-btn--active" : ""}`}
              aria-pressed={lens === "press"}
              onClick={() => handleSetLens("press")}
            >
              Press
            </button>
          </div>
          <h1>{lens === "press" ? "Source and respect" : "Hear what’s moving"}</h1>
          <p>{lens === "press" ? "Music publications and the records you caught." : "Live music, human choices, and the records you caught."}</p>
        </header>
        {lens === "radio" ? (
          <HomeDiscovery
            rows={rows}
            activeSlug={radio.station?.slug ?? null}
            onPlay={playRow}
            warm={warm}
            libraryItems={libraryItems}
            crossingScope={crossingScope}
            onCycleCrossingScope={onCycleCrossingScope}
          />
        ) : (
          <HomePress />
        )}
      </div>
    </main>
  );
}
