/**
 * Lore's front door. The full category browser remains on /feed; home is a
 * calm two-mode surface for live radio and the existing Library crate.
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { useDialData } from "../hooks/useDialData";
import type { DialLaneRow } from "../components/dial/DialFeedLane";
import { useSeedManager } from "../hooks/useSeedManager";
import { DialCliBar } from "../components/dial/DialCliBar";
import { ArtistDocument } from "../components/ArtistDocument";
import { FirstRunSidebar } from "../components/FirstRunSidebar";
import { usePlayer } from "../player/PlayerProvider";
import type { DialStation } from "../hooks/useDialData";
import { AdaptiveNow } from "../components/AdaptiveNow";
import { useLatestImportJob } from "../lib/meHooks";
import { deriveAdaptiveListeningState } from "../lib/adaptiveListening";
import {
  DEFAULT_ACTIVE_STATION_CATEGORIES,
  toggleStationCategory,
} from "../lib/dialFilterState";
import type { StationCategory } from "../lib/dialCategories";
import { catchNextSong } from "../lib/firstRunCatch";

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

export default function SplitHome() {
  const [, navigate] = useLocation();
  const { radio } = usePlayer();
  const { visibleSeeds, addSeed, replaceSeeds } = useSeedManager();
  const { data: importJob } = useLatestImportJob();
  const [activeCategories, setActiveCategories] = useState<Set<StationCategory>>(
    () => new Set(DEFAULT_ACTIVE_STATION_CATEGORIES),
  );
  const [supportOnly, setSupportOnly] = useState(false);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [artistDocumentOpen, setArtistDocumentOpen] = useState(false);
  const [firstRunCandidate] = useState(() => !hasFirstRunInteraction());

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
    hasLibrary,
    hasSeeds,
  } = useDialData("personal", {
    // Home applies its category selection inside AdaptiveNow.
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
  const coldStartSession = firstRunCandidate && !isCoreLoading && !hasLibrary && !hasSeeds;
  const confirmedLiveCrossings = allRows.filter((row) => {
    const track = row.ds.liveTrack ?? row.show?.currentTrack;
    return Boolean(track && !track.resolving && (track.isLibraryHit || track.isArtistHit));
  }).length;
  const adaptiveState = deriveAdaptiveListeningState({
    hasLibrary,
    hasSeeds,
    importJob,
    confirmedLiveCrossings,
  });
  return (
    <main className="split-home split-home--front-door">
      <div className="split-home__front-door-shell">
        <header className="front-door-header" data-testid="now-header">
          <div className="front-door-header__intro">
            <p className="front-door-eyebrow">Now</p>
            <h1>{coldStartSession ? "Twelve ways into live radio." : "Choose or continue what to hear."}</h1>
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
              {coldStartSession ? "Choose by the music sounding now." : "Your Stack, live crossings, and the wider dial stay one click away."}
            </p>
          </div>
          <nav className="front-door-jobs" aria-label="Listening jobs">
            <Link href="/feed">Explore / Feed</Link>
            <Link href="/library">Stack</Link>
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
            onLibrary={() => navigate("/library")}
            onHome={() => navigate("/")}
            onRadioMode={() => undefined}
            className="front-door-cli__bar"
          />
          {seedStatus ? (
            <div className="front-door-cli__status" role="status" aria-live="polite">
              {seedStatus}
            </div>
          ) : null}
        </div>

        {coldStartSession ? (
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
        ) : (
          <AdaptiveNow
            rows={allRows}
            state={adaptiveState}
            importJob={importJob}
            activeCategories={activeCategories}
            supportOnly={supportOnly}
            onToggleCategory={handleToggleCategory}
            onSetCategories={handleSetCategories}
            onToggleSupport={() => setSupportOnly((active) => !active)}
          />
        )}
      </div>
    </main>
  );
}