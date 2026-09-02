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
import { ArtistDocument } from "../components/ArtistDocument";
import { MinimalRadioSurface } from "../components/MinimalRadioSurface";
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

type FrontDoorMode = "radio" | "library";
type FrontDoorExperience = "onboarding" | "post-import";

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

function readFrontDoorExperience(): FrontDoorExperience {
  try {
    return localStorage.getItem("lore:frontDoorExperience") === "post-import"
      ? "post-import"
      : "onboarding";
  } catch {
    return "onboarding";
  }
}

function writeFrontDoorExperience(experience: FrontDoorExperience): void {
  try {
    localStorage.setItem("lore:frontDoorExperience", experience);
  } catch {
    // A private browsing context should not prevent the front door loading.
  }
}

export default function SplitHome() {
  const { visibleSeeds, addSeed, replaceSeeds } = useSeedManager();
  const { data: appConfig } = useAppConfig();
  const showArchiveNav = appConfig?.listenerArchiveNavEnabled === true;
  const [mode, setMode] = useState<FrontDoorMode>(readFrontDoorMode);
  const [experience, setExperience] = useState<FrontDoorExperience>(readFrontDoorExperience);
  const [lens, setLens] = useState<HomeLens>(readHomeLens);
  const [activeCategories, setActiveCategories] = useState<Set<StationCategory>>(
    () => new Set(DEFAULT_ACTIVE_STATION_CATEGORIES),
  );
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [artistDocumentOpen, setArtistDocumentOpen] = useState(false);

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

  const changeExperience = useCallback((next: FrontDoorExperience) => {
    setExperience(next);
    writeFrontDoorExperience(next);
    setArtistDocumentOpen(false);
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
    spinsBySlug,
    isCoreLoading,
    liveLoading,
    stationsError,
    refetchStations,
  } = useDialData("personal", {
    categories: activeCategories,
    includeAllStations: true,
    crossingsEnabled: true,
    deferEnrichment: false,
  });
  // The Radio card needs the listener's actual imported library as well as
  // Lore-kept tracks so imported albums can appear in crossing context.
  const libraryQuery = useMyLibraryInfinite({ sort: "added" }, 50);
  const libraryItems = useMemo(
    () => libraryQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [libraryQuery.data],
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
  const rows = useMemo(
    () => allRows.filter((row) => row.ds.isLive),
    [allRows],
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
          {experience === "onboarding" ? (
            <div className="front-door-header__intro">
              <h1>Your records are on the radio right now.</h1>
              <p className="front-door-subtitle">
                <button
                  type="button"
                  className="front-door-subtitle__button"
                  onClick={() => setArtistDocumentOpen((open) => !open)}
                  aria-expanded={artistDocumentOpen}
                  aria-controls="front-door-artist-document"
                  data-testid="front-door-add-artists"
                >
                  Add albums
                </button>{" "}
                to see which stations cross your library.
              </p>
            </div>
          ) : (
            <div className="front-door-header__post-import" data-testid="front-door-post-import">
              <div className="front-door-header__post-import-label">Post Matt import</div>
              <button
                type="button"
                className="front-door-add-artists"
                onClick={() => setArtistDocumentOpen((open) => !open)}
                aria-expanded={artistDocumentOpen}
                aria-controls="front-door-artist-document"
                data-testid="front-door-post-import-add-artists"
              >
                Add artists
              </button>
              {visibleSeeds.length > 0 ? (
                <div className="front-door-artist-seeds" aria-label="Your artists">
                  {visibleSeeds.map((artist) => (
                    <span key={artist}>{artist}</span>
                  ))}
                </div>
              ) : null}
            </div>
          )}
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
          {import.meta.env.DEV ? (
            <div className="front-door-architect" data-testid="front-door-architect-toggle">
              <span className="front-door-architect__label">Architect preview</span>
              <div className="front-door-architect__options" role="group" aria-label="Front door experience">
                <button
                  type="button"
                  className={experience === "onboarding" ? "is-active" : ""}
                  aria-pressed={experience === "onboarding"}
                  onClick={() => changeExperience("onboarding")}
                  data-testid="front-door-experience-onboarding"
                >
                  Onboarding
                </button>
                <button
                  type="button"
                  className={experience === "post-import" ? "is-active" : ""}
                  aria-pressed={experience === "post-import"}
                  onClick={() => changeExperience("post-import")}
                  data-testid="front-door-experience-post-import"
                >
                  Post import
                </button>
              </div>
            </div>
          ) : null}
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
              <MinimalRadioSurface
                rows={rows}
                 remoteRows={allRows}
                libraryItems={libraryItems}
                recentSpinsBySlug={spinsBySlug}
                categoryByStationSlug={categoryByStationSlug}
                preset="now"
                activeCategories={activeCategories}
                onToggleCategory={handleToggleCategory}
                 onSetCategories={handleSetCategories}
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