import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ExternalLink,
  Heart,
  Radio,
} from "lucide-react";
import type { DialLaneRow } from "./dial/DialFeedLane";
import type { DialSpin } from "../hooks/useDialData";
import type { LibraryItem } from "../lib/meHooks";
import { useMutationKeep } from "../lib/meHooks";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError, RUMOURS } from "../lib/rumours";
import { usePlayer } from "../player/PlayerProvider";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { StationMark } from "./StationMark";
import { FilterDropdownMenu } from "./dial/FilterDropdownMenu";
import {
  STATION_CATEGORY_DEFINITIONS,
  type StationCategory,
} from "../lib/dialCategories";

export type RadioPreset = "now" | "lifetime";

const STATION_CATEGORY_OPTIONS = STATION_CATEGORY_DEFINITIONS.map(
  ({ cat, label, title }) => ({ value: cat, label, title }),
);
const MAX_CROSSING_ALBUMS = 24;

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

function knownShowName(showName: string | null | undefined): string | null {
  const normalized = showName?.trim();
  if (!normalized || /^unknown(?:\s+show)?$/i.test(normalized)) return null;
  return normalized;
}

function scoreFor(row: DialLaneRow, preset: RadioPreset): number {
  if (preset === "now") {
    const track = liveTrack(row);
    return (track?.isLibraryHit ? 2 : 0) + (track?.isArtistHit ? 1 : 0);
  }
  return row.ds.lifetimeCrossings + row.ds.lifetimeArtistCrossings;
}

interface CrossingSummary {
  count: number;
  label: "this set" | "24 hr" | "7d" | "30d" | "lifetime";
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
  artworkUrl: string;
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
      artworkUrl: album.artworkUrl
        ?? (album.releaseGroupMbid
          ? `https://coverartarchive.org/release-group/${album.releaseGroupMbid}/front-1200`
          : RUMOURS),
    });
    if (albums.length >= MAX_CROSSING_ALBUMS) return albums;
  }
  const add = (item: LibraryItem | undefined, spin?: CrossingSpin) => {
    const recording = item?.recording;
    const releaseGroupMbid = spin?.releaseGroupMbid ?? recording?.releaseGroupMbid;
    if (!releaseGroupMbid || seen.has(releaseGroupMbid)) return;
    seen.add(releaseGroupMbid);
    albums.push({
      key: releaseGroupMbid,
      href: `/album/${releaseGroupMbid}`,
      title: recording?.albumTitle ?? recording?.title ?? spin?.title ?? "Album",
      artist: recording?.artist ?? spin?.artist ?? "",
      artworkUrl: recording?.artworkUrl
        ?? `https://coverartarchive.org/release-group/${releaseGroupMbid}/front-1200`,
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

function MinimalRadioCard({
  row,
  libraryItems,
  stationSpins,
  crossing,
  active,
}: {
  row: DialLaneRow;
  libraryItems: LibraryItem[];
  stationSpins: readonly CrossingSpin[];
  crossing: CrossingSummary;
  active: boolean;
}) {
  const { radio } = usePlayer();
  const keep = useMutationKeep();
  const track = liveTrack(row);
  const albums = useMemo(
    () => crossingAlbums(row, libraryItems, stationSpins, crossing),
    [row, libraryItems, stationSpins, crossing],
  );
  const playable = resolvePlaybackSource(row.ds.station) != null;
  const isCurrent = radio.station?.slug === row.ds.station.slug;
  const isPlaying = isCurrent && radio.status === "playing";
  const showName = knownShowName(row.show?.showName);
  const kept = Boolean(track?.mbid && libraryItems.some((item) => item.mbid === track.mbid));

  const play = useCallback(() => {
    if (playable) void radio.toggle(row.ds.station);
  }, [playable, radio, row.ds.station]);

  const handleKeep = () => {
    if (!track?.mbid || keep.isPending) return;
    keep.mutate({ mbid: track.mbid, provenance: { kind: "keep", stationSlug: row.ds.station.slug } });
  };

  return (
    <article
      className="minimal-radio-card"
      data-testid="minimal-radio-card"
      aria-label={`${row.ds.station.name} station card`}
    >
      <section className="minimal-radio-card__track" aria-label="Current track">
        <div className="minimal-radio-card__eyebrow">Now playing</div>
        <strong>{track?.artist || "The station is live"}</strong>
        {showName ? <small>{showName}</small> : null}
      </section>

      <button
        type="button"
        className="minimal-radio-card__station"
        disabled={!playable}
        onClick={play}
        aria-label={isPlaying ? `Pause ${row.ds.station.name}` : `Tune in to ${row.ds.station.name}`}
      >
        <div className="minimal-radio-card__station-mark-wrap">
          <StationMark
            name={row.ds.station.name}
            logoUrl={row.ds.station.logoUrl}
            homepageUrl={row.ds.station.homepageUrl}
            variant="cube"
            className="minimal-radio-card__station-mark"
          />
          <h2
            className="minimal-radio-card__station-title"
            aria-label={row.ds.station.name}
            data-testid={`minimal-radio-station-label-${row.ds.station.slug}`}
          >
            <span>{row.ds.station.name}</span>
            {stationCity(row.ds.station) ? (
              <small>{stationCity(row.ds.station)}</small>
            ) : null}
          </h2>
        </div>
      </button>

      <section className="minimal-radio-card__albums" aria-label="Lifetime crossings with this station">
        <div className="minimal-radio-card__album-heading">
          <div className="minimal-radio-card__eyebrow">Lifetime crossings</div>
          <div
            className="minimal-radio-card__crossing"
            data-testid={active
              ? "minimal-radio-hero-crossing"
              : `minimal-radio-hero-crossing-${row.ds.station.slug}`}
            aria-label={`${crossing.count} ${crossing.count === 1 ? "crossing" : "crossings"} ${crossing.label}`}
          >
            <strong>{crossing.count}</strong>
            {" "}
            <span>{crossing.count === 1 ? "crossing" : "crossings"}</span>
            {" · "}
            <span>{crossing.label}</span>
          </div>
        </div>
        {albums.length > 0 ? (
          <div className="minimal-radio-card__album-grid">
            {albums.map((album) => (
              <a
                key={album.key}
                href={album.href}
                className="minimal-radio-card__album"
                title={`${album.title} by ${album.artist}`}
                aria-label={`Open ${album.title} by ${album.artist}`}
              >
                <img
                  src={proxyArtUrl(album.artworkUrl) ?? RUMOURS}
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
        ) : (
          <p className="minimal-radio-card__empty-albums">Your saved albums will appear here when this station crosses them.</p>
        )}
      </section>

      <div className="minimal-radio-card__actions">
        <a
          className="minimal-radio-card__site"
          href={row.ds.station.homepageUrl ?? `/archive/stations/${row.ds.station.slug}`}
          target={row.ds.station.homepageUrl ? "_blank" : undefined}
          rel={row.ds.station.homepageUrl ? "noopener noreferrer" : undefined}
          aria-label={`Open ${row.ds.station.name} station page`}
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span>station</span>
        </a>
        <button type="button" onClick={handleKeep} disabled={!track?.mbid || keep.isPending || kept} aria-pressed={kept}>
          <Heart size={14} aria-hidden="true" /> {kept ? "Kept" : keep.isPending ? "Keeping…" : "Keep"}
        </button>
      </div>
    </article>
  );
}

export function MinimalRadioSurface({
  rows,
  libraryItems,
  recentSpinsBySlug = new Map(),
  preset,
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
      .filter((row) => liveTrack(row) != null || row.ds.station.streamUrl != null || row.ds.station.relayUrl != null)
      .sort((a, b) => scoreFor(b, preset) - scoreFor(a, preset) || a.ds.station.name.localeCompare(b.ds.station.name)),
    [preset, rows],
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
  if (candidates.length === 0) {
    return (
      <section className="minimal-radio-state" data-testid="minimal-radio-no-candidates">
        <Radio size={24} aria-hidden="true" />
        <h2>The live stations have no playable signal yet.</h2>
        <p>Metadata can arrive a little after a station comes on air.</p>
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
                active={selectedIndex === index}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}