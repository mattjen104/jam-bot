/**
 * Lore's front door. The full category browser remains on /feed; home is a
 * calm two-mode surface for live radio and the existing Library crate.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { useDialData } from "../hooks/useDialData";
import type { DialLaneRow } from "../components/dial/DialFeedLane";
import { useSeedManager } from "../hooks/useSeedManager";
import { useAppConfig } from "../lib/meHooks";
import { DialCliBar } from "../components/dial/DialCliBar";
import { ArtistDocument } from "../components/ArtistDocument";
import { MinimalRadioSurface } from "../components/MinimalRadioSurface";
import { FirstRunSidebar } from "../components/FirstRunSidebar";
import { usePlayer } from "../player/PlayerProvider";
import type { DialStation } from "../hooks/useDialData";
import { HomeLensNav } from "../components/HomeLensNav";
import { FirstPlayFeed } from "../components/CompactDial";
import { HomePress } from "../components/HomePress";
import Library from "./Library";
import { readHomeLens, writeHomeLens, type HomeLens } from "../lib/homeLensState";
import {
  DEFAULT_ACTIVE_STATION_CATEGORIES,
  toggleStationCategory,
} from "../lib/dialFilterState";
import type { StationCategory } from "../lib/dialCategories";
import { catchNextSong } from "../lib/firstRunCatch";

type FrontDoorMode = "radio" | "library";
const FIRST_RUN_INTERACTION_KEY = "lore:firstRunStationInteraction";

function hasFirstRunInteraction(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_INTERACTION_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberFirstRunInteraction(): void {
  try {
    localStorage.setItem(FIRST_RUN_INTERACTION_KEY, "1");
  } catch {
    // Playback must still work when storage is unavailable.
  }
}

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
  const { radio } = usePlayer();
  const { visibleSeeds, addSeed, replaceSeeds } = useSeedManager();
  const { data: appConfig } = useAppConfig();
  const showArchiveNav = appConfig?.listenerArchiveNavEnabled === true;
  const [mode, setMode] = useState<FrontDoorMode>(readFrontDoorMode);
  const [lens, setLens] = useState<HomeLens>(readHomeLens);
  const [activeCategories, setActiveCategories] = useState<Set<StationCategory>>(
    () => new Set(DEFAULT_ACTIVE_STATION_CATEGORIES),
  );
  const [supportOnly, setSupportOnly] = useState(false);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [artistDocumentOpen, setArtistDocumentOpen] = useState(false);
  const [firstRunCandidate] = useState(() => !hasFirstRunInteraction());

  useEffect(() => {
    if (!showArchiveNav && lens !== "radio") {
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

  const handleToggleCategory = useCallback((category: StationCategory) => {
    setActiveCategories((previous) => toggleStationCategory(previous, category));
  }, []);
  const handleSetCategories = useCallback((categories: ReadonlySet<StationCategory>) => {
    setActiveCategories(new Set(categories));
  }, []);

  const handleAddArtists = useCallback((names: string[]) => {
    const unique = [...new Map(names.map((name) => [name.trim().toLowerCase(), name.trim()])).values()]
      .filter(Boolean);
    if (unique.length === 0) return;
    setSeedStatus(`Adding ${unique.join(", ")}…`);
    void Promise.all(unique.map((name) => addSeed(name)))
      .then(() => setSeedStatus(`${unique.join(", ")} added to your artists`))
      .catch((error) => setSeedStatus(
        error instanceof Error ? error.message : "Couldn’t add that artist. Try again.",
      ));
  }, [addSeed]);

  const {
    stations,
    isCoreLoading,
    liveLoading,
    hasLibrary,
    hasSeeds,
    stationsError,
    refetchStations,
  } = useDialData("personal", {
    // Home already applies its category selection inside MinimalRadioSurface.
    // Keep the source pool unfiltered so first-run can always select its exact
    // editorial roster before any listener filter exists.
    categories: undefined,
    includeAllStations: true,
    crossingsEnabled: true,
    deferEnrichment: false,
  });
  // Picker-name state is the server's settled source of truth for pre-existing
  // libraries/seeds. Do not include the optimistic seed list here: a first Keep
  // should leave this orientation surface mounted for the rest of the visit.
  const coldStartSession = firstRunCandidate && !isCoreLoading && !hasLibrary && !hasSeeds;
  const playFirstRunStation = useCallback((station: DialStation) => {
    rememberFirstRunInteraction();
    radio.toggle(station.station);
  }, [radio]);
  const catchFirstRunStation = useCallback(
    (station: DialStation) => {
      rememberFirstRunInteraction();
      return catchNextSong(station, playFirstRunStation);
    },
    [playFirstRunStation],
  );
  const allRows = useMemo<DialLaneRow[]>(
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
      }),
    [stations],
  );
  const categoryByStationSlug = useMemo(
    () => new Map(
      stations.flatMap((station) => {
        const category = station.station.stationCategories?.[0] as StationCategory | undefined;
        return category ? [[station.station.slug, category] as const] : [];
      }),
    ),
    [stations],
  );
  return (
    <main className="split-home split-home--front-door">
      <div className="split-home__front-door-shell">
        <header className="front-door-header">
          <div className="front-door-header__intro">
            <h1>{coldStartSession ? "Twelve ways into live radio." : "Your records are on the radio right now."}</h1>
            <p className="front-door-subtitle">
              {!coldStartSession && <button
                type="button"
                className="front-door-subtitle__button"
                onClick={() => setArtistDocumentOpen((open) => !open)}
                aria-expanded={artistDocumentOpen}
                aria-controls="front-door-artist-document"
                data-testid="front-door-add-artists"
              >
                Add albums
              </button>}{" "}
              {coldStartSession ? "Choose by the music sounding now." : "to see which stations cross your library."}
            </p>
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

        {artistDocumentOpen ? (
          <div id="front-door-artist-document">
            <ArtistDocument
              artists={visibleSeeds}
              onSave={replaceSeeds}
              onClose={() => setArtistDocumentOpen(false)}
            />
          </div>
        ) : null}

        <div className="front-door-cli" data-testid="front-door-cli">
          <DialCliBar
            variant="strip"
            activeTiers={new Set()}
            activeCategories={activeCategories}
            onToggleTier={() => {}}
            onToggleCategory={handleToggleCategory}
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
              coldStartSession ? (
                <FirstRunSidebar
                  stations={stations}
                  seeds={visibleSeeds}
                  onAddSeed={(artist) => {
                    rememberFirstRunInteraction();
                    void addSeed(artist);
                  }}
                  onPlay={playFirstRunStation}
                  onCatchNext={catchFirstRunStation}
                />
              ) : <MinimalRadioSurface
                rows={allRows}
                remoteRows={allRows}
                categoryByStationSlug={categoryByStationSlug}
                preset="now"
                activeCategories={activeCategories}
                onToggleCategory={handleToggleCategory}
                onSetCategories={handleSetCategories}
                supportOnly={supportOnly}
                onToggleSupport={() => setSupportOnly((active) => !active)}
                loading={isCoreLoading || liveLoading}
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