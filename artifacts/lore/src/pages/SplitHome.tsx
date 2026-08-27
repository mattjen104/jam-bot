/**
 * Lore's front door.  The full category browser remains on /feed; home is
 * deliberately a read-first discovery surface for live radio and catches.
 */
import { useCallback, useMemo } from "react";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { useDialData } from "../hooks/useDialData";
import { usePlayer } from "../player/PlayerProvider";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import type { DialLaneRow } from "../components/dial/DialFeedLane";
import { HomeDiscovery } from "../components/HomeDiscovery";
import { useMyLibraryInfinite } from "../lib/meHooks";

export default function SplitHome() {
  const { radio } = usePlayer();
  const { stations, hasLibrary } = useDialData("personal", {
    // Home needs live crossings and current station observations, but does
    // not need the full /feed category controls or its enrichment surface.
    includeAllStations: false,
    crossingsEnabled: true,
    deferEnrichment: false,
  });
  const libraryQuery = useMyLibraryInfinite({ source: "lore", sort: "added" }, 50);
  const libraryItems = useMemo(
    () => libraryQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [libraryQuery.data],
  );

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
          <p className="split-home__eyebrow">Lore radio</p>
          <h1>Hear what’s moving</h1>
          <p>Live music, human choices, and the records you caught.</p>
        </header>
        <HomeDiscovery
          rows={rows}
          activeSlug={radio.station?.slug ?? null}
          onPlay={playRow}
          warm={warm}
          libraryItems={libraryItems}
        />
      </div>
    </main>
  );
}