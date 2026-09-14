/**
 * Lore's front door. The full category browser remains on /feed; home is a
 * calm live-radio surface. Discovery lives in Explore and intentional keeps
 * remain in Library.
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { useDialData } from "../hooks/useDialData";
import type { DialLaneRow } from "../components/dial/DialFeedLane";
import { useSeedManager } from "../hooks/useSeedManager";
import { DialCliBar } from "../components/dial/DialCliBar";
import { ArtistDocument } from "../components/ArtistDocument";
import { AdaptiveNow } from "../components/AdaptiveNow";
import { useLatestImportJob } from "../lib/meHooks";
import { deriveAdaptiveListeningState } from "../lib/adaptiveListening";
import type { StationCategory } from "../lib/dialCategories";
import { RadioBrowseControls } from "../components/RadioBrowseControls";
import { useRadioBrowseState } from "../hooks/useRadioBrowseState";
import { joinCatalogRows, useRadioCatalog } from "../hooks/useRadioCatalog";
import {
  focusForYou,
  radioBrowseProvenance,
  toggleRadioFilter,
  type RadioBrowseState,
} from "../lib/radioBrowseState";

export default function SplitHome() {
  const [, navigate] = useLocation();
  const { visibleSeeds, addSeed, replaceSeeds } = useSeedManager();
  const { data: importJob } = useLatestImportJob();
  const [activeCategories, setActiveCategories] = useState<Set<StationCategory>>(
    () => new Set(),
  );
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [artistDocumentOpen, setArtistDocumentOpen] = useState(false);

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
    stationsError,
    refetchStations,
  } = useDialData("personal", {
    // Home applies its category selection inside AdaptiveNow.
    // Keep the source pool unfiltered; the canonical catalog owns eligibility
    // and ordering while this operational list supplies playback metadata.
    categories: undefined,
    includeAllStations: true,
    crossingsEnabled: true,
    deferEnrichment: false,
  });
  const hasTasteEvidence = hasLibrary || hasSeeds || visibleSeeds.length > 0;
  const radioBrowse = useRadioBrowseState({ hasTasteEvidence });
  const radioCatalog = useRadioCatalog(radioBrowse.state, hasTasteEvidence);
  const handleBrowseStateChange = useCallback((next: RadioBrowseState) => {
    radioBrowse.setState(next);
    setActiveCategories(new Set(next.filters.stationTypes.map((type) =>
      type === "core" ? "anchor" : type === "independent-dj" ? "indie" : type,
    ) as StationCategory[]));
  }, [radioBrowse]);
  const handleToggleCategory = useCallback((category: StationCategory) => {
    const canonical = category === "anchor" ? "core" : category === "indie" ? "independent-dj" : category;
    const next = toggleRadioFilter(radioBrowse.state.filters.stationTypes, canonical);
    handleBrowseStateChange({
      ...radioBrowse.state,
      filters: { ...radioBrowse.state.filters, stationTypes: [...next] },
    });
  }, [handleBrowseStateChange, radioBrowse.state]);
  const handleSetCategories = useCallback((categories: ReadonlySet<StationCategory>) => {
    handleBrowseStateChange({
      ...radioBrowse.state,
      filters: {
        ...radioBrowse.state.filters,
        stationTypes: [...categories].map((type) =>
          type === "anchor" ? "core" : type === "indie" ? "independent-dj" : type,
        ),
      },
    });
  }, [handleBrowseStateChange, radioBrowse.state]);
  const handleFocusArtist = useCallback((artist: string) => {
    handleBrowseStateChange(focusForYou(radioBrowse.state, artist));
  }, [handleBrowseStateChange, radioBrowse.state]);

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
  const browseRows = useMemo(() => {
    const catalogItems = radioCatalog.data?.stations ?? [];
    // The API read model is the source of eligibility, verified proximity,
    // filters, and lens order. Join only returned slugs; never reinsert broad
    // pool rows or apply a second, post-pagination filter in the client.
    return joinCatalogRows(
      catalogItems.map((item) => item.station.slug),
      allRows,
      (row) => row.ds.station.slug,
    );
  }, [allRows, radioCatalog.data?.stations]);

  const coldStartSession = !isCoreLoading && !hasLibrary && !hasSeeds;
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
            <h1>{coldStartSession ? "Four ways into live radio." : "Choose or continue what to hear."}</h1>
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
              {coldStartSession ? "Choose by the music sounding now." : "Your Library, live crossings, and the wider dial stay one click away."}
            </p>
          </div>
          <nav className="front-door-jobs" aria-label="Listening jobs">
            <Link href="/" aria-current="page">All</Link>
            <Link href="/following">Following</Link>
            <Link href="/explore?draft=location">Near You</Link>
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

        <RadioBrowseControls
          state={radioBrowse.state}
          onStateChange={handleBrowseStateChange}
          onLocalityChange={radioBrowse.setLocality}
          resultCount={radioCatalog.data?.metadata.eligibleCount ?? browseRows.length}
          hasTasteEvidence={hasTasteEvidence || Boolean(radioBrowse.state.focusedArtist)}
        />

        <AdaptiveNow
            rows={browseRows}
            state={adaptiveState}
            importJob={importJob}
            activeCategories={activeCategories}
            supportOnly={radioBrowse.state.filters.supportOnly}
            onToggleCategory={handleToggleCategory}
            onSetCategories={handleSetCategories}
            onToggleSupport={() => handleBrowseStateChange({
              ...radioBrowse.state,
              filters: {
                ...radioBrowse.state.filters,
                supportOnly: !radioBrowse.state.filters.supportOnly,
              },
            })}
            preserveOrder
             browseEligibleCount={radioCatalog.data?.metadata.eligibleCount}
            browsePage={radioBrowse.state.page}
            onBrowsePageChange={(page) => handleBrowseStateChange({ ...radioBrowse.state, page })}
            browseExplanations={new Map((radioCatalog.data?.stations ?? []).map((item) => [
              item.station.slug,
              item.explanation,
            ]))}
            onFocusArtist={handleFocusArtist}
            hideLegacyFilters
            browseProvenance={radioCatalog.data?.metadata.claim
              ?? radioBrowseProvenance(radioBrowse.state, browseRows.length)}
          />
        {isCoreLoading || radioCatalog.isLoading ? (
          <div className="radio-browse-status" role="status" data-testid="radio-browse-loading">
            {isCoreLoading ? "Loading live station data…" : "Loading this station page…"}
          </div>
        ) : null}
        {stationsError || radioCatalog.error ? (
          <div className="radio-browse-status radio-browse-status--error" role="alert" data-testid="radio-browse-error">
            <span>We couldn’t load the station deck. Your current browse state is still available to retry.</span>
            <button type="button" onClick={() => {
              refetchStations();
              radioCatalog.retry();
            }}>Retry</button>
            <button type="button" onClick={() => {
              radioBrowse.setState({
                ...radioBrowse.state,
                lens: "local",
                sort: "recommended",
                focusedArtist: null,
                focusedSound: null,
                page: 1,
                filters: {
                  stationTypes: [],
                  specialistFormats: [],
                  decades: [],
                  playingNow: [],
                  broZones: [],
                  followedOnly: false,
                  supportOnly: false,
                },
              });
              refetchStations();
              radioCatalog.retry();
            }}>Reset browse</button>
          </div>
        ) : null}
        {radioCatalog.data?.metadata.partial && (
          radioCatalog.data.metadata.partial.locality
          || radioCatalog.data.metadata.partial.personalization
          || radioCatalog.data.metadata.omittedUnknownLocation > 0
        ) ? (
          <div className="radio-browse-status radio-browse-status--partial" role="status" data-testid="radio-browse-partial">
            Some catalog evidence is still partial
            {radioCatalog.data.metadata.partial.locality ? " — locality is not fully verified." : ""}
            {radioCatalog.data.metadata.partial.personalization ? " — Library evidence is not available yet." : ""}
            {radioCatalog.data.metadata.omittedUnknownLocation > 0 ? " — some stations have no verified location." : ""}
          </div>
        ) : null}
      </div>
    </main>
  );
}