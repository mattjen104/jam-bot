/**
 * Lore's front door. The full category browser remains on /feed; home is a
 * calm two-mode surface for live radio and the existing Library crate.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { useDialData } from "../hooks/useDialData";
import type { DialLaneRow } from "../components/dial/DialFeedLane";
import { useSeedManager } from "../hooks/useSeedManager";
import { useMyLibraryInfinite, useAppConfig } from "../lib/meHooks";
import { DialCliBar } from "../components/dial/DialCliBar";
import { MinimalRadioSurface, type RadioPreset } from "../components/MinimalRadioSurface";
import { HomeLensNav } from "../components/HomeLensNav";
import { FirstPlayFeed } from "../components/CompactDial";
import { HomePress } from "../components/HomePress";
import Library from "./Library";
import { readHomeLens, writeHomeLens, type HomeLens } from "../lib/homeLensState";

type FrontDoorMode = "radio" | "library";

function readFrontDoorMode(): FrontDoorMode {
  try {
    return localStorage.getItem("lore:frontDoorMode") === "library" ? "library" : "radio";
  } catch {
    return "radio";
  }
}

function writeFrontDoorMode(mode: FrontDoorMode): void {
  try {
    localStorage.setItem("lore:frontDoorMode", mode);
  } catch {
    // A private browsing context should not prevent the front door loading.
  }
}

export default function SplitHome() {
  const { addSeed } = useSeedManager();
  const { data: appConfig } = useAppConfig();
  const showArchiveNav = appConfig?.listenerArchiveNavEnabled === true;
  const [mode, setMode] = useState<FrontDoorMode>(readFrontDoorMode);
  const [lens, setLens] = useState<HomeLens>(readHomeLens);
  const [preset, setPreset] = useState<RadioPreset>("now");
  const [seedStatus, setSeedStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!showArchiveNav && lens !== "radio") {
      setLens("radio");
      writeHomeLens("radio");
    }
  }, [lens, showArchiveNav]);

  const activeLens: HomeLens = showArchiveNav ? lens : "radio";

  const changeMode = useCallback((next: FrontDoorMode) => {
    setMode(next);
    writeFrontDoorMode(next);
  }, []);

  const handleSetLens = useCallback((newLens: HomeLens) => {
    setLens(newLens);
    writeHomeLens(newLens);
  }, []);

  const handleAddArtists = useCallback((names: string[]) => {
    const unique = [...new Map(names.map((name) => [name.trim().toLowerCase(), name.trim()])).values()]
      .filter(Boolean);
    if (unique.length === 0) return;
    setSeedStatus(`Adding ${unique.join(", ")}…`);
    void Promise.all(unique.map((name) => addSeed(name)))
      .then(() => setSeedStatus(`${unique.join(", ")} added to your artists`))
      .catch(() => setSeedStatus("Couldn’t add that artist. Try again."));
  }, [addSeed]);

  const {
    stations,
    isCoreLoading,
    stationsError,
    refetchStations,
  } = useDialData("personal", {
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

  return (
    <main className="split-home split-home--front-door">
      <div className="split-home__front-door-shell">
        <header className="front-door-header">
          <div className="front-door-header__intro">
            <span className="front-door-header__kicker">Lore radio</span>
            <h1>Your records are on the radio right now.</h1>
            <p>Live stations, chosen around what you already love.</p>
          </div>
          <nav className="front-door-modes" aria-label="Front door mode">
            <button
              type="button"
              className={mode === "radio" ? "is-active" : ""}
              aria-pressed={mode === "radio"}
              onClick={() => changeMode("radio")}
              data-testid="front-door-radio-mode"
            >
              Radio
            </button>
            <button
              type="button"
              className={mode === "library" ? "is-active" : ""}
              aria-pressed={mode === "library"}
              onClick={() => changeMode("library")}
              data-testid="front-door-library-mode"
            >
              Library
            </button>
          </nav>
        </header>

        <div className="front-door-cli" data-testid="front-door-cli">
          <DialCliBar
            variant="strip"
            activeTiers={new Set()}
            activeCategories={new Set()}
            onToggleTier={() => {}}
            onToggleCategory={() => {}}
            onAddArtists={handleAddArtists}
            onLibrary={() => changeMode("library")}
            onHome={() => changeMode("radio")}
            onRadioMode={() => changeMode("radio")}
            className="front-door-cli__bar"
          />
          {seedStatus ? (
            <div className="front-door-cli__status" role="status" aria-live="polite">
              {seedStatus}
            </div>
          ) : null}
        </div>

        {mode === "library" ? (
          <section className="front-door-library" data-testid="front-door-library">
            <Library embedded />
          </section>
        ) : (
          <>
            <HomeLensNav
              activeLens={activeLens}
              onSelect={handleSetLens}
              showArchiveLenses={showArchiveNav}
            />
            {activeLens === "radio" ? (
              <MinimalRadioSurface
                key={preset}
                rows={rows}
                libraryItems={libraryItems}
                preset={preset}
                onPresetChange={setPreset}
                loading={isCoreLoading}
                error={stationsError}
                onRetry={refetchStations}
              />
            ) : activeLens === "firstPlays" ? (
              <FirstPlayFeed />
            ) : (
              <HomePress />
            )}
          </>
        )}
      </div>
    </main>
  );
}