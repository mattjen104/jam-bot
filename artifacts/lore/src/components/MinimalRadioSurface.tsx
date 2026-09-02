import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Grid2X2, Radio, SlidersHorizontal, LayoutList, GalleryVerticalEnd } from "lucide-react";
import type { DialLaneRow } from "./dial/DialFeedLane";
import { proxyArtUrl } from "../lib/proxyArt";
import { RUMOURS, onArtError } from "../lib/rumours";
import { usePlayer } from "../player/PlayerProvider";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { FilterDropdownMenu } from "./dial/FilterDropdownMenu";
import {
  STATION_CATEGORY_DEFINITIONS,
  type StationCategory,
} from "../lib/dialCategories";

export type RadioPreset = "now" | "lifetime";

const STATION_CATEGORY_OPTIONS = STATION_CATEGORY_DEFINITIONS.map(
  ({ cat, label, title }) => ({ value: cat, label, title }),
);
const REMOTE_PAGE_SIZE = 2;

interface MinimalRadioSurfaceProps {
  /** Selected station pool for the overview and sentence-card views. */
  rows: DialLaneRow[];
  /** Full station pool for the compact remote. */
  remoteRows?: DialLaneRow[];
  categoryByStationSlug?: ReadonlyMap<string, StationCategory>;
  preset: RadioPreset;
  activeCategories?: ReadonlySet<StationCategory>;
  onToggleCategory?: (category: StationCategory) => void;
  onSetCategories?: (categories: ReadonlySet<StationCategory>) => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

function liveTrack(row: DialLaneRow) {
  return row.ds.liveTrack ?? row.show?.currentTrack ?? null;
}

function stationCity(station: { city?: string | null }): string | null {
  return station.city?.trim() || null;
}

interface HistoryItem {
  id: number;
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  releaseYear?: number | null;
  releaseDate?: string | null;
  playedAt?: string;
  station: { slug: string; name: string };
}

function MinimalRadioRemoteTile({
  row,
  selected,
  onSelect,
}: {
  row: DialLaneRow;
  selected: boolean;
  onSelect: (slug: string) => void;
}) {
  const { radio } = usePlayer();
  const [logoFailed, setLogoFailed] = useState(false);
  const track = liveTrack(row);
  const artist = track?.artist?.trim() || "Not broadcasting";
  const station = row.ds.station;
  const playable = resolvePlaybackSource(station) != null;

  const tune = () => {
    onSelect(station.slug);
    if (playable) void radio.toggle(station);
  };

  return (
    <button
      type="button"
      className={`minimal-radio__remote-station${selected ? " is-selected" : ""}`}
      data-testid="minimal-radio-remote-station"
      aria-label={`${station.name}: ${artist}`}
      aria-pressed={selected}
      disabled={!playable}
      onClick={tune}
    >
      <span className="minimal-radio__remote-mark" aria-hidden="true">
        {station.logoUrl && !logoFailed ? (
          <img
            src={station.logoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span>{station.name}</span>
        )}
      </span>
      <span className="minimal-radio__remote-copy">
        <span className="minimal-radio__remote-station-name" title={station.name}>
          {station.name}
        </span>
        <span className="minimal-radio__remote-artist" title={artist}>
          {artist}
        </span>
      </span>
    </button>
  );
}

function MinimalRadioCard({ row }: { row: DialLaneRow }) {
  const { radio } = usePlayer();
  const track = liveTrack(row);
  const playable = resolvePlaybackSource(row.ds.station) != null;
  const isCurrent = radio.station?.slug === row.ds.station.slug;
  const isPlaying = isCurrent && radio.status === "playing";
  const stationBlurb = row.ds.station.homepageBlurb?.trim() || null;
  const artist = track?.artist?.trim() || "";
  const nowPlayingLabel = !track
    ? "Not broadcasting"
    : artist || "No metadata";

  const play = useCallback(() => {
    if (playable) void radio.toggle(row.ds.station);
  }, [playable, radio, row.ds.station]);

  return (
    <article
      className="minimal-radio-card"
      data-testid="minimal-radio-card"
      aria-label={`${row.ds.station.name} station card`}
    >
      <header className="minimal-radio-card__station-line">
        <div className="minimal-radio-card__station-copy">
          <div className="minimal-radio-card__station-heading">
            <div className="minimal-radio-card__station-identity">
              <h2 aria-label={row.ds.station.name}>{row.ds.station.name}</h2>
              {stationCity(row.ds.station) ? <span>{stationCity(row.ds.station)}</span> : null}
            </div>
          </div>
          <button
            type="button"
            className={`minimal-radio-card__now${!track ? " is-empty" : ""}`}
            disabled={!playable}
            onClick={play}
            aria-label={isPlaying ? `Pause ${row.ds.station.name}` : `Tune in to ${row.ds.station.name}`}
          >
            <span className="minimal-radio-card__now-label">Now</span>
            <span className="minimal-radio-card__now-copy">
              {nowPlayingLabel}
            </span>
          </button>
        </div>
        <div className="minimal-radio-card__station-blurb" data-testid="minimal-radio-card-blurb">
          {stationBlurb ? <p>{stationBlurb}</p> : null}
        </div>
      </header>
    </article>
  );
}

function OverviewHistoryView({
  filter,
  title,
  activeCategories,
  categoryByStationSlug,
}: {
  filter: "crossings" | "firstPlays";
  title: string;
  activeCategories: ReadonlySet<StationCategory>;
  categoryByStationSlug: ReadonlyMap<string, StationCategory>;
}) {
  const { ride } = usePlayer();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const categoryFilter = useMemo(() => {
    if (
      activeCategories.size > 0
      && activeCategories.size < STATION_CATEGORY_DEFINITIONS.length
    ) {
      return new Set(activeCategories);
    }
    return null;
  }, [activeCategories]);
  const categoryKey = categoryFilter
    ? [...categoryFilter].sort().join(",")
    : "";
  const requestUrl = filter === "firstPlays"
    ? `/api/player/history?scope=7d&filter=firstPlays&order=desc&limit=18&home=1${
      categoryKey ? `&categories=${encodeURIComponent(categoryKey)}` : ""
    }`
    : `/api/player/history?scope=7d&filter=crossings&order=desc&limit=60${
      categoryKey ? `&categories=${encodeURIComponent(categoryKey)}` : ""
    }`;

  useEffect(() => {
    if (typeof fetch !== "function") return;
    let cancelled = false;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);

    void fetch(requestUrl, {
      signal: controller.signal
    })
      .then(res => {
        if (!res.ok) throw new Error("history unavailable");
        return res.json() as Promise<{ items?: HistoryItem[] }>;
      })
      .then(data => {
        if (!cancelled) {
          setItems(data.items ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
      })
      .finally(() => clearTimeout(timeoutId));

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [requestUrl]);

  const visibleItems = categoryFilter
    ? items.filter((item) => {
        const category = categoryByStationSlug.get(item.station.slug);
        return category ? categoryFilter.has(category) : false;
      })
    : items;
  const scopeLabel = categoryFilter ? "Filtered stations" : "All stations";

  return (
    <section
      className="overview-history"
      data-testid={`overview-history-${filter}`}
      aria-label={`${title}, ${scopeLabel}`}
    >
      <header className="overview-history__heading">
        <h3 className="overview-history__title">{title}</h3>
        <span className="overview-history__context">{scopeLabel}</span>
      </header>
      <div className="overview-history__scroll">
        {loading ? (
          <div className="overview-history__skeleton">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overview-history__skeleton-card" />
            ))}
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="overview-history__empty">
            No {filter === "crossings" ? "crossings" : "premieres"} in this view yet.
          </p>
        ) : (
          visibleItems.map(item => {
            const category = categoryByStationSlug.get(item.station.slug);
            const categoryLabel = category
              ? STATION_CATEGORY_DEFINITIONS.find(({ cat }) => cat === category)?.shortLabel
              : null;
            return (
            <button
              type="button"
              key={item.id}
              className="overview-history__card"
              data-testid={`overview-history-${filter}-item`}
              aria-label={`Preview ${item.artist} — ${item.title}, heard on ${item.station.name}${
                categoryLabel ? ` in ${categoryLabel}` : ""
              }`}
              onClick={() => {
                ride.startReplay(
                  [{
                    mbid: item.mbid,
                    title: item.title,
                    artist: item.artist,
                    artworkUrl: item.artworkUrl,
                    links: [],
                  }],
                  `Historical · ${item.station.name}`,
                  { timeOrientation: "curated", previewOnly: true, previewDwellMs: 7_000 }
                );
              }}
            >
              <img
                src={item.artworkUrl ? proxyArtUrl(item.artworkUrl) || RUMOURS : RUMOURS}
                alt=""
                loading="lazy"
                onError={onArtError}
              />
              <div className="overview-history__card-text">
                <span className="overview-history__card-artist">{item.artist}</span>
                <span className="overview-history__card-title">{item.title}</span>
                <span className="overview-history__card-provenance">
                  <span className="overview-history__card-station">{item.station.name}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{categoryLabel ?? "Category unavailable"}</span>
                </span>
              </div>
            </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function OverviewStationRow({ row }: { row: DialLaneRow }) {
  const { radio } = usePlayer();
  const [logoFailed, setLogoFailed] = useState(false);
  const track = liveTrack(row);
  const artist = track?.artist?.trim() || "Not broadcasting";
  const playable = resolvePlaybackSource(row.ds.station) != null;
  const isPlaying =
    radio.station?.slug === row.ds.station.slug && radio.status === "playing";
  const showLogo = Boolean(row.ds.station.logoUrl) && !logoFailed;

  return (
    <button
      type="button"
      className={`overview-row ${isPlaying ? "is-playing" : ""}`}
      onClick={() => playable && void radio.toggle(row.ds.station)}
      disabled={!playable}
      aria-label={`Tune in to ${row.ds.station.name}, playing ${artist}`}
      aria-pressed={isPlaying}
    >
      <span className="overview-row__station">
        <span className="overview-row__mark" aria-hidden="true">
          {showLogo ? (
            <img
              src={row.ds.station.logoUrl ?? ""}
              className="overview-row__logo"
              alt=""
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <span className="overview-row__logo-fallback">{row.ds.station.name}</span>
          )}
        </span>
        <span className="overview-row__name">{row.ds.station.name}</span>
      </span>
      <span className="overview-row__artist">{artist}</span>
    </button>
  );
}

function OverviewCategoryGroup({
  category,
  title,
  rows,
  onDrillDown
}: {
  category: StationCategory | "other";
  title: string;
  rows: DialLaneRow[];
  onDrillDown: () => void;
}) {
  return (
    <section className="overview-group" data-testid={`overview-category-${category}`}>
      <header className="overview-group__header">
        <div>
          <h3 className="overview-group__title">{title}</h3>
          <span className="overview-group__count">
            {rows.length} {rows.length === 1 ? "station" : "stations"} now
          </span>
        </div>
        <button type="button" className="overview-group__drilldown" onClick={onDrillDown} aria-label={`View ${title} cards`}>
          Cards
        </button>
      </header>
      <div className="overview-group__rows">
        {rows.map((row) => (
          <OverviewStationRow key={row.ds.station.slug} row={row} />
        ))}
      </div>
    </section>
  );
}

function MinimalRadioOverview({
  rows,
  activeCategories,
  categoryByStationSlug,
  onDrillDown,
}: {
  rows: DialLaneRow[];
  activeCategories: ReadonlySet<StationCategory>;
  categoryByStationSlug: ReadonlyMap<string, StationCategory>;
  onDrillDown: (category: StationCategory | "other" | null) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<StationCategory | "other", DialLaneRow[]>();
    for (const row of rows) {
      const cat = row.ds.station.stationCategories?.[0] as StationCategory | undefined;
      const key = cat && STATION_CATEGORY_DEFINITIONS.some(d => d.cat === cat) ? cat : "other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return map;
  }, [rows]);

  const activeDefs = useMemo(
    () => STATION_CATEGORY_DEFINITIONS.filter(def =>
      (activeCategories.size === 0 || activeCategories.has(def.cat)) &&
      (groups.get(def.cat)?.length ?? 0) > 0
    ),
    [activeCategories, groups],
  );

  const showOther =
    activeCategories.size === 0
    && (groups.get("other")?.length ?? 0) > 0;

  return (
    <div className="minimal-radio-overview" data-testid="minimal-radio-overview">
      <div className="minimal-radio-overview__highlights">
         <OverviewHistoryView
           filter="crossings"
           title="Crossings"
           activeCategories={activeCategories}
           categoryByStationSlug={categoryByStationSlug}
         />
         <OverviewHistoryView
           filter="firstPlays"
           title="Premieres"
           activeCategories={activeCategories}
           categoryByStationSlug={categoryByStationSlug}
         />
      </div>

      <div className="minimal-radio-overview__groups">
          {activeDefs.map(def => (
           <OverviewCategoryGroup
             key={def.cat}
             category={def.cat}
             title={def.label}
             rows={groups.get(def.cat)!}
             onDrillDown={() => onDrillDown(def.cat)}
           />
         ))}
         {showOther && (
           <OverviewCategoryGroup
             category="other"
             title="Other Stations"
             rows={groups.get("other")!}
             onDrillDown={() => onDrillDown("other")}
           />
         )}
      </div>
    </div>
  );
}

export function MinimalRadioSurface({
  rows,
  remoteRows = rows,
  categoryByStationSlug = new Map(),
  preset: _preset,
  activeCategories = new Set<StationCategory>(),
  onToggleCategory,
  onSetCategories,
  loading = false,
  error = false,
  onRetry,
}: MinimalRadioSurfaceProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"overview" | "cards">("overview");
  const [remoteExpanded, setRemoteExpanded] = useState(false);
  const [drillDownCategory, setDrillDownCategory] = useState<StationCategory | "other" | null>(null);

  const handleViewMode = (mode: "overview" | "cards") => {
    if (mode === "cards" && viewMode !== "cards") {
      setDrillDownCategory(null);
    }
    setRemoteExpanded(false);
    setViewMode(mode);
  };

  const heroRegionRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef(new Map<string, HTMLDivElement>());
  const candidates = useMemo(
    () => rows.filter((row) => (
      liveTrack(row) != null
      || row.ds.station.streamUrl != null
      || row.ds.station.relayUrl != null
    )),
    [rows],
  );
  const overviewRows = candidates;

  const displayCandidates = useMemo(() => {
    if (viewMode !== "cards" || drillDownCategory === null) return candidates;
    return candidates.filter(row => {
      const cat = row.ds.station.stationCategories?.[0] as StationCategory | undefined;
      const key = cat && STATION_CATEGORY_DEFINITIONS.some(d => d.cat === cat) ? cat : "other";
      return key === drillDownCategory;
    });
  }, [candidates, viewMode, drillDownCategory]);
  const remoteDisplayRows = remoteRows;
  const remotePages = useMemo(() => {
    const pages: DialLaneRow[][] = [];
    for (let index = 0; index < remoteDisplayRows.length; index += REMOTE_PAGE_SIZE) {
      pages.push(remoteDisplayRows.slice(index, index + REMOTE_PAGE_SIZE));
    }
    return pages;
  }, [remoteDisplayRows]);

  const selectedIndex = Math.max(
    0,
    displayCandidates.findIndex((row) => row.ds.station.slug === selectedSlug),
  );

  const selectStation = useCallback((index: number) => {
    const next = displayCandidates[index];
    if (!next) return;
    setSelectedSlug(next.ds.station.slug);
    const slide = slideRefs.current.get(next.ds.station.slug);
    heroRegionRef.current?.scrollTo?.({
      top: slide?.offsetTop ?? 0,
      behavior: "auto",
    });
  }, [displayCandidates]);

  const selectOffset = useCallback((offset: number) => {
    if (displayCandidates.length === 0) return;
    const nextIndex = (selectedIndex + offset + displayCandidates.length) % displayCandidates.length;
    selectStation(nextIndex);
  }, [displayCandidates.length, selectStation, selectedIndex]);

  const handleHeroKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectOffset(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectOffset(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectStation(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectStation(displayCandidates.length - 1);
    }
  }, [displayCandidates.length, selectOffset, selectStation]);

  const handleHeroScroll = useCallback(() => {
    const container = heroRegionRef.current;
    if (!container) return;
    if (
      displayCandidates.length > 0
      && container.scrollTop + container.clientHeight >= container.scrollHeight - 2
    ) {
      const last = displayCandidates[displayCandidates.length - 1]!;
      if (last.ds.station.slug !== selectedSlug) setSelectedSlug(last.ds.station.slug);
      return;
    }
    let closestIndex = selectedIndex;
    let closestDistance = Number.POSITIVE_INFINITY;
    displayCandidates.forEach((row, index) => {
      const slide = slideRefs.current.get(row.ds.station.slug);
      if (!slide) return;
      const distance = Math.abs(slide.offsetTop - container.scrollTop);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    const next = displayCandidates[closestIndex];
    if (next && next.ds.station.slug !== selectedSlug) setSelectedSlug(next.ds.station.slug);
  }, [displayCandidates, selectedIndex, selectedSlug]);

  if (loading && rows.length === 0 && remoteRows.length === 0) {
    return (
      <section className="minimal-radio-state" data-testid="minimal-radio-loading" aria-live="polite">
        <Radio size={24} aria-hidden="true" />
        <h2>Tuning the dial…</h2>
        <p>Finding the live stations that cross your library.</p>
      </section>
    );
  }
  if (error && rows.length === 0 && remoteRows.length === 0) {
    return (
      <section className="minimal-radio-state" data-testid="minimal-radio-error" role="alert">
        <Radio size={24} aria-hidden="true" />
        <h2>The dial couldn’t load.</h2>
        <button type="button" onClick={onRetry}>Try again</button>
      </section>
    );
  }
  if (rows.length === 0 && remoteRows.length === 0) {
    return (
      <section className="minimal-radio-state" data-testid="minimal-radio-empty">
        <Radio size={24} aria-hidden="true" />
        <h2>Nothing is on the air right now.</h2>
        <p>Try again in a moment, or open the full Feed to browse every station.</p>
      </section>
    );
  }
  return (
    <section className="minimal-radio" data-testid="minimal-radio-surface">
      <div className="minimal-radio__controls" role="group" aria-label="Radio filters and stations">
        {onToggleCategory ? (
          <FilterDropdownMenu
            label="Station type"
            ariaLabel="Station categories"
            options={STATION_CATEGORY_OPTIONS}
            active={activeCategories}
            onToggle={onToggleCategory}
            variant="chips"
            className="minimal-radio__category-filter"
          />
        ) : null}
      </div>
      {onToggleCategory ? (
        <div className="minimal-radio__floating-filter">
          <FilterDropdownMenu
            label="Filter"
            ariaLabel="Station categories"
            options={STATION_CATEGORY_OPTIONS}
            active={activeCategories}
            onToggle={onToggleCategory}
            variant="chips"
            leadingIcon={<SlidersHorizontal size={21} strokeWidth={2.2} />}
          />
        </div>
      ) : null}
      {onToggleCategory && onSetCategories ? (
        <>
          <nav
            className="minimal-radio__remote-categories"
            aria-label="Filter compact stations by station type"
          >
            <button
              type="button"
              className={activeCategories.size === 0 ? "is-active" : ""}
              aria-pressed={activeCategories.size === 0}
              onClick={() => onSetCategories(new Set())}
              data-testid="minimal-radio-remote-category-all"
            >
              All
            </button>
            {STATION_CATEGORY_DEFINITIONS.map((definition) => (
              <button
                type="button"
                key={definition.cat}
                className={activeCategories.has(definition.cat) ? "is-active" : ""}
                aria-pressed={activeCategories.has(definition.cat)}
                onClick={() => onSetCategories(new Set([definition.cat]))}
                data-testid={`minimal-radio-remote-category-${definition.cat}`}
              >
                {definition.shortLabel}
              </button>
            ))}
          </nav>
          <div
            className="minimal-radio__remote-count"
            data-testid="minimal-radio-remote-count"
            aria-live="polite"
          >
            {remoteDisplayRows.length} {remoteDisplayRows.length === 1 ? "station" : "stations"} selected
          </div>
        </>
      ) : null}
      {onSetCategories && remoteExpanded ? (
        <div
          className={`minimal-radio__remote-view minimal-radio__remote-view--fixture${remoteExpanded ? " is-expanded" : ""}`}
          data-testid="minimal-radio-remote-view"
          role="list"
          aria-label={remoteExpanded ? "Expanded compact station remote" : "Compact station preview"}
        >
          {remotePages.map((page, pageIndex) => (
            <div
              key={pageIndex}
              className="minimal-radio__remote-page"
              data-testid="minimal-radio-remote-page"
              role="list"
              aria-label={`Compact station panel ${pageIndex + 1} of ${remotePages.length}`}
            >
              {page.map((row) => (
                <MinimalRadioRemoteTile
                  key={row.ds.station.slug}
                  row={row}
                  selected={row.ds.station.slug === selectedSlug}
                  onSelect={setSelectedSlug}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div className="minimal-radio__view-modes" role="group" aria-label="View modes">
        <button
          type="button"
          className={`minimal-radio__mode-btn ${viewMode === "overview" ? "is-active" : ""}`}
          onClick={() => handleViewMode("overview")}
          aria-pressed={viewMode === "overview"}
          aria-label="Overview mode"
          data-testid="minimal-radio-overview-toggle"
        >
          <LayoutList size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`minimal-radio__mode-btn ${viewMode === "cards" ? "is-active" : ""}`}
          onClick={() => handleViewMode("cards")}
          aria-pressed={viewMode === "cards"}
          aria-label="Cards mode"
          data-testid="minimal-radio-cards-toggle"
        >
          <GalleryVerticalEnd size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`minimal-radio__mode-btn ${remoteExpanded ? "is-active" : ""}`}
          onClick={() => setRemoteExpanded((expanded) => !expanded)}
          aria-pressed={remoteExpanded}
          aria-label={remoteExpanded ? "Collapse compact stations" : "Expand compact stations"}
          data-testid="minimal-radio-remote-toggle"
        >
          <Grid2X2 size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {remoteExpanded ? null : viewMode === "cards" && candidates.length === 0 ? (
        <section className="minimal-radio-state" data-testid="minimal-radio-no-candidates">
          <Radio size={24} aria-hidden="true" />
          <h2>No live stations available in this view.</h2>
          <p>Try again in a moment, or use the compact station remote above.</p>
        </section>
      ) : viewMode === "overview" ? (
        <MinimalRadioOverview
          rows={overviewRows}
          activeCategories={activeCategories}
          categoryByStationSlug={categoryByStationSlug}
          onDrillDown={(cat) => {
            setDrillDownCategory(cat);
            setViewMode("cards");
          }}
        />
      ) : (
        <div className="minimal-radio__hero-frame">
          <div
            ref={heroRegionRef}
            className="minimal-radio__hero-region"
            data-testid="minimal-radio-hero"
            role="region"
            aria-label="Live station cards"
            tabIndex={0}
            onKeyDown={handleHeroKeyDown}
            onScroll={handleHeroScroll}
          >
            {displayCandidates.map((row, index) => (
              <div
                key={row.ds.station.slug}
                ref={(node) => {
                  if (node) slideRefs.current.set(row.ds.station.slug, node);
                  else slideRefs.current.delete(row.ds.station.slug);
                }}
                className="minimal-radio__hero-slide"
                data-testid={`minimal-radio-hero-card-${row.ds.station.slug}`}
                role="group"
                aria-label={`${row.ds.station.name} now-playing hero${selectedIndex === index ? ", selected" : ""}`}
                aria-hidden={selectedIndex !== index}
                inert={selectedIndex !== index ? true : undefined}
              >
                <MinimalRadioCard row={row} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}