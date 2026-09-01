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
import type { DialSpin } from "../hooks/useDialData";
import type { LibraryItem } from "../lib/meHooks";
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
const MAX_CROSSING_ALBUMS = 5;

interface MinimalRadioSurfaceProps {
  rows: DialLaneRow[];
  libraryItems: LibraryItem[];
  recentSpinsBySlug?: ReadonlyMap<string, readonly CrossingSpin[]>;
  categoryByStationSlug?: ReadonlyMap<string, StationCategory>;
  preset: RadioPreset;
  activeCategories?: ReadonlySet<StationCategory>;
  onToggleCategory?: (category: StationCategory) => void;
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

interface CrossingSummary {
  count: number;
  label: "this set" | "24 hr" | "7d" | "30d" | "lifetime";
}

function hasCrossingInWindow(row: DialLaneRow, lifetimeOnly: boolean): boolean {
  const track = liveTrack(row);
  const liveHit = Boolean(
    track && !track.resolving && (track.isLibraryHit || track.isArtistHit),
  );
  if (lifetimeOnly) {
    return row.ds.lifetimeCrossings + row.ds.lifetimeArtistCrossings > 0;
  }
  return Boolean(
    liveHit
    || (row.show?.crossings ?? 0) + (row.show?.artistCrossings ?? 0) > 0
    || row.ds.crossings + row.ds.artistCrossings > 0
    || row.ds.weekCrossings + row.ds.weekArtistCrossings > 0
    || row.ds.monthCrossings + row.ds.monthArtistCrossings > 0,
  );
}

function crossingSummary(row: DialLaneRow, lifetimeOnly: boolean): CrossingSummary {
  const track = liveTrack(row);
  const liveHit =
    track && !track.resolving && (track.isLibraryHit || track.isArtistHit) ? 1 : 0;
  const summaries: CrossingSummary[] = [
    {
      // The live pulse can arrive before the schedule's show-spin poll, so
      // preserve a current confirmed hit in the "this set" fallback.
      count: Math.max(
        liveHit,
        (row.show?.crossings ?? 0) + (row.show?.artistCrossings ?? 0),
      ),
      label: "this set",
    },
    { count: row.ds.crossings + row.ds.artistCrossings, label: "24 hr" },
    { count: row.ds.weekCrossings + row.ds.weekArtistCrossings, label: "7d" },
    { count: row.ds.monthCrossings + row.ds.monthArtistCrossings, label: "30d" },
    {
      count: row.ds.lifetimeCrossings + row.ds.lifetimeArtistCrossings,
      label: "lifetime",
    },
  ];
  if (lifetimeOnly) return summaries[summaries.length - 1]!;
  return summaries.find((summary) => summary.count > 0) ?? summaries[summaries.length - 1]!;
}

interface CrossingAlbum {
  key: string;
  href: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
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

type CrossingSpin = Pick<
  DialSpin,
  | "mbid"
  | "artistMbid"
  | "releaseGroupMbid"
  | "title"
  | "artist"
  | "isLibraryHit"
  | "isArtistHit"
  | "resolving"
>;

function crossingAlbums(
  row: DialLaneRow,
  libraryItems: LibraryItem[],
  stationSpins: readonly CrossingSpin[],
  crossing: CrossingSummary,
): CrossingAlbum[] {
  const track = liveTrack(row);
  const crossingSpins = [
    ...(track && !track.resolving && (track.isLibraryHit || track.isArtistHit) ? [track] : []),
    ...stationSpins.filter(
      (spin) => !spin.resolving && (spin.isLibraryHit || spin.isArtistHit),
    ),
    ...[...(row.show?.spins ?? [])]
      .reverse()
      .filter((spin) => !spin.resolving && (spin.isLibraryHit || spin.isArtistHit)),
  ];
  const byMbid = new Map(
    libraryItems
      .filter((item): item is LibraryItem & { mbid: string } => Boolean(item.mbid))
      .map((item) => [item.mbid, item]),
  );
  const byReleaseGroup = new Map(
    libraryItems
      .filter((item) => Boolean(item.recording?.releaseGroupMbid))
      .map((item) => [item.recording!.releaseGroupMbid!, item]),
  );
  const byArtist = new Map<string, LibraryItem[]>();
  for (const item of libraryItems) {
    const recording = item.recording;
    if (!recording?.releaseGroupMbid) continue;
    const key = (recording.artistMbid ?? recording.artist).trim().toLowerCase();
    const matches = byArtist.get(key) ?? [];
    matches.push(item);
    byArtist.set(key, matches);
  }
  const seen = new Set<string>();
  const albums: CrossingAlbum[] = [];
  for (const album of row.ds.albumCrossings ?? []) {
    if (!album.artworkUrl) continue;
    const key = album.releaseGroupMbid ?? album.recordingMbid;
    if (seen.has(key)) continue;
    seen.add(key);
    albums.push({
      key,
      href: album.releaseGroupMbid
        ? `/album/${album.releaseGroupMbid}`
        : `/song/${album.recordingMbid}`,
      title: album.title,
      artist: album.artist,
      artworkUrl: album.artworkUrl,
    });
    if (albums.length >= MAX_CROSSING_ALBUMS) return albums;
  }
  const add = (item: LibraryItem | undefined, spin?: CrossingSpin) => {
    const recording = item?.recording;
    const releaseGroupMbid = spin?.releaseGroupMbid ?? recording?.releaseGroupMbid;
    if (!releaseGroupMbid || seen.has(releaseGroupMbid) || !recording?.artworkUrl) return;
    seen.add(releaseGroupMbid);
    albums.push({
      key: releaseGroupMbid,
      href: `/album/${releaseGroupMbid}`,
      title: recording?.albumTitle ?? recording?.title ?? spin?.title ?? "Album",
      artist: recording?.artist ?? spin?.artist ?? "",
      artworkUrl: recording?.artworkUrl ?? null,
    });
  };

  for (const spin of crossingSpins) {
    if (spin.isLibraryHit) {
      add(
        (spin.releaseGroupMbid ? byReleaseGroup.get(spin.releaseGroupMbid) : undefined)
        ?? (spin.mbid ? byMbid.get(spin.mbid) : undefined),
        spin,
      );
    } else if (spin.isArtistHit) {
      if (spin.releaseGroupMbid) add(byReleaseGroup.get(spin.releaseGroupMbid), spin);
      const artistKey = (spin.artistMbid ?? spin.artist).trim().toLowerCase();
      for (const item of byArtist.get(artistKey) ?? []) add(item);
    }
    if (albums.length >= MAX_CROSSING_ALBUMS) break;
  }

  // Lifetime/older crossing totals do not carry individual historical spins.
  // When no exact recent release is available, use one saved crate album for
  // each server-confirmed crossing artist rather than leaving the section
  // empty or guessing from the current non-crossing track.
  if (albums.length === 0 && crossing.count > 0) {
    const fallbackArtists =
      crossing.label === "24 hr"
        ? row.ds.topArtistNames24h
        : crossing.label === "7d"
          ? row.ds.topArtistNames7d
          : row.ds.topArtistNamesLifetime;
    const usedArtists = new Set<string>();
    for (const artist of fallbackArtists) {
      const key = artist.trim().toLowerCase();
      if (!key || usedArtists.has(key)) continue;
      usedArtists.add(key);
      add(libraryItems.find(
        (item) => item.recording?.artist.trim().toLowerCase() === key,
      ));
      if (albums.length >= MAX_CROSSING_ALBUMS) break;
    }
  }

  return albums.slice(0, MAX_CROSSING_ALBUMS);
}

function firstPlayAlbums(items: readonly HistoryItem[]): CrossingAlbum[] {
  const seen = new Set<string>();
  const albums: CrossingAlbum[] = [];
  for (const item of items) {
    if (!item.mbid || seen.has(item.mbid)) continue;
    seen.add(item.mbid);
    albums.push({
      key: `first-play:${item.id}`,
      href: `/song/${item.mbid}`,
      title: item.title,
      artist: item.artist,
      artworkUrl: item.artworkUrl,
    });
    if (albums.length >= MAX_CROSSING_ALBUMS) break;
  }
  return albums;
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
        <span>{artist}</span>
      </span>
    </button>
  );
}

function MinimalRadioCard({
  row,
  libraryItems,
  stationSpins,
  crossing,
}: {
  row: DialLaneRow;
  libraryItems: LibraryItem[];
  stationSpins: readonly CrossingSpin[];
  crossing: CrossingSummary;
}) {
  const { radio } = usePlayer();
  const [albumsExpanded, setAlbumsExpanded] = useState(false);
  const [firstPlayExpanded, setFirstPlayExpanded] = useState(false);
  const [firstPlayAlbumItems, setFirstPlayAlbumItems] = useState<CrossingAlbum[]>([]);
  const track = liveTrack(row);
  const albums = useMemo(
    () => crossingAlbums(row, libraryItems, stationSpins, crossing),
    [row, libraryItems, stationSpins, crossing],
  );
  useEffect(() => {
    if (typeof fetch !== "function") return;
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    const station = encodeURIComponent(row.ds.station.slug);

    void fetch(
      `/api/player/history?scope=7d&filter=firstPlays&order=desc&limit=${MAX_CROSSING_ALBUMS}&station=${station}`,
      { signal: controller.signal },
    )
      .then((response) => {
        if (!response.ok) throw new Error("first plays unavailable");
        return response.json() as Promise<{ items?: HistoryItem[] }>;
      })
      .then((data) => {
        if (!cancelled) setFirstPlayAlbumItems(firstPlayAlbums(data.items ?? []));
      })
      .catch(() => {
        if (!cancelled) setFirstPlayAlbumItems([]);
      })
      .finally(() => clearTimeout(timeoutId));

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [row.ds.station.slug]);

  const visibleAlbums = albumsExpanded ? albums : albums.slice(0, 1);
  const visibleFirstPlayAlbums = firstPlayExpanded
    ? firstPlayAlbumItems
    : firstPlayAlbumItems.slice(0, 1);
  const playable = resolvePlaybackSource(row.ds.station) != null;
  const isCurrent = radio.station?.slug === row.ds.station.slug;
  const isPlaying = isCurrent && radio.status === "playing";
  const lifetimeCrossingCount = row.ds.lifetimeCrossings + row.ds.lifetimeArtistCrossings;
  const artist = track?.artist?.trim() || "";
  const nowPlayingLabel = !track
    ? "Not broadcasting"
    : artist || "No metadata";

  const play = useCallback(() => {
    if (playable) void radio.toggle(row.ds.station);
  }, [playable, radio, row.ds.station]);

  return (
    <article
      className={`minimal-radio-card${
        (albumsExpanded && albums.length > 0)
        || (firstPlayExpanded && firstPlayAlbumItems.length > 0)
          ? " is-expanded"
          : ""
      }`}
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

        <div className="minimal-radio-card__albums-columns">
          <div className={`minimal-radio-card__album-column minimal-radio-card__album-column--crossings${albumsExpanded ? " is-expanded" : ""}`}>
            <section
              className={`minimal-radio-card__albums${albums.length === 0 ? " is-empty" : ""}`}
              aria-label={albumsExpanded ? "Lifetime crossing album covers" : "Latest crossing album cover"}
            >
              {visibleAlbums.length > 0 ? (
                <div className="minimal-radio-card__album-grid">
                  {visibleAlbums.map((album) => {
                    const artworkUrl = album.artworkUrl ? proxyArtUrl(album.artworkUrl) : null;
                    if (!artworkUrl) return null;
                    return (
                      <a
                        key={album.key}
                        href={album.href}
                        className="minimal-radio-card__album"
                        title={`${album.title} by ${album.artist}`}
                        aria-label={`Open ${album.title} by ${album.artist}`}
                      >
                        <img
                          src={artworkUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={onArtError}
                        />
                        <span className="minimal-radio-card__album-caption">
                          <b>{album.title}</b>
                          <small>{album.artist}</small>
                        </span>
                      </a>
                    );
                  })}
                </div>
              ) : null}
              {albums.length > 0 ? (
                <button
                  type="button"
                  className="minimal-radio-card__crossing"
                  data-testid="minimal-radio-crossing"
                  aria-label={`${lifetimeCrossingCount} lifetime crossings`}
                  aria-expanded={albumsExpanded}
                  onClick={() => setAlbumsExpanded((expanded) => !expanded)}
                >
                  <strong>{lifetimeCrossingCount}</strong>
                </button>
              ) : null}
            </section>
          </div>

          <div className={`minimal-radio-card__album-column minimal-radio-card__album-column--first-plays${firstPlayExpanded ? " is-expanded" : ""}`}>
            <section
              className={`minimal-radio-card__albums${firstPlayAlbumItems.length === 0 ? " is-empty" : ""}`}
              aria-label={firstPlayExpanded ? "First play album covers" : "Latest first play album cover"}
            >
              {visibleFirstPlayAlbums.length > 0 ? (
                <div className="minimal-radio-card__album-grid">
                  {visibleFirstPlayAlbums.map((album) => (
                    <a
                      key={album.key}
                      href={album.href}
                      className="minimal-radio-card__album"
                      title={`${album.title} by ${album.artist}`}
                      aria-label={`Open ${album.title} by ${album.artist}`}
                    >
                      <img
                        src={album.artworkUrl ? (proxyArtUrl(album.artworkUrl) ?? RUMOURS) : RUMOURS}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={onArtError}
                      />
                      <span className="minimal-radio-card__album-caption">
                        <b>{album.title}</b>
                        <small>{album.artist}</small>
                      </span>
                    </a>
                  ))}
                </div>
              ) : null}
              {firstPlayAlbumItems.length > 0 ? (
                <button
                  type="button"
                  className="minimal-radio-card__first-plays"
                  data-testid="minimal-radio-first-plays"
                  aria-label={`${row.ds.lifetimeFirstPlayCrossings} lifetime premieres`}
                  aria-expanded={firstPlayExpanded}
                  onClick={() => setFirstPlayExpanded((expanded) => !expanded)}
                >
                  <strong>{row.ds.lifetimeFirstPlayCrossings}</strong>
                </button>
              ) : null}
            </section>
          </div>
        </div>
      </header>
    </article>
  );
}

function OverviewHistoryView({
  filter,
  title,
  activeCategories,
  focusedCategory,
  categoryByStationSlug,
}: {
  filter: "crossings" | "firstPlays";
  title: string;
  activeCategories: ReadonlySet<StationCategory>;
  focusedCategory: StationCategory | null;
  categoryByStationSlug: ReadonlyMap<string, StationCategory>;
}) {
  const { ride } = usePlayer();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const categoryFilter = useMemo(() => {
    if (focusedCategory) return new Set<StationCategory>([focusedCategory]);
    if (
      activeCategories.size > 0
      && activeCategories.size < STATION_CATEGORY_DEFINITIONS.length
    ) {
      return new Set(activeCategories);
    }
    return null;
  }, [activeCategories, focusedCategory]);
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
  const scopeLabel = focusedCategory
    ? STATION_CATEGORY_DEFINITIONS.find(({ cat }) => cat === focusedCategory)?.label
      ?? focusedCategory
    : "All stations";

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
  const [focusedCategory, setFocusedCategory] = useState<StationCategory | null>(null);
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

  const effectiveFocusedCategory =
    focusedCategory && activeDefs.some(({ cat }) => cat === focusedCategory)
      ? focusedCategory
      : null;
  const showOther =
    effectiveFocusedCategory === null
    && activeCategories.size === 0
    && (groups.get("other")?.length ?? 0) > 0;
  const visibleDefs = effectiveFocusedCategory
    ? activeDefs.filter(({ cat }) => cat === effectiveFocusedCategory)
    : activeDefs;

  return (
    <div className="minimal-radio-overview" data-testid="minimal-radio-overview">
      <nav className="minimal-radio-overview__scope" aria-label="Overview category">
        <button
          type="button"
          className={effectiveFocusedCategory === null ? "is-active" : ""}
          aria-pressed={effectiveFocusedCategory === null}
          onClick={() => setFocusedCategory(null)}
          data-testid="overview-scope-all"
        >
          All
        </button>
        {activeDefs.map((definition) => (
          <button
            type="button"
            key={definition.cat}
            className={effectiveFocusedCategory === definition.cat ? "is-active" : ""}
            aria-pressed={effectiveFocusedCategory === definition.cat}
            onClick={() => setFocusedCategory(definition.cat)}
            data-testid={`overview-scope-${definition.cat}`}
          >
            {definition.shortLabel}
          </button>
        ))}
      </nav>
      <div className="minimal-radio-overview__highlights">
         <OverviewHistoryView
           filter="crossings"
           title="Crossings"
           activeCategories={activeCategories}
           focusedCategory={effectiveFocusedCategory}
           categoryByStationSlug={categoryByStationSlug}
         />
         <OverviewHistoryView
           filter="firstPlays"
           title="Premieres"
           activeCategories={activeCategories}
           focusedCategory={effectiveFocusedCategory}
           categoryByStationSlug={categoryByStationSlug}
         />
      </div>

      <div className="minimal-radio-overview__groups">
         {visibleDefs.map(def => (
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
  libraryItems,
  recentSpinsBySlug = new Map(),
  categoryByStationSlug = new Map(),
  preset: _preset,
  activeCategories = new Set<StationCategory>(),
  onToggleCategory,
  loading = false,
  error = false,
  onRetry,
}: MinimalRadioSurfaceProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [lifetimeOnly, setLifetimeOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"overview" | "cards" | "remote">("overview");
  const [drillDownCategory, setDrillDownCategory] = useState<StationCategory | "other" | null>(null);

  const handleViewMode = (mode: "overview" | "cards" | "remote") => {
    if (mode === "cards" && viewMode !== "cards") {
      setDrillDownCategory(null);
    }
    setViewMode(mode);
  };

  const heroRegionRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef(new Map<string, HTMLDivElement>());
  const candidates = useMemo(
    () => [...rows]
      .filter((row) => (
        (liveTrack(row) != null || row.ds.station.streamUrl != null || row.ds.station.relayUrl != null)
        && hasCrossingInWindow(row, lifetimeOnly)
      )),
    [lifetimeOnly, rows],
  );
  const overviewRows = useMemo(
    () => rows.filter((row) => (
      liveTrack(row) != null
      || row.ds.station.streamUrl != null
      || row.ds.station.relayUrl != null
    )),
    [rows],
  );

  const displayCandidates = useMemo(() => {
    if ((viewMode !== "cards" && viewMode !== "remote") || drillDownCategory === null) return candidates;
    return candidates.filter(row => {
      const cat = row.ds.station.stationCategories?.[0] as StationCategory | undefined;
      const key = cat && STATION_CATEGORY_DEFINITIONS.some(d => d.cat === cat) ? cat : "other";
      return key === drillDownCategory;
    });
  }, [candidates, viewMode, drillDownCategory]);

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

  if (loading && rows.length === 0) {
    return (
      <section className="minimal-radio-state" data-testid="minimal-radio-loading" aria-live="polite">
        <Radio size={24} aria-hidden="true" />
        <h2>Tuning the dial…</h2>
        <p>Finding the live stations that cross your library.</p>
      </section>
    );
  }
  if (error && rows.length === 0) {
    return (
      <section className="minimal-radio-state" data-testid="minimal-radio-error" role="alert">
        <Radio size={24} aria-hidden="true" />
        <h2>The dial couldn’t load.</h2>
        <button type="button" onClick={onRetry}>Try again</button>
      </section>
    );
  }
  if (rows.length === 0) {
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
      <div className="minimal-radio__controls" role="group" aria-label="Radio presets and stations">
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
        <button
          type="button"
          data-testid="radio-preset-lifetime"
          className={`minimal-radio__lifetime-toggle${lifetimeOnly ? " is-active" : ""}`}
          aria-label="Show lifetime crossings"
          aria-pressed={lifetimeOnly}
          onClick={() => setLifetimeOnly((previous) => !previous)}
        >
          {lifetimeOnly ? "Auto" : "Lifetime"}
        </button>
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
          className={`minimal-radio__mode-btn ${viewMode === "remote" ? "is-active" : ""}`}
          onClick={() => handleViewMode("remote")}
          aria-pressed={viewMode === "remote"}
          aria-label="Remote mode"
          data-testid="minimal-radio-remote-toggle"
        >
          <Grid2X2 size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {viewMode !== "overview" && candidates.length === 0 ? (
        <section className="minimal-radio-state" data-testid="minimal-radio-no-candidates">
          <Radio size={24} aria-hidden="true" />
          <h2>Nothing crossed your library in this window.</h2>
          <p>{lifetimeOnly ? "There are no saved crossings in the archive yet." : "Try Lifetime to widen the window."}</p>
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
          {viewMode === "remote" ? (
            <div
              className="minimal-radio__remote-view"
              data-testid="minimal-radio-remote-view"
              role="list"
              aria-label="Compact station remote"
            >
              {displayCandidates.map((row) => (
                <MinimalRadioRemoteTile
                  key={row.ds.station.slug}
                  row={row}
                  selected={row.ds.station.slug === selectedSlug}
                  onSelect={setSelectedSlug}
                />
              ))}
            </div>
          ) : (
            <>
              <div
                className="minimal-radio__sheet-header"
                data-testid="minimal-radio-sheet-header"
                aria-label="Radio insight columns"
              >
                <span aria-hidden="true" />
                <div className="minimal-radio__sheet-header-insights">
                  <span>Crossing</span>
                  <span>Premiere</span>
                </div>
              </div>
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
                    <MinimalRadioCard
                      row={row}
                      libraryItems={libraryItems}
                      stationSpins={recentSpinsBySlug.get(row.ds.station.slug) ?? []}
                      crossing={crossingSummary(row, lifetimeOnly)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}