import { useMemo, useState } from "react";
import { usePlayer } from "../player/PlayerProvider";
import { StationMark } from "./StationMark";
import type { DialStation } from "../hooks/useDialData";
import { getMyStationCrossings } from "@workspace/api-client-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import {
  buildDemoRadioSections,
  selectBeyondHighlightStations,
  selectSpecialistHighlightStations,
  selectSpecialistSubcategoryHighlightStations,
} from "../lib/demoRadioOrdering";
import { type LibraryMatchFilters } from "../lib/libraryMatchEvidence";
import type { LibraryMatchEvidence as MatchEvidence } from "../lib/libraryMatchEvidence";
import { stationCardMetadata } from "../lib/stationDisplayMetadata";
import {
  demoStationEvidence,
  missionStationEvidence,
  normalizeDemoArtist,
  type DemoStationEvidence,
} from "../lib/demoStationEvidence";
import { specialistSubcategoryForStation } from "../lib/specialistCategories";

export function RadioSurface({ 
  stations, 
  hasSeeds,
  hasLibrary,
  showHeader = true,
  mode = "all",
  onEnterAllStations,
  sort = "overlap",
  focusedArtist = null,
  forceAllStations = false,
  selectedStationSlug = null,
  focusedArtistMbid = null,
  onFocusArtist,
  onOpenStationCrossings,
  onCloseStationCrossings,
  broZoneStations = [],
  broZoneLocationLabel = null,
  onRequestBroZoneZip,
  onEnterSpecialistStations,
  onEnterEraStations,
}: {
  stations: DialStation[];
  hasSeeds: boolean;
  hasLibrary: boolean;
  showHeader?: boolean;
  mode?: "highlights" | "all";
  onEnterAllStations?: (sort: "overlap" | "discovery") => void;
  sort?: "overlap" | "live" | "discovery" | "name" | "newest";
  focusedArtist?: string | null;
  forceAllStations?: boolean;
  selectedStationSlug?: string | null;
  focusedArtistMbid?: string | null;
  onFocusArtist?: (artist: string, artistMbid?: string | null) => void;
  onOpenStationCrossings?: (stationSlug: string) => void;
  onCloseStationCrossings?: () => void;
  broZoneStations?: DialStation[];
  broZoneLocationLabel?: string | null;
  onRequestBroZoneZip?: () => void;
  onEnterSpecialistStations?: () => void;
  onEnterEraStations?: () => void;
  matchFilters?: LibraryMatchFilters;
  onRemoveMatchFilter?: (fact: MatchEvidence) => void;
}) {
  const { radio } = usePlayer();
  const [broZoneExpanded, setBroZoneExpanded] = useState(false);

  const hasData = hasSeeds || hasLibrary;
  const broZoneSlugs = useMemo(
    () => new Set(broZoneStations.map((station) => station.station.slug)),
    [broZoneStations],
  );
  const sectionStations = useMemo(
    () => mode === "highlights"
      ? stations.filter((station) => !broZoneSlugs.has(station.station.slug))
      : stations,
    [broZoneSlugs, mode, stations],
  );
  const {
    crossingStations: allCrossings,
    rosterStations,
    orderedStations,
  } = useMemo(
    () => buildDemoRadioSections({
      stations: sectionStations,
      hasData,
      focusedArtist,
      focusedArtistMbid,
      sort,
      forceAllStations,
    }),
    [focusedArtist, focusedArtistMbid, forceAllStations, hasData, sectionStations, sort],
  );

  const localTime = new Date().toLocaleTimeString("en-US", { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '');
  const eraStations = mode === "highlights"
    ? selectSpecialistSubcategoryHighlightStations(
      sectionStations,
      "era",
      broZoneSlugs,
    )
    : [];
  const eraSlugs = new Set(eraStations.map((station) => station.station.slug));
  const visibleForYou = mode === "highlights"
    ? allCrossings
      .filter((station) => !eraSlugs.has(station.station.slug))
      .slice(0, 4)
    : allCrossings;
  const specialistExcludedSlugs = new Set([
    ...broZoneSlugs,
    ...visibleForYou.map((station) => station.station.slug),
    ...eraSlugs,
  ]);
  const generalSpecialistStations = sectionStations.filter(
    (station) => specialistSubcategoryForStation(station.station) !== "era",
  );
  const specialistStations = mode === "highlights"
    ? selectSpecialistHighlightStations(
      generalSpecialistStations,
      new Set([
        ...specialistExcludedSlugs,
      ]),
    )
    : [];
  const visibleRoster = mode === "highlights"
    ? selectBeyondHighlightStations(
      sectionStations,
      new Set([
        ...specialistExcludedSlugs,
        ...specialistStations.map((station) => station.station.slug),
        ...eraStations.map((station) => station.station.slug),
      ]),
    )
    : rosterStations;
  const missionSlugs = new Set([
    ...rosterStations,
    ...visibleRoster,
  ].map((station) => station.station.slug));

  const renderRow = (ds: DialStation) => {
    const personalEvidence = demoStationEvidence(
      ds,
      hasData,
      focusedArtist,
      focusedArtistMbid,
    );
    const evidence = missionSlugs.has(ds.station.slug)
      || (!focusedArtist && !forceAllStations && sort === "discovery")
      ? missionStationEvidence(ds) ?? personalEvidence
      : personalEvidence;
    const metadata = stationCardMetadata(ds.station);
    const selected = radio.station?.slug === ds.station.slug;

    return (
      <article
        key={ds.station.slug}
        className={`demo-radio__featured demo-radio__featured--library${selected ? " is-selected" : ""}`}
      >
        <button
          type="button"
          className="demo-radio__card-tune"
          aria-label={`Listen to ${ds.station.name}`}
          aria-pressed={selected}
          onClick={() => radio.toggle(ds.station)}
        />
        <StationMark
          name={ds.station.name}
          iconUrl={ds.station.stationIconUrl}
          logoUrl={ds.station.logoUrl}
          variant="cube"
          faviconOnly
          className="demo-radio__station-mark"
        />
        <div className="demo-radio__crossing-panel">
          <span className="demo-radio__crossing-station-name">{ds.station.name}</span>
          {evidence.kind !== "none" ? (
            <EvidenceSentence
              evidence={evidence}
              stationName={ds.station.name}
              onArtistFocus={onFocusArtist}
              blockedArtists={ds.artistActionExclusions}
              onOpenCrossings={evidence.canOpenCrossings && onOpenStationCrossings
                ? () => onOpenStationCrossings(ds.station.slug)
                : undefined}
            />
          ) : null}
          {evidence.liveContext ? (
            <span className="demo-radio__crossing-station-meta">{evidence.liveContext}</span>
          ) : null}
          {metadata ? (
            <span className="demo-radio__crossing-station-meta">{metadata}</span>
          ) : null}
        </div>
      </article>
    );
  };

  function EvidenceSentence({
    evidence,
    stationName,
    onArtistFocus: focusArtist,
    blockedArtists,
    onOpenCrossings,
  }: {
    evidence: DemoStationEvidence;
    stationName: string;
    onArtistFocus?: (artist: string, artistMbid?: string | null) => void;
    blockedArtists?: string[];
    onOpenCrossings?: () => void;
  }) {
    return (
      <div className="demo-radio__reason demo-radio__reason--featured">
        {onOpenCrossings ? (
          <button
            type="button"
            className="demo-radio__evidence-lead demo-radio__crossings-link"
            onClick={(event) => {
              event.stopPropagation();
              onOpenCrossings();
            }}
            aria-label={`Open every crossing for ${stationName}`}
          >
            {evidence.lead}
          </button>
        ) : (
          <span className="demo-radio__evidence-lead">{evidence.lead}</span>
        )}
        {evidence.artists.length > 0 ? <span aria-hidden="true"> · </span> : null}
        {evidence.artists.map((artist, index) => (
          <span key={`${artist.artistMbid ?? artist.name}:${index}`}>
            {index > 0 ? ", " : null}
            {focusArtist && !blockedArtists?.some(
              (blocked) => normalizeDemoArtist(blocked) === normalizeDemoArtist(artist.name),
            ) ? (
              <button
                type="button"
                className="demo-radio__evidence-artist"
                onClick={(event) => {
                  event.stopPropagation();
                  focusArtist(artist.name, artist.artistMbid);
                }}
              >
                {artist.name}
              </button>
            ) : artist.name}
          </span>
        ))}
        {onOpenCrossings ? (
          <button
            type="button"
            className="demo-radio__crossing-chevron"
            onClick={(event) => {
              event.stopPropagation();
              onOpenCrossings();
            }}
            aria-label={`Open every crossing for ${stationName}`}
          >
            ›
          </button>
        ) : null}
      </div>
    );
  }

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

      {mode === "highlights" && !focusedArtist ? (
        <>
          {broZoneStations.length > 0 ? (
            <>
              <div className="demo-radio__section-label">
                <span>{broZoneLocationLabel ? "Near you (& bros)" : "Bro Zone"}</span>
                {onRequestBroZoneZip ? (
                  <button
                    type="button"
                    className="demo-station-section-action"
                    onClick={onRequestBroZoneZip}
                  >
                    {broZoneLocationLabel ? `${broZoneLocationLabel} · Change ZIP` : "Set ZIP"}
                  </button>
                ) : null}
              </div>
              {(broZoneExpanded ? broZoneStations : broZoneStations.slice(0, 1))
                .map((station) => renderRow(station))}
              {broZoneStations.length > 1 ? (
                <button
                  type="button"
                  className="demo-radio__group-expand"
                  aria-expanded={broZoneExpanded}
                  onClick={() => setBroZoneExpanded((expanded) => !expanded)}
                >
                  {broZoneExpanded
                    ? "Show nearest only"
                    : `Show all ${broZoneStations.length} Bro Zone stations`}
                </button>
              ) : null}
            </>
          ) : null}
          {allCrossings.length > 0 ? (
            <>
              <div className="demo-radio__section-label demo-radio__section-label--secondary">
                <span>For you</span>
                {onEnterAllStations && (
                  <button
                    type="button"
                    onClick={() => onEnterAllStations("overlap")}
                    className="demo-station-section-action"
                  >
                    See all {allCrossings.length}
                  </button>
                )}
              </div>
              {visibleForYou.map((ds) => renderRow(ds))}
            </>
          ) : null}
          {specialistStations.length > 0 ? (
            <>
              <div className="demo-radio__section-label demo-radio__section-label--secondary">
                <span>Specialist sounds</span>
                {onEnterSpecialistStations ? (
                  <button
                    type="button"
                    className="demo-station-section-action"
                    onClick={onEnterSpecialistStations}
                  >
                    See all specialist sounds
                  </button>
                ) : null}
              </div>
              {specialistStations.slice(0, 3).map((station) => renderRow(station))}
            </>
          ) : null}
          {eraStations.length > 0 ? (
            <>
              <div className="demo-radio__section-label demo-radio__section-label--secondary">
                <span>Era / Retro / Oldies</span>
                {onEnterEraStations ? (
                  <button
                    type="button"
                    className="demo-station-section-action"
                    onClick={onEnterEraStations}
                  >
                    See all Era / Retro / Oldies
                  </button>
                ) : null}
              </div>
              {eraStations.map((station) => renderRow(station))}
            </>
          ) : null}
          {visibleRoster.length > 0 ? (
            <>
              <div className="demo-radio__section-label demo-radio__section-label--secondary">
                <span>Beyond your Library</span>
                {onEnterAllStations && (
                  <button
                    type="button"
                    onClick={() => onEnterAllStations("discovery")}
                    className="demo-station-section-action"
                  >
                    See discovery
                  </button>
                )}
              </div>
              {visibleRoster.slice(0, 4).map((ds) => renderRow(ds))}
            </>
          ) : null}
        </>
      ) : orderedStations.length > 0 ? (
        <>
          {orderedStations.map((ds, index) => (
            <div key={ds.station.slug} style={{ display: "contents" }}>
              {rosterStations.length > 0
                && index === orderedStations.length - rosterStations.length ? (
                  <div className="demo-radio__section-label">
                    <span>Beyond your Library</span>
                    <span>Editorial picks</span>
                  </div>
                ) : null}
              {renderRow(ds)}
            </div>
          ))}
        </>
      ) : (
        <div className="demo-radio__empty">
          <p>No stations are available in this view.</p>
        </div>
      )}

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