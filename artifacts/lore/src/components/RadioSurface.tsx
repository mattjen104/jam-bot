import { useMemo } from "react";
import { usePlayer } from "../player/PlayerProvider";
import { StationMark } from "./StationMark";
import type { DialStation, DialShow } from "../hooks/useDialData";
import { getMyStationCrossings } from "@workspace/api-client-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { buildDemoRadioSections } from "../lib/demoRadioOrdering";
import { type LibraryMatchFilters } from "../lib/libraryMatchEvidence";
import type { LibraryMatchEvidence as MatchEvidence } from "../lib/libraryMatchEvidence";
import { crossingScopeDetail } from "../lib/crossingScope";
import { crossingSentence } from "./dialViewHelpers";
import { stationLocationAndType } from "../lib/stationDisplayMetadata";

export function RadioSurface({ 
  stations, 
  hasSeeds,
  hasLibrary,
  showHeader = true,
  sort = "overlap",
  focusedArtist = null,
  forceAllStations = false,
  selectedStationSlug = null,
  onOpenStationCrossings,
  onCloseStationCrossings,
}: {
  stations: DialStation[];
  hasSeeds: boolean;
  hasLibrary: boolean;
  showHeader?: boolean;
  sort?: "overlap" | "live" | "discovery" | "name" | "newest";
  focusedArtist?: string | null;
  forceAllStations?: boolean;
  selectedStationSlug?: string | null;
  onFocusArtist?: (artist: string) => void;
  onOpenStationCrossings?: (stationSlug: string) => void;
  onCloseStationCrossings?: () => void;
  matchFilters?: LibraryMatchFilters;
  onRemoveMatchFilter?: (fact: MatchEvidence) => void;
}) {
  const { radio } = usePlayer();

  const hasData = hasSeeds || hasLibrary;
  const {
    crossingStations: allCrossings,
    rosterStations,
    showCrossings,
  } = useMemo(
    () => buildDemoRadioSections({
      stations,
      hasData,
      focusedArtist,
      sort,
      forceAllStations,
    }),
    [focusedArtist, forceAllStations, hasData, sort, stations],
  );

  const localTime = new Date().toLocaleTimeString("en-US", { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '');

  const renderRow = (ds: DialStation, demoted: boolean) => {
    const detail = crossingScopeDetail(ds, "7d");
    const dummyShow = ds.shows.find(s => s.state === 'live') ?? {
      state: "live", showName: null, djName: null, djNames: [],
      crossings: 0, artistCrossings: 0, topArtists: [], topArtistNames: [], spins: [], currentTrack: null
    } as unknown as DialShow;
    
    // Clear out liveTrack to ensure now-playing information is removed.
    const showWithoutTrack = { ...dummyShow, currentTrack: null } as DialShow;

    const sentence = crossingSentence(
      ds.station.name,
      showWithoutTrack,
      "personal",
      undefined,
      undefined,
      "7d",
      detail
    );

    const evidenceNode = sentence 
      ? sentence.node 
      : detail.count > 0 
        ? `${detail.count} ${detail.count === 1 ? 'crossing' : 'crossings'} in the last 7d.` 
        : "No crossings in the last 7d.";

    return (
      <div key={ds.station.slug} className={`demo-radio__featured${demoted ? " demo-radio__featured--secondary" : ""}`}>
        <button
          type="button"
          className="demo-radio__station-tune"
          aria-label={`Listen to ${ds.station.name}`}
          onClick={() => radio.toggle(ds.station)}
        >
          <StationMark
            name={ds.station.name}
            iconUrl={ds.station.stationIconUrl}
            logoUrl={ds.station.logoUrl}
            variant="cube"
            faviconOnly
            className="demo-radio__station-mark"
          />
          <span className="demo-radio__station-name-overlay">{ds.station.name}</span>
          <span className="demo-radio__station-meta-overlay">
            {stationLocationAndType(ds.station)}
          </span>
        </button>
        <button
          type="button"
          className="demo-radio__reason demo-radio__reason--featured demo-radio__crossings-link"
          onClick={() => onOpenStationCrossings?.(ds.station.slug)}
          disabled={!onOpenStationCrossings}
          aria-label={`Open every crossing for ${ds.station.name}`}
        >
          {evidenceNode}
        </button>
      </div>
    );
  };

  if (selectedStationSlug) {
    const selected = stations.find((ds) => ds.station.slug === selectedStationSlug) ?? null;
    return (
      <StationCrossingsView
        station={selected}
        stationSlug={selectedStationSlug}
        onBack={onCloseStationCrossings}
      />
    );
  }

  return (
    <section className="demo-radio" aria-label="Radio">
      {showHeader ? (
        <header className="demo-radio__header">
          <h1>Radio</h1>
          <time>{localTime}</time>
        </header>
      ) : null}

      {focusedArtist ? (
        <div className="demo-radio__section-label">
          <span>{`Stations that play ${focusedArtist}`}</span>
          <span>{`${allCrossings.length} match${allCrossings.length === 1 ? "" : "es"}`}</span>
        </div>
      ) : null}

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

function crossingDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Airtime unavailable";
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StationCrossingsView({
  station,
  stationSlug,
  onBack,
}: {
  station: DialStation | null;
  stationSlug: string;
  onBack?: () => void;
}) {
  const query = useInfiniteQuery({
    queryKey: ["me", "station-crossings", stationSlug],
    queryFn: ({ pageParam }) => getMyStationCrossings(stationSlug, {
      cursor: pageParam,
      limit: 50,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 2 * 60_000,
    retry: false,
  });
  const pages = query.data?.pages ?? [];
  const exact = pages.flatMap((page) => page.exact);
  const artistOnly = pages.flatMap((page) => page.artistOnly);
  const latestPage = pages.at(-1);
  const stationName = station?.station.name ?? stationSlug;
  const hasItems = exact.length + artistOnly.length > 0;
  const hasLoadedData = pages.length > 0;
  const refreshFailed = query.isError && hasLoadedData;

  return (
    <section className="demo-radio demo-radio-crossings" aria-label={`Crossings for ${stationName}`}>
      <header className="demo-radio-crossings__header">
        <button type="button" onClick={onBack} className="demo-radio-crossings__back">
          <ArrowLeft size={15} aria-hidden="true" />
          Back to Radio
        </button>
        <div>
          <h2>{stationName}</h2>
          <p>Every time this station played your saved music or artists.</p>
        </div>
      </header>

      {query.isLoading ? (
        <div className="demo-radio-crossings__state" aria-live="polite">
          Loading this station’s crossings…
        </div>
      ) : query.isError && !hasLoadedData ? (
        <div className="demo-radio-crossings__state" role="alert">
          These crossings could not be checked right now.
          <button type="button" onClick={() => void query.refetch()}>Try again</button>
        </div>
      ) : (
        <>
          <div className="demo-radio-crossings__freshness" aria-live="polite">
            {refreshFailed
              ? "Showing the last loaded evidence; the refresh failed."
              : query.isFetching
                ? "Refreshing crossing evidence…"
                : latestPage
                  ? `Checked ${crossingDateLabel(latestPage.generatedAt)}`
                  : "Crossing evidence unavailable"}
          </div>
          {!hasItems ? (
            <div className="demo-radio-crossings__state">
              No current crossings were found. The Radio card’s cached evidence may be older than the latest library or station history.
              {refreshFailed ? (
                <button type="button" onClick={() => void query.refetch()}>Try again</button>
              ) : null}
            </div>
          ) : (
            <>
              <CrossingMomentSection
                title="Saved songs & albums"
                description="Exact saved recordings and tracks from saved albums."
                items={exact}
                partial={query.hasNextPage}
              />
              <CrossingMomentSection
                title="Artist-only crossings"
                description="Other tracks by artists in your music."
                items={artistOnly}
                partial={query.hasNextPage}
              />
              {query.hasNextPage ? (
                <button
                  type="button"
                  className="demo-radio-crossings__more"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? "Loading more crossings…" : "Load more crossings"}
                </button>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}

function CrossingMomentSection({
  title,
  description,
  items,
  partial,
}: {
  title: string;
  description: string;
  items: Array<{
    spinId: number;
    title: string;
    artist: string;
    albumTitle: string | null;
    exactMatchKind: "song" | "album" | null;
    playedAt: string;
  }>;
  partial: boolean;
}) {
  return (
    <section className="demo-radio-crossings__section">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span>
          {items.length.toLocaleString()}
          {partial ? " loaded" : ""}
        </span>
      </header>
      {items.length === 0 ? (
        <p className="demo-radio-crossings__none">
          {partial ? "None loaded yet. Older crossings may appear below." : "None for this station."}
        </p>
      ) : (
        <ol>
          {items.map((item) => (
            <li key={item.spinId}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.artist}</span>
                {item.exactMatchKind ? (
                  <small>
                    {item.exactMatchKind === "album" ? "Saved album" : "Saved song"}
                    {item.albumTitle ? ` · ${item.albumTitle}` : ""}
                  </small>
                ) : item.albumTitle ? <small>{item.albumTitle}</small> : null}
              </div>
              <time dateTime={item.playedAt}>{crossingDateLabel(item.playedAt)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}