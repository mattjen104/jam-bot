import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowUpRight, Search, SlidersHorizontal } from "lucide-react";
import { useGetIndex } from "@workspace/api-client-react";

const INDEX_PAGE_LIMIT = 20;
const INDEX_SECTIONS = ["releases", "artists", "stations", "selectors"] as const;
type IndexSection = (typeof INDEX_SECTIONS)[number];
type VisibleSection = IndexSection | "all";
type IndexItem = {
  id: string;
  name: string;
  secondary: string | null;
  href: string | null;
};

const SECTION_LABELS: Record<IndexSection, string> = {
  releases: "Releases",
  artists: "Artists",
  stations: "Stations",
  selectors: "Selectors",
};

type IndexFilters = {
  q?: string;
  artistMbid?: string;
  stationSlug?: string;
};

function useIndexSection(section: IndexSection, filters: IndexFilters) {
  const filterKey = `${section}|${filters.q ?? ""}|${filters.artistMbid ?? ""}|${filters.stationSlug ?? ""}`;
  const [sectionState, setSectionState] = useState<{
    filterKey: string;
    cursor?: string;
    pages: Array<{ key: string; items: IndexItem[] }>;
  }>({ filterKey: "", pages: [] });
  const stateMatches = sectionState.filterKey === filterKey;
  const cursor = stateMatches ? sectionState.cursor : undefined;
  const items = stateMatches ? sectionState.pages.flatMap((page) => page.items) : [];
  const pageKey = cursor ?? "first";

  const params = useMemo(
    () => ({
      section,
      q: filters.q,
      artistMbid: filters.artistMbid,
      stationSlug: filters.stationSlug,
      cursor,
      limit: INDEX_PAGE_LIMIT,
    }),
    [cursor, filters.artistMbid, filters.q, filters.stationSlug, section],
  );
  const query = useGetIndex(params);

  useEffect(() => {
    if (!query.data) return;
    // The paginated query is an external source; this effect folds each
    // completed page into the section snapshot consumed by the view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSectionState((previous) => {
      if (previous.filterKey !== filterKey) {
        return {
          filterKey,
          cursor,
          pages: [{ key: pageKey, items: query.data.items }],
        };
      }
      const existing = previous.pages.findIndex((page) => page.key === pageKey);
      if (
        existing >= 0 &&
        previous.pages[existing]?.items === query.data.items &&
        previous.cursor === cursor
      ) {
        return previous;
      }
      const pages = [...previous.pages];
      if (existing >= 0) pages[existing] = { key: pageKey, items: query.data.items };
      else pages.push({ key: pageKey, items: query.data.items });
      return { filterKey, cursor, pages };
    });
  }, [cursor, filterKey, pageKey, query.data]);

  const loadMore = () => {
    if (query.data?.nextCursor && !query.isFetching) {
      setSectionState((previous) => ({
        filterKey,
        cursor: query.data.nextCursor ?? undefined,
        pages: previous.filterKey === filterKey ? previous.pages : [],
      }));
    }
  };

  return {
    ...query,
    items,
    total: query.data?.total ?? (items.length > 0 ? items.length : 0),
    nextCursor: query.data?.nextCursor ?? null,
    loadMore,
  };
}

function rowTestId(item: IndexItem): string {
  return item.id.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function IndexRow({ item, position }: { item: IndexItem; position: number }) {
  const rowContent = (
    <>
      <span className="index-row__number" aria-hidden="true">
        {String(position).padStart(2, "0")}
      </span>
      <span className="index-row__body">
        <span className="index-row__name" data-testid={`text-index-name-${rowTestId(item)}`}>
          {item.name}
        </span>
        {item.secondary ? (
          <span
            className="index-row__secondary"
            data-testid={`text-index-secondary-${rowTestId(item)}`}
          >
            {item.secondary}
          </span>
        ) : null}
      </span>
      {item.href !== null ? (
        <ArrowUpRight className="index-row__arrow" aria-hidden="true" />
      ) : (
        <span className="index-row__arrow" aria-hidden="true" />
      )}
    </>
  );

  if (item.href !== null) {
    return (
      <Link
        className="index-row"
        href={item.href}
        aria-label={`${item.name}${item.secondary ? `, ${item.secondary}` : ""}`}
        data-testid={`link-index-item-${rowTestId(item)}`}
      >
        {rowContent}
      </Link>
    );
  }

  return (
    <div
      className="index-row index-row--static"
      role="listitem"
      tabIndex={0}
      aria-label={`${item.name}${item.secondary ? `, ${item.secondary}` : ""}; no canonical link`}
      data-testid={`row-index-item-${rowTestId(item)}`}
    >
      {rowContent}
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div data-testid="status-index-loading" aria-label="Loading index section">
      <div className="index-section__skeleton" />
      <div className="index-section__skeleton" />
      <div className="index-section__skeleton" />
    </div>
  );
}

function IndexSectionCard({
  section,
  result,
}: {
  section: IndexSection;
  result: ReturnType<typeof useIndexSection>;
}) {
  const initialLoading = result.isLoading && result.items.length === 0;
  const hasItems = result.items.length > 0;

  return (
    <section
      className="index-section"
      data-section={section}
      aria-labelledby={`index-section-title-${section}`}
      data-testid={`section-index-${section}`}
    >
      <div className="index-section__heading">
        <h2
          className="lore-heading lore-heading--section index-section__title"
          id={`index-section-title-${section}`}
        >
          <span className="index-section__mark" aria-hidden="true" />
          {SECTION_LABELS[section]}
        </h2>
        <span className="index-section__total" data-testid={`text-index-total-${section}`}>
          {result.total.toLocaleString()}
        </span>
      </div>
      <div className="index-section__rule" aria-hidden="true" />

      {initialLoading ? (
        <SectionSkeleton />
      ) : result.isError && !hasItems ? (
        <div
          className="index-section__status index-section__status--error"
          role="alert"
          data-testid={`status-index-error-${section}`}
        >
          <span>Could not load this section.</span>
          <button
            className="index-page__retry"
            type="button"
            onClick={() => void result.refetch()}
            data-testid={`button-retry-index-${section}`}
          >
            Retry
          </button>
        </div>
      ) : !hasItems ? (
        <div
          className="index-section__status index-section__status--empty"
          data-testid={`status-index-empty-${section}`}
        >
          No {SECTION_LABELS[section].toLowerCase()} match these filters.
        </div>
      ) : (
        <>
          <div
            role="list"
            aria-busy={result.isFetching}
            data-testid={`list-index-${section}`}
          >
            {result.items.map((item: IndexItem, index: number) => (
              <IndexRow key={`${item.id}-${index}`} item={item} position={index + 1} />
            ))}
          </div>
          <div className="index-section__footer">
            {result.isError ? (
              <span className="index-section__status--error" role="alert">
                <span>Could not load more.</span>
                <button
                  className="index-page__retry"
                  type="button"
                  onClick={() => void result.refetch()}
                  data-testid={`button-retry-index-more-${section}`}
                >
                  Retry
                </button>
              </span>
            ) : result.nextCursor ? (
              <button
                className="index-page__load"
                type="button"
                onClick={result.loadMore}
                disabled={result.isFetching}
                data-testid={`button-load-index-${section}`}
              >
                {result.isFetching ? "Loading…" : "Load more"}
              </button>
            ) : (
              <span className="index-section__end" data-testid={`status-index-end-${section}`}>
                End of section
              </span>
            )}
            <span className="index-section__end">
              {result.items.length.toLocaleString()} shown
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function readFilters(location: string): {
  filters: IndexFilters;
  section: VisibleSection;
} {
  const search = location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
  const query = new URLSearchParams(search);
  const rawSection = query.get("section");
  const section: VisibleSection =
    rawSection && INDEX_SECTIONS.includes(rawSection as IndexSection)
      ? (rawSection as IndexSection)
      : "all";
  return {
    section,
    filters: {
      q: query.get("q") || undefined,
      artistMbid: query.get("artistMbid") || undefined,
      stationSlug: query.get("stationSlug") || undefined,
    },
  };
}

export default function Index() {
  const [location, setLocation] = useLocation();
  const { filters, section: activeSection } = useMemo(
    () => readFilters(location),
    [location],
  );
  const releases = useIndexSection("releases", filters);
  const artists = useIndexSection("artists", filters);
  const stations = useIndexSection("stations", filters);
  const selectors = useIndexSection("selectors", filters);
  const results: Record<IndexSection, ReturnType<typeof useIndexSection>> = {
    releases,
    artists,
    stations,
    selectors,
  };

  useEffect(() => {
    document.title = "Index · Lore";
  }, []);

  const setParam = (name: string, value: string) => {
    const pathname = location.split("?")[0] ?? "/";
    const queryString = location.includes("?")
      ? location.slice(location.indexOf("?") + 1)
      : "";
    const query = new URLSearchParams(queryString);
    if (value.trim()) query.set(name, value.trim());
    else query.delete(name);
    const next = query.toString();
    setLocation(`${pathname}${next ? `?${next}` : ""}`);
  };

  const setSection = (nextSection: VisibleSection) => {
    setParam("section", nextSection === "all" ? "" : nextSection);
  };

  const clearFilters = () => {
    const pathname = location.split("?")[0] ?? "/";
    const query = new URLSearchParams(
      location.includes("?") ? location.slice(location.indexOf("?") + 1) : "",
    );
    query.delete("q");
    query.delete("artistMbid");
    query.delete("stationSlug");
    query.delete("section");
    const next = query.toString();
    setLocation(`${pathname}${next ? `?${next}` : ""}`);
  };

  const count = (key: IndexSection) => results[key].total.toLocaleString();
  const activeResults =
    activeSection === "all" ? INDEX_SECTIONS.map((key) => results[key]) : [results[activeSection]];
  const hasActiveFilter = Boolean(
    filters.q || filters.artistMbid || filters.stationSlug || activeSection !== "all",
  );

  return (
    <main className="index-page" data-testid="page-index">
      <div className="index-page__inner">
        <header className="index-page__masthead">
          <div>
            <p className="index-page__eyebrow">Lore / public directory</p>
            <h1 className="lore-heading lore-heading--page index-page__title">Index</h1>
            <p className="index-page__dek">
              The canonical map of the records, artists, stations, and selectors
              gathered by the dial.
            </p>
          </div>
          <div className="index-page__stamp" data-testid="text-index-summary">
            <strong>
              {INDEX_SECTIONS.reduce((sum, key) => sum + results[key].total, 0).toLocaleString()}
            </strong>
            <span>known entries</span>
          </div>
        </header>

        <div className="index-page__controls" role="search" aria-label="Filter the Lore index">
          <label className="index-page__input-wrap">
            <Search className="index-page__input-icon" aria-hidden="true" />
            <span className="sr-only">Search the index</span>
            <input
              className="index-page__input index-page__input--search"
              type="search"
              value={filters.q ?? ""}
              onChange={(event) => setParam("q", event.target.value)}
              placeholder="Search names and metadata"
              data-testid="input-index-q"
            />
          </label>
          <label className="index-page__input-wrap">
            <span className="sr-only">Filter by artist MBID</span>
            <input
              className="index-page__input"
              type="text"
              value={filters.artistMbid ?? ""}
              onChange={(event) => setParam("artistMbid", event.target.value)}
              placeholder="Artist MBID"
              spellCheck={false}
              data-testid="input-index-artist-mbid"
            />
          </label>
          <label className="index-page__input-wrap">
            <span className="sr-only">Filter by station slug</span>
            <input
              className="index-page__input"
              type="text"
              value={filters.stationSlug ?? ""}
              onChange={(event) => setParam("stationSlug", event.target.value)}
              placeholder="Station slug"
              spellCheck={false}
              data-testid="input-index-station-slug"
            />
          </label>
        </div>

        <div className="index-page__filters">
          <span className="index-page__filter-note">
            <SlidersHorizontal aria-hidden="true" />
            URL-backed filters · 20 entries per request
          </span>
          {hasActiveFilter ? (
            <button
              className="index-page__clear"
              type="button"
              onClick={clearFilters}
              data-testid="button-clear-index-filters"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <nav className="index-page__tabs" aria-label="Index sections">
          <button
            className={`index-page__tab${activeSection === "all" ? " index-page__tab--active" : ""}`}
            type="button"
            onClick={() => setSection("all")}
            aria-current={activeSection === "all" ? "page" : undefined}
            data-testid="button-index-section-all"
          >
            All <span className="index-page__tab-count">{INDEX_SECTIONS.reduce((sum, key) => sum + results[key].total, 0).toLocaleString()}</span>
          </button>
          {INDEX_SECTIONS.map((key) => (
            <button
              className={`index-page__tab${activeSection === key ? " index-page__tab--active" : ""}`}
              type="button"
              key={key}
              onClick={() => setSection(key)}
              aria-current={activeSection === key ? "page" : undefined}
              data-testid={`button-index-section-${key}`}
            >
              {SECTION_LABELS[key]} <span className="index-page__tab-count">{count(key)}</span>
            </button>
          ))}
        </nav>

        <div
          className={`index-page__grid${activeSection === "all" ? "" : " index-page__grid--single"}`}
          data-testid="index-sections-grid"
        >
          {activeSection === "all"
            ? INDEX_SECTIONS.map((key) => (
                <IndexSectionCard key={key} section={key} result={results[key]} />
              ))
            : activeResults.map((result) => (
                <IndexSectionCard
                  key={activeSection}
                  section={activeSection}
                  result={result}
                />
              ))}
        </div>
      </div>
    </main>
  );
}