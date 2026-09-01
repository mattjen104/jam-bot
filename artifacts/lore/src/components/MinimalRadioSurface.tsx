import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Radio, SlidersHorizontal } from "lucide-react";
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

function crossingRecency(row: DialLaneRow, crossing: CrossingSummary): {
  label: string;
  live: boolean;
} {
  const track = liveTrack(row);
  if (track && !track.resolving && (track.isLibraryHit || track.isArtistHit)) {
    return { label: "NOW", live: true };
  }
  switch (crossing.label) {
    case "this set":
      return { label: "∩ THIS SET", live: false };
    case "24 hr":
      return { label: "∩ 1 DAY AGO", live: false };
    case "7d":
      return { label: "∩ 7 DAYS AGO", live: false };
    case "30d":
      return { label: "∩ 30 DAYS AGO", live: false };
    default:
      return { label: "∩ LIFETIME", live: false };
  }
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

interface FirstPlayHistoryItem {
  id: number;
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
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

function firstPlayAlbums(items: readonly FirstPlayHistoryItem[]): CrossingAlbum[] {
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
        return response.json() as Promise<{ items?: FirstPlayHistoryItem[] }>;
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
  const recency = crossingRecency(row, crossing);
  const artist = track?.artist?.trim() || "";
  const title = track?.title?.trim() || "";
  const nowPlayingLabel = !track
    ? "Not broadcasting"
    : artist || title
      ? `${artist}${artist && title ? " — " : ""}${title}`
      : "No metadata";

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
        <div className="minimal-radio-card__station-column">
          <div className="minimal-radio-card__station-identity">
            <h2 aria-label={row.ds.station.name}>{row.ds.station.name}</h2>
            {stationCity(row.ds.station) ? (
              <span>{stationCity(row.ds.station)}</span>
            ) : null}
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
              {track && artist && title ? (
                <>
                  <strong>{artist}</strong>
                  <span> — {title}</span>
                </>
              ) : (
                nowPlayingLabel
              )}
            </span>
          </button>
        </div>
        <div className="minimal-radio-card__albums-columns">
          <div className={`minimal-radio-card__album-column minimal-radio-card__album-column--crossings${albumsExpanded ? " is-expanded" : ""}`}>
            <button
              type="button"
              className={`minimal-radio-card__crossing${recency.live ? " is-live" : ""}`}
              data-testid="minimal-radio-crossing"
              aria-label={`${crossing.count} ${crossing.count === 1 ? "crossing" : "crossings"}, ${crossing.label}`}
              aria-expanded={albumsExpanded}
              disabled={albums.length === 0}
              onClick={() => setAlbumsExpanded((expanded) => !expanded)}
            >
              {recency.live ? <i aria-hidden="true" /> : null}
              <strong>{crossing.count}</strong>
              <span>{crossing.count === 1 ? "crossing" : "crossings"} · {crossing.label}</span>
            </button>

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
            </section>
          </div>

          <div className={`minimal-radio-card__album-column minimal-radio-card__album-column--first-plays${firstPlayExpanded ? " is-expanded" : ""}`}>
            <button
              type="button"
              className="minimal-radio-card__first-plays"
              data-testid="minimal-radio-first-plays"
              aria-label={`${row.ds.lifetimeFirstPlayCrossings} first plays, lifetime`}
              aria-expanded={firstPlayExpanded}
              disabled={firstPlayAlbumItems.length === 0}
              onClick={() => setFirstPlayExpanded((expanded) => !expanded)}
            >
              <strong>{row.ds.lifetimeFirstPlayCrossings}</strong>
              <span>first plays · lifetime</span>
            </button>

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
            </section>
          </div>
        </div>
      </header>
    </article>
  );
}

export function MinimalRadioSurface({
  rows,
  libraryItems,
  recentSpinsBySlug = new Map(),
  preset: _preset,
  activeCategories = new Set<StationCategory>(),
  onToggleCategory,
  loading = false,
  error = false,
  onRetry,
}: MinimalRadioSurfaceProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [lifetimeOnly, setLifetimeOnly] = useState(false);
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
  const selectedIndex = Math.max(
    0,
    candidates.findIndex((row) => row.ds.station.slug === selectedSlug),
  );
  const selectStation = useCallback((index: number) => {
    const next = candidates[index];
    if (!next) return;
    setSelectedSlug(next.ds.station.slug);
    const slide = slideRefs.current.get(next.ds.station.slug);
    heroRegionRef.current?.scrollTo?.({
      top: slide?.offsetTop ?? 0,
      behavior: "auto",
    });
  }, [candidates]);

  const selectOffset = useCallback((offset: number) => {
    if (candidates.length === 0) return;
    const nextIndex = (selectedIndex + offset + candidates.length) % candidates.length;
    selectStation(nextIndex);
  }, [candidates.length, selectStation, selectedIndex]);

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
      selectStation(candidates.length - 1);
    }
  }, [candidates.length, selectOffset, selectStation]);

  const handleHeroScroll = useCallback(() => {
    const container = heroRegionRef.current;
    if (!container) return;
    if (
      candidates.length > 0
      && container.scrollTop + container.clientHeight >= container.scrollHeight - 2
    ) {
      const last = candidates[candidates.length - 1]!;
      if (last.ds.station.slug !== selectedSlug) setSelectedSlug(last.ds.station.slug);
      return;
    }
    let closestIndex = selectedIndex;
    let closestDistance = Number.POSITIVE_INFINITY;
    candidates.forEach((row, index) => {
      const slide = slideRefs.current.get(row.ds.station.slug);
      if (!slide) return;
      const distance = Math.abs(slide.offsetTop - container.scrollTop);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    const next = candidates[closestIndex];
    if (next && next.ds.station.slug !== selectedSlug) setSelectedSlug(next.ds.station.slug);
  }, [candidates, selectedIndex, selectedSlug]);

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

      {candidates.length === 0 ? (
        <section className="minimal-radio-state" data-testid="minimal-radio-no-candidates">
          <Radio size={24} aria-hidden="true" />
          <h2>Nothing crossed your library in this window.</h2>
          <p>{lifetimeOnly ? "There are no saved crossings in the archive yet." : "Try Lifetime to widen the window."}</p>
        </section>
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
            {candidates.map((row, index) => (
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
        </div>
      )}
    </section>
  );
}